//+------------------------------------------------------------------+
//| CopyTradeBridge_MT4.mq4                                          |
//|                                                                    |
//| MT4 counterpart to CopyTradeBridge_MT5.mq5 - same protocol, same  |
//| server endpoints, adapted to MT4's classic Order* API (where a    |
//| ticket IS the position, unlike MT5's separate position/deal       |
//| identifiers). See the MT5 file's header comment for the full      |
//| protocol description and one-time terminal setup steps            |
//| (WebRequest URL whitelist, Algo/live trading permissions).        |
//|                                                                    |
//| This file has not been run against a live terminal - validate     |
//| thoroughly on a demo account before going live.                   |
//+------------------------------------------------------------------+
#property strict

//--- Inputs
input string InpServerBaseUrl   = "https://your-server.example.com"; // Backend base URL, no trailing slash
input string InpWebhookToken    = "";                                 // This account's webhook token
input int    InpPollSeconds     = 3;                                  // Poll/diff interval
input bool   InpActAsMaster     = true;                                // Report this account's own trades
input bool   InpActAsFollower   = false;                               // Execute commands queued for this account
input int    InpMagicNumber     = 990011;                              // Tags orders this EA places, for identification
input int    InpSlippage        = 5;                                   // Max slippage (points) for opens/closes
input int    InpHttpTimeoutMs   = 5000;                                // WebRequest timeout

//--- Master-side state: parallel arrays acting as a ticket -> last-known-state map.
int    g_ticket[];
string g_hash[];
string g_symbol[];

int FindTicketIndex(int ticket)
{
   for(int i = 0; i < ArraySize(g_ticket); i++)
      if(g_ticket[i] == ticket)
         return i;
   return -1;
}

void UpsertLastState(int ticket, string hash, string symbol)
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
//| known schema, not a general parser. (Identical to the MT5 EA's - |
//| MQL4 and MQL5 share the same string/array function surface since |
//| the MQL4 build-600+ language unification.)                        |
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
   if(StringGetCharacter(obj, i) != '"') return "";
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
      if((c >= '0' && c <= '9') || c == '-' || c == '.') { end++; continue; }
      break;
   }
   string numStr = StringSubstr(obj, start, end - start);
   if(numStr == "" || numStr == "null") return 0.0;
   return StringToDouble(numStr);
}

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
      int len = StringToCharArray(jsonBody, data, 0, WHOLE_ARRAY, CP_UTF8) - 1;
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
                     double sl, double tp, int ticket)
{
   string body = "{"
      "\"eventType\":" + JsonStr(eventType) + ","
      "\"symbol\":" + JsonStr(symbol) + ","
      "\"side\":" + JsonStr(side) + ","
      "\"size\":" + (volume > 0 ? DoubleToString(volume, 2) : "null") + ","
      "\"price\":" + (price > 0 ? DoubleToString(price, 5) : "null") + ","
      "\"sl\":" + JsonNum(sl) + ","
      "\"tp\":" + JsonNum(tp) + ","
      "\"externalPositionId\":" + JsonStr(IntegerToString(ticket))
      + "}";

   string response;
   if(!HttpRequest("POST", "/api/webhook/trade", body, response))
      Print("CopyTradeBridge: failed to report ", eventType, " for ticket ", ticket);
}

// Called once from OnInit, before the first diff, so an EA (re)start
// silently absorbs whatever is already open instead of re-reporting every
// pre-existing position as newly opened.
void PrimeMasterState()
{
   ArrayResize(g_ticket, 0);
   ArrayResize(g_hash, 0);
   ArrayResize(g_symbol, 0);

   for(int i = 0; i < OrdersTotal(); i++)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderType() != OP_BUY && OrderType() != OP_SELL) continue; // skip pending orders
      // Skip orders this same EA placed on behalf of a follower command -
      // otherwise, on an account acting as both master and follower, a
      // copied-in trade would get reported straight back out as if the
      // account itself had opened it.
      if(OrderMagicNumber() == InpMagicNumber) continue;

      UpsertLastState(OrderTicket(), PositionHash(OrderLots(), OrderStopLoss(), OrderTakeProfit()), OrderSymbol());
   }
   Print("CopyTradeBridge: primed ", ArraySize(g_ticket), " pre-existing position(s) - won't re-report these as new.");
}

void RunMasterDiff()
{
   bool stillOpen[];
   ArrayResize(stillOpen, ArraySize(g_ticket));
   ArrayInitialize(stillOpen, false);

   for(int i = 0; i < OrdersTotal(); i++)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderType() != OP_BUY && OrderType() != OP_SELL) continue;
      if(OrderMagicNumber() == InpMagicNumber) continue;

      int ticket = OrderTicket();
      double volume = OrderLots();
      double sl = OrderStopLoss();
      double tp = OrderTakeProfit();
      double openPrice = OrderOpenPrice();
      string symbol = OrderSymbol();
      string side = (OrderType() == OP_BUY) ? "buy" : "sell";
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
   int targetTicket = (int)StringToInteger(targetPositionIdStr);

   if(commandType == "open")
   {
      double bid = MarketInfo(symbol, MODE_BID);
      double ask = MarketInfo(symbol, MODE_ASK);
      if(bid == 0 || ask == 0)
      {
         AckCommand(id, "failed", "", "Symbol " + symbol + " has no market price on this follower account (not in Market Watch?).");
         return;
      }

      int cmd = (side == "buy") ? OP_BUY : OP_SELL;
      double price = (side == "buy") ? ask : bid;
      int ticket = OrderSend(symbol, cmd, size, price, InpSlippage, sl, tp, "CopyTradeBridge", InpMagicNumber, 0,
                              (side == "buy") ? clrBlue : clrRed);
      if(ticket < 0)
      {
         AckCommand(id, "failed", "", "OrderSend failed, error " + IntegerToString(GetLastError()));
         return;
      }
      AckCommand(id, "executed", IntegerToString(ticket), "");
      return;
   }

   if(commandType == "close")
   {
      if(!OrderSelect(targetTicket, SELECT_BY_TICKET))
      {
         AckCommand(id, "failed", "", "Follower position " + targetPositionIdStr + " not found - may already be closed.");
         return;
      }
      double closePrice = (OrderType() == OP_BUY) ? MarketInfo(OrderSymbol(), MODE_BID) : MarketInfo(OrderSymbol(), MODE_ASK);
      bool ok = OrderClose(targetTicket, OrderLots(), closePrice, InpSlippage);
      if(!ok)
      {
         AckCommand(id, "failed", "", "OrderClose failed, error " + IntegerToString(GetLastError()));
         return;
      }
      AckCommand(id, "executed", "", "");
      return;
   }

   if(commandType == "modify")
   {
      if(!OrderSelect(targetTicket, SELECT_BY_TICKET))
      {
         AckCommand(id, "failed", "", "Follower position " + targetPositionIdStr + " not found - may already be closed.");
         return;
      }
      bool ok = OrderModify(targetTicket, OrderOpenPrice(), sl, tp, 0);
      if(!ok)
      {
         AckCommand(id, "failed", "", "OrderModify failed, error " + IntegerToString(GetLastError()));
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

void OnTick()
{
   // Intentionally empty - all work happens on the timer, not every tick,
   // to keep this light and avoid hammering the API on fast-moving symbols.
}
