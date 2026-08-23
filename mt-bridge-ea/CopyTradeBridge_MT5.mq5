//+------------------------------------------------------------------+
//| CopyTradeBridge_MT5.mq5                                          |
//|                                                                    |
//| Bridges an MT5 account into the copy-trading backend, in either   |
//| direction depending on Role:                                      |
//|                                                                    |
//|  - Master: on each timer tick, diffs this account's open          |
//|    positions against what it saw last tick and POSTs any          |
//|    open/close/modify event to POST {ServerBaseUrl}/api/webhook/   |
//|    trade - the exact same endpoint any other bridge (MT4,         |
//|    NinjaTrader) uses. The backend already dedups retried          |
//|    deliveries by idempotency key, so a retry here is safe.        |
//|                                                                    |
//|  - Follower: on each timer tick, polls GET {ServerBaseUrl}/api/   |
//|    bridge/commands for pending open/close/modify commands         |
//|    queued for this account, executes each one locally, and        |
//|    reports the outcome back via POST .../api/bridge/commands/     |
//|    {id}/ack. MT5 can't accept inbound connections, so this        |
//|    poll-then-ack pattern is the only way the backend can reach    |
//|    it.                                                             |
//|                                                                    |
//| Setup (required, one-time, per terminal):                         |
//|  1. Tools -> Options -> Expert Advisors -> check "Allow           |
//|     WebRequest for listed URL" and add your ServerBaseUrl         |
//|     (must be https:// in live use - MT5 refuses http:// unless    |
//|     it's localhost).                                              |
//|  2. Enable "Algo Trading" (the button in the toolbar) and check   |
//|     "Allow live trading" in this EA's Common tab when attaching   |
//|     it to a chart.                                                 |
//|  3. Set ServerBaseUrl and WebhookToken in the EA's inputs to the  |
//|     values from this account's broker-account record.             |
//|                                                                    |
//| This file has not been run against a live terminal - the platform |
//| team building it has no MetaTrader environment to compile/test    |
//| against. Validate thoroughly on a demo account before going live. |
//+------------------------------------------------------------------+
#property strict
#include <Trade\Trade.mqh>

//--- Inputs
input string InpServerBaseUrl   = "https://your-server.example.com"; // Backend base URL, no trailing slash
input string InpWebhookToken    = "";                                 // This account's webhook token
input int    InpPollSeconds     = 3;                                  // Poll/diff interval
input bool   InpActAsMaster     = true;                                // Report this account's own trades
input bool   InpActAsFollower   = false;                               // Execute commands queued for this account
input int    InpMagicNumber     = 990011;                              // Tags orders this EA places, for identification
input int    InpHttpTimeoutMs   = 5000;                                // WebRequest timeout

CTrade trade;

//--- Master-side state: parallel arrays acting as a ticket -> last-known-state map.
ulong  g_ticket[];
string g_hash[];
string g_symbol[];

int FindTicketIndex(ulong ticket)
{
   for(int i = 0; i < ArraySize(g_ticket); i++)
      if(g_ticket[i] == ticket)
         return i;
   return -1;
}

void UpsertLastState(ulong ticket, string hash, string symbol)
{
   int idx = FindTicketIndex(ticket);
   if(idx >= 0)
   {
      g_hash[idx] = hash;
      return;
   }
   int n = ArraySize(g_ticket);
   ArrayResize(g_ticket, n + 1);
   ArrayResize(g_hash, n + 1);
   ArrayResize(g_symbol, n + 1);
   g_ticket[n] = ticket;
   g_hash[n] = hash;
   g_symbol[n] = symbol;
}

void RemoveTicket(int idx)
{
   int last = ArraySize(g_ticket) - 1;
   g_ticket[idx] = g_ticket[last];
   g_hash[idx] = g_hash[last];
   g_symbol[idx] = g_symbol[last];
   ArrayResize(g_ticket, last);
   ArrayResize(g_hash, last);
   ArrayResize(g_symbol, last);
}

//+------------------------------------------------------------------+
//| Minimal JSON helpers - purpose-built for this bridge's flat,     |
//| known schema, not a general parser.                              |
//+------------------------------------------------------------------+
string JsonEscape(string s)
{
   string out = s;
   StringReplace(out, "\\", "\\\\");
   StringReplace(out, "\"", "\\\"");
   return out;
}

string JsonNum(double v)
{
   if(v == 0.0) return "null";
   return DoubleToString(v, 5);
}

string JsonStr(string s)
{
   if(s == "") return "null";
   return "\"" + JsonEscape(s) + "\"";
}

// Extracts the raw string value of "key":"value" or "key":null from a JSON
// object substring. Returns "" for null/absent - callers treat "" and
// missing the same way, which matches how this schema uses them.
string ExtractJsonString(string obj, string key)
{
   string needle = "\"" + key + "\"";
   int keyPos = StringFind(obj, needle);
   if(keyPos < 0) return "";
   int colon = StringFind(obj, ":", keyPos);
   if(colon < 0) return "";
   int i = colon + 1;
   while(i < StringLen(obj) && StringGetCharacter(obj, i) == ' ') i++;
   if(i >= StringLen(obj)) return "";
   if(StringGetCharacter(obj, i) != '"') return ""; // null or number where a string was expected
   int start = i + 1;
   int end = start;
   while(end < StringLen(obj))
   {
      ushort c = StringGetCharacter(obj, end);
      if(c == '\\') { end += 2; continue; }
      if(c == '"') break;
      end++;
   }
   return StringSubstr(obj, start, end - start);
}

double ExtractJsonNumber(string obj, string key)
{
   string needle = "\"" + key + "\"";
   int keyPos = StringFind(obj, needle);
   if(keyPos < 0) return 0.0;
   int colon = StringFind(obj, ":", keyPos);
   if(colon < 0) return 0.0;
   int i = colon + 1;
   while(i < StringLen(obj) && StringGetCharacter(obj, i) == ' ') i++;
   int start = i;
   int end = start;
   while(end < StringLen(obj))
   {
      ushort c = StringGetCharacter(obj, end);
      if((c >= '0' && c <= '9') || c == '-' || c == '.' ) { end++; continue; }
      break;
   }
   string numStr = StringSubstr(obj, start, end - start);
   if(numStr == "" || numStr == "null") return 0.0;
   return StringToDouble(numStr);
}

// Splits the top-level array found after "commands":[ ... ] into individual
// {...} object substrings, by simple brace-depth counting. Flat schema, no
// nested objects inside a command, so this is sufficient.
int SplitJsonObjects(string arrayBody, string &out[])
{
   ArrayResize(out, 0);
   int depth = 0, start = -1, count = 0;
   for(int i = 0; i < StringLen(arrayBody); i++)
   {
      ushort c = StringGetCharacter(arrayBody, i);
      if(c == '{')
      {
         if(depth == 0) start = i;
         depth++;
      }
      else if(c == '}')
      {
         depth--;
         if(depth == 0 && start >= 0)
         {
            ArrayResize(out, count + 1);
            out[count] = StringSubstr(arrayBody, start, i - start + 1);
            count++;
            start = -1;
         }
      }
   }
   return count;
}

//+------------------------------------------------------------------+
//| HTTP helpers                                                     |
//+------------------------------------------------------------------+
bool HttpRequest(string method, string path, string jsonBody, string &responseOut)
{
   string url = InpServerBaseUrl + path;
   string headers = "Content-Type: application/json\r\nX-Webhook-Token: " + InpWebhookToken + "\r\n";

   uchar data[];
   if(jsonBody != "")
   {
      int len = StringToCharArray(jsonBody, data, 0, WHOLE_ARRAY, CP_UTF8) - 1; // drop the trailing null terminator
      ArrayResize(data, len);
   }

   uchar result[];
   string resultHeaders;
   ResetLastError();
   int status = WebRequest(method, url, headers, InpHttpTimeoutMs, data, result, resultHeaders);

   if(status == -1)
   {
      int err = GetLastError();
      Print("CopyTradeBridge: WebRequest failed (", err, ") calling ", method, " ", url,
            " - is this URL whitelisted under Tools > Options > Expert Advisors?");
      return false;
   }

   responseOut = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   if(status < 200 || status >= 300)
   {
      Print("CopyTradeBridge: ", method, " ", url, " returned HTTP ", status, ": ", responseOut);
      return false;
   }
   return true;
}

//+------------------------------------------------------------------+
//| Master side: diff open positions, POST any change                |
//+------------------------------------------------------------------+
string PositionHash(double volume, double sl, double tp)
{
   return DoubleToString(volume, 2) + ":" + DoubleToString(sl, 5) + ":" + DoubleToString(tp, 5);
}

void PostTradeEvent(string eventType, string symbol, string side, double volume, double price,
                     double sl, double tp, ulong ticket)
{
   string body = "{"
      "\"eventType\":" + JsonStr(eventType) + ","
      "\"symbol\":" + JsonStr(symbol) + ","
      "\"side\":" + JsonStr(side) + ","
      "\"size\":" + (volume > 0 ? DoubleToString(volume, 2) : "null") + ","
      "\"price\":" + (price > 0 ? DoubleToString(price, 5) : "null") + ","
      "\"sl\":" + JsonNum(sl) + ","
      "\"tp\":" + JsonNum(tp) + ","
      "\"externalPositionId\":" + JsonStr(IntegerToString((long)ticket))
      + "}";

   string response;
   if(!HttpRequest("POST", "/api/webhook/trade", body, response))
      Print("CopyTradeBridge: failed to report ", eventType, " for ticket ", ticket);
}

// Called once from OnInit, before the first diff, so an EA (re)start
// silently absorbs whatever is already open instead of re-reporting every
// pre-existing position as newly opened - same fix the backend poller
// needed for the same reason.
void PrimeMasterState()
{
   ArrayResize(g_ticket, 0);
   ArrayResize(g_hash, 0);
   ArrayResize(g_symbol, 0);

   for(int i = 0; i < PositionsTotal(); i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      // Skip positions this same EA opened on behalf of a follower command -
      // otherwise, on an account acting as both master and follower, a
      // copied-in trade would get reported straight back out as if the
      // account itself had opened it.
      if(PositionGetInteger(POSITION_MAGIC) == InpMagicNumber) continue;
      double volume = PositionGetDouble(POSITION_VOLUME);
      double sl = PositionGetDouble(POSITION_SL);
      double tp = PositionGetDouble(POSITION_TP);
      string symbol = PositionGetString(POSITION_SYMBOL);
      UpsertLastState(ticket, PositionHash(volume, sl, tp), symbol);
   }
   Print("CopyTradeBridge: primed ", ArraySize(g_ticket), " pre-existing position(s) - won't re-report these as new.");
}

void RunMasterDiff()
{
   // current pass: track which known tickets are still open
   bool stillOpen[];
   ArrayResize(stillOpen, ArraySize(g_ticket));
   ArrayInitialize(stillOpen, false);

   for(int i = 0; i < PositionsTotal(); i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetInteger(POSITION_MAGIC) == InpMagicNumber) continue;

      double volume = PositionGetDouble(POSITION_VOLUME);
      double sl = PositionGetDouble(POSITION_SL);
      double tp = PositionGetDouble(POSITION_TP);
      double openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
      string symbol = PositionGetString(POSITION_SYMBOL);
      long type = PositionGetInteger(POSITION_TYPE);
      string side = (type == POSITION_TYPE_BUY) ? "buy" : "sell";
      string hash = PositionHash(volume, sl, tp);

      int idx = FindTicketIndex(ticket);
      if(idx < 0)
      {
         PostTradeEvent("position_opened", symbol, side, volume, openPrice, sl, tp, ticket);
         UpsertLastState(ticket, hash, symbol);
      }
      else
      {
         stillOpen[idx] = true;
         if(g_hash[idx] != hash)
         {
            PostTradeEvent("position_modified", symbol, side, volume, openPrice, sl, tp, ticket);
            g_hash[idx] = hash;
         }
      }
   }

   // anything previously known but not seen this pass has closed
   for(int idx = ArraySize(g_ticket) - 1; idx >= 0; idx--)
   {
      if(idx < ArraySize(stillOpen) && stillOpen[idx]) continue;
      PostTradeEvent("position_closed", g_symbol[idx], "", 0, 0, 0, 0, g_ticket[idx]);
      RemoveTicket(idx);
   }
}

//+------------------------------------------------------------------+
//| Follower side: poll pending commands, execute, ack                |
//+------------------------------------------------------------------+
void AckCommand(string commandId, string status, string resultPositionId, string errorMessage)
{
   string body = "{"
      "\"status\":" + JsonStr(status) + ","
      "\"resultPositionId\":" + JsonStr(resultPositionId) + ","
      "\"errorMessage\":" + JsonStr(errorMessage)
      + "}";
   string response;
   HttpRequest("POST", "/api/bridge/commands/" + commandId + "/ack", body, response);
}

// After a successful Buy/Sell, resolve the actual position ticket via the
// deal that opened it - more reliable than assuming order ticket ==
// position ticket.
ulong ResolveOpenedPositionTicket()
{
   ulong dealTicket = trade.ResultDeal();
   if(dealTicket == 0) return 0;
   if(!HistoryDealSelect(dealTicket)) return 0;
   return (ulong)HistoryDealGetInteger(dealTicket, DEAL_POSITION_ID);
}

void ExecuteCommand(string obj)
{
   string id = ExtractJsonString(obj, "id");
   string commandType = ExtractJsonString(obj, "commandType");
   string symbol = ExtractJsonString(obj, "symbol");
   string side = ExtractJsonString(obj, "side");
   double size = ExtractJsonNumber(obj, "size");
   double sl = ExtractJsonNumber(obj, "sl");
   double tp = ExtractJsonNumber(obj, "tp");
   string targetPositionIdStr = ExtractJsonString(obj, "targetPositionId");
   ulong targetPositionId = (ulong)StringToInteger(targetPositionIdStr);

   trade.SetExpertMagicNumber(InpMagicNumber);

   if(commandType == "open")
   {
      if(!SymbolSelect(symbol, true))
      {
         AckCommand(id, "failed", "", "Symbol " + symbol + " not available in Market Watch on this follower account.");
         return;
      }
      bool ok = (side == "buy") ? trade.Buy(size, symbol, 0, sl, tp) : trade.Sell(size, symbol, 0, sl, tp);
      if(!ok)
      {
         AckCommand(id, "failed", "", "OrderSend failed: " + trade.ResultRetcodeDescription());
         return;
      }
      ulong newTicket = ResolveOpenedPositionTicket();
      AckCommand(id, "executed", newTicket > 0 ? IntegerToString((long)newTicket) : "", "");
      return;
   }

   if(commandType == "close")
   {
      if(!PositionSelectByTicket(targetPositionId))
      {
         AckCommand(id, "failed", "", "Follower position " + targetPositionIdStr + " not found - may already be closed.");
         return;
      }
      bool ok = trade.PositionClose(targetPositionId);
      if(!ok)
      {
         AckCommand(id, "failed", "", "PositionClose failed: " + trade.ResultRetcodeDescription());
         return;
      }
      AckCommand(id, "executed", "", "");
      return;
   }

   if(commandType == "modify")
   {
      if(!PositionSelectByTicket(targetPositionId))
      {
         AckCommand(id, "failed", "", "Follower position " + targetPositionIdStr + " not found - may already be closed.");
         return;
      }
      bool ok = trade.PositionModify(targetPositionId, sl, tp);
      if(!ok)
      {
         AckCommand(id, "failed", "", "PositionModify failed: " + trade.ResultRetcodeDescription());
         return;
      }
      AckCommand(id, "executed", "", "");
      return;
   }

   AckCommand(id, "failed", "", "Unknown commandType: " + commandType);
}

void PollFollowerCommands()
{
   string response;
   if(!HttpRequest("GET", "/api/bridge/commands", "", response)) return;

   int arrayStart = StringFind(response, "\"commands\":[");
   if(arrayStart < 0) return;
   int bodyStart = arrayStart + StringLen("\"commands\":[");
   int bodyEnd = StringFind(response, "]", bodyStart);
   // Find the matching closing bracket for the array, not just the first ']'
   // encountered (a command object itself contains none, so this is safe
   // for our flat schema, but guard against an empty array explicitly).
   string arrayBody = (bodyEnd > bodyStart) ? StringSubstr(response, bodyStart, bodyEnd - bodyStart) : "";
   if(arrayBody == "") return;

   string objects[];
   int n = SplitJsonObjects(arrayBody, objects);
   for(int i = 0; i < n; i++)
      ExecuteCommand(objects[i]);
}

//+------------------------------------------------------------------+
//| EA lifecycle                                                     |
//+------------------------------------------------------------------+
int OnInit()
{
   if(InpWebhookToken == "")
   {
      Print("CopyTradeBridge: WebhookToken input is empty - set it to this account's broker-account webhook token before running.");
      return INIT_PARAMETERS_INCORRECT;
   }

   if(InpActAsMaster)
      PrimeMasterState();

   EventSetTimer(MathMax(1, InpPollSeconds));
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTimer()
{
   if(InpActAsMaster) RunMasterDiff();
   if(InpActAsFollower) PollFollowerCommands();
}
