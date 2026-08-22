//+------------------------------------------------------------------+
//| CopyTradeBridge.mq5                                              |
//| Reference MT5 Expert Advisor for the Enterprise Copy Trading      |
//| Platform's MT4/MT5 bridge (see ea-bridge/README.md for the full  |
//| HTTP contract this implements against src/routes/webhook.js and  |
//| src/routes/ea.js).                                                |
//|                                                                    |
//| One EA, two roles, chosen per attached account via IsMasterRole: |
//|  - Master: every timer tick, diffs this account's open positions |
//|    against the previous tick and POSTs any opened/modified/      |
//|    closed position to /api/webhook/trade.                        |
//|  - Follower: every timer tick, GETs /api/ea/commands, executes   |
//|    each queued open/modify/close locally via CTrade, and POSTs   |
//|    the outcome back to /api/ea/commands/<id>/result.             |
//|                                                                    |
//| NOTE: written to the platform's verified HTTP contract but not    |
//| compiled/run here (no MetaTrader runtime in this environment) -  |
//| review in the MetaEditor compiler before running on a live/demo |
//| account.                                                           |
//+------------------------------------------------------------------+
#property copyright "Enterprise Copy Trading Platform"
#property version   "1.00"
#property strict

#include <Trade\Trade.mqh>

input string ServerBaseUrl   = "http://127.0.0.1:3000"; // e.g. https://your-server.example.com
input string WebhookToken    = "";                       // from POST /api/broker-accounts response
input bool   IsMasterRole    = true;                      // true = master (push), false = follower (poll)
input int    PollIntervalSec = 5;                         // must be >= chart timer resolution
input int    HttpTimeoutMs   = 5000;
input int    MagicNumber     = 20260822;                  // used to tag orders this EA places as follower

CTrade trade;

// --- master-side position snapshot, diffed each tick ---
#define MAX_TRACKED 500
ulong  g_prevTicket[MAX_TRACKED];
string g_prevSide[MAX_TRACKED];
double g_prevVolume[MAX_TRACKED];
double g_prevSl[MAX_TRACKED];
double g_prevTp[MAX_TRACKED];
int    g_prevCount = 0;

int OnInit()
{
   if (StringLen(WebhookToken) == 0)
   {
      Print("CopyTradeBridge: WebhookToken input is empty - EA will not run.");
      return INIT_PARAMETERS_INCORRECT;
   }
   trade.SetExpertMagicNumber(MagicNumber);
   EventSetTimer(MathMax(1, PollIntervalSec));
   if (IsMasterRole)
      PrimeMasterSnapshot(); // don't re-announce positions already open when the EA starts
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTimer()
{
   if (IsMasterRole)
      MasterTick();
   else
      FollowerTick();
}

//+------------------------------------------------------------------+
//| Minimal HTTP helper - wraps WebRequest, returns response body.   |
//| Requires ServerBaseUrl's host to be added under                  |
//| Tools > Options > Expert Advisors > "Allow WebRequest for..."     |
//+------------------------------------------------------------------+
bool HttpRequest(string method, string path, string body, string &response)
{
   string headers = "Content-Type: application/json\r\nX-Webhook-Token: " + WebhookToken + "\r\n";
   char postData[];
   if (StringLen(body) > 0)
   {
      int len = StringToCharArray(body, postData, 0, StringLen(body), CP_UTF8);
      ArrayResize(postData, len - 1); // StringToCharArray null-terminates; WebRequest wants the raw byte count
   }
   char result[];
   string resultHeaders;
   ResetLastError();
   int status = WebRequest(method, ServerBaseUrl + path, headers, HttpTimeoutMs, postData, result, resultHeaders);
   if (status == -1)
   {
      Print("CopyTradeBridge: WebRequest failed, error=", GetLastError(),
            " - is '", ServerBaseUrl, "' whitelisted under Expert Advisors options?");
      return false;
   }
   response = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   if (status < 200 || status >= 300)
   {
      Print("CopyTradeBridge: ", method, " ", path, " -> HTTP ", status, ": ", response);
      return false;
   }
   return true;
}

//+------------------------------------------------------------------+
//| Master role                                                       |
//+------------------------------------------------------------------+
string SideOf(ENUM_POSITION_TYPE type)
{
   return type == POSITION_TYPE_BUY ? "buy" : "sell";
}

void PrimeMasterSnapshot()
{
   g_prevCount = 0;
   int total = PositionsTotal();
   for (int i = 0; i < total && g_prevCount < MAX_TRACKED; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if (ticket == 0 || !PositionSelectByTicket(ticket)) continue;
      g_prevTicket[g_prevCount] = ticket;
      g_prevSide[g_prevCount]   = SideOf((ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE));
      g_prevVolume[g_prevCount] = PositionGetDouble(POSITION_VOLUME);
      g_prevSl[g_prevCount]     = PositionGetDouble(POSITION_SL);
      g_prevTp[g_prevCount]     = PositionGetDouble(POSITION_TP);
      g_prevCount++;
   }
   Print("CopyTradeBridge: primed with ", g_prevCount, " pre-existing position(s) - won't re-announce these as new.");
}

int FindPrev(ulong ticket)
{
   for (int i = 0; i < g_prevCount; i++)
      if (g_prevTicket[i] == ticket) return i;
   return -1;
}

string JsonEscape(string s)
{
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   return s;
}

string BuildTradeEventJson(string eventType, string symbol, string side, double volume, double price,
                            double sl, double tp, ulong ticket)
{
   string json = "{";
   json += "\"eventType\":\"" + eventType + "\",";
   json += "\"symbol\":\"" + JsonEscape(symbol) + "\",";
   if (StringLen(side) > 0) json += "\"side\":\"" + side + "\",";
   if (eventType != "position_closed") json += "\"size\":" + DoubleToString(volume, 2) + ",";
   json += "\"price\":" + DoubleToString(price, _Digits) + ",";
   json += "\"sl\":" + (sl > 0 ? DoubleToString(sl, _Digits) : "null") + ",";
   json += "\"tp\":" + (tp > 0 ? DoubleToString(tp, _Digits) : "null") + ",";
   json += "\"externalPositionId\":\"" + IntegerToString((long)ticket) + "\"";
   json += "}";
   return json;
}

void PostTradeEvent(string eventType, string symbol, string side, double volume, double price,
                     double sl, double tp, ulong ticket)
{
   string body = BuildTradeEventJson(eventType, symbol, side, volume, price, sl, tp, ticket);
   string response;
   if (HttpRequest("POST", "/api/webhook/trade", body, response))
      Print("CopyTradeBridge: reported ", eventType, " for ticket ", ticket, " -> ", response);
}

void MasterTick()
{
   ulong  curTicket[MAX_TRACKED];
   string curSide[MAX_TRACKED];
   double curVolume[MAX_TRACKED];
   double curSl[MAX_TRACKED];
   double curTp[MAX_TRACKED];
   int    curCount = 0;

   int total = PositionsTotal();
   for (int i = 0; i < total && curCount < MAX_TRACKED; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if (ticket == 0 || !PositionSelectByTicket(ticket)) continue;

      string symbol   = PositionGetString(POSITION_SYMBOL);
      string side     = SideOf((ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE));
      double volume   = PositionGetDouble(POSITION_VOLUME);
      double sl       = PositionGetDouble(POSITION_SL);
      double tp       = PositionGetDouble(POSITION_TP);
      double openPrice= PositionGetDouble(POSITION_PRICE_OPEN);

      curTicket[curCount] = ticket;
      curSide[curCount]   = side;
      curVolume[curCount] = volume;
      curSl[curCount]     = sl;
      curTp[curCount]     = tp;
      curCount++;

      int prevIdx = FindPrev(ticket);
      if (prevIdx == -1)
      {
         PostTradeEvent("position_opened", symbol, side, volume, openPrice, sl, tp, ticket);
      }
      else if (g_prevSide[prevIdx] != side || g_prevVolume[prevIdx] != volume ||
               g_prevSl[prevIdx] != sl || g_prevTp[prevIdx] != tp)
      {
         PostTradeEvent("position_modified", symbol, side, volume, openPrice, sl, tp, ticket);
      }
   }

   // anything in the previous snapshot no longer present just closed
   for (int i = 0; i < g_prevCount; i++)
   {
      bool stillOpen = false;
      for (int j = 0; j < curCount; j++)
         if (curTicket[j] == g_prevTicket[i]) { stillOpen = true; break; }
      if (!stillOpen)
         PostTradeEvent("position_closed", "", "", 0, 0, 0, 0, g_prevTicket[i]);
   }

   g_prevCount = curCount;
   ArrayCopy(g_prevTicket, curTicket, 0, 0, curCount);
   ArrayCopy(g_prevVolume, curVolume, 0, 0, curCount);
   ArrayCopy(g_prevSl, curSl, 0, 0, curCount);
   ArrayCopy(g_prevTp, curTp, 0, 0, curCount);
   for (int i = 0; i < curCount; i++) g_prevSide[i] = curSide[i];
}

//+------------------------------------------------------------------+
//| Follower role                                                     |
//+------------------------------------------------------------------+

// Tiny hand-rolled extractors for the flat command objects the server
// returns (see ea-bridge/README.md) - not a general JSON parser, deliberately
// scoped to this one response shape.
string JsonStr(string obj, string key)
{
   string needle = "\"" + key + "\":\"";
   int start = StringFind(obj, needle);
   if (start == -1) return "";
   start += StringLen(needle);
   int end = start;
   while (end < StringLen(obj) && StringGetCharacter(obj, end) != '"')
   {
      if (StringGetCharacter(obj, end) == '\\') end++; // skip escaped char
      end++;
   }
   return StringSubstr(obj, start, end - start);
}

bool JsonIsNull(string obj, string key)
{
   string needle = "\"" + key + "\":null";
   return StringFind(obj, needle) != -1;
}

double JsonNum(string obj, string key, double defVal)
{
   if (JsonIsNull(obj, key)) return defVal;
   string needle = "\"" + key + "\":";
   int start = StringFind(obj, needle);
   if (start == -1) return defVal;
   start += StringLen(needle);
   int end = start;
   while (end < StringLen(obj))
   {
      ushort c = StringGetCharacter(obj, end);
      if (c == ',' || c == '}') break;
      end++;
   }
   return StringToDouble(StringSubstr(obj, start, end - start));
}

// Splits the top-level "commands":[ ... ] array into individual flat object
// strings. Safe here because command objects have no nested {}/[] - every
// value is a string, number, or null.
int SplitCommandObjects(string body, string &out[])
{
   int arrStart = StringFind(body, "[");
   int arrEnd = StringFind(body, "]", arrStart);
   if (arrStart == -1 || arrEnd == -1) return 0;
   string inner = StringSubstr(body, arrStart + 1, arrEnd - arrStart - 1);
   if (StringLen(inner) == 0) return 0;

   int count = 0;
   int depth = 0, objStart = -1;
   for (int i = 0; i < StringLen(inner); i++)
   {
      ushort c = StringGetCharacter(inner, i);
      if (c == '{') { if (depth == 0) objStart = i; depth++; }
      else if (c == '}')
      {
         depth--;
         if (depth == 0 && objStart != -1)
         {
            ArrayResize(out, count + 1);
            out[count] = StringSubstr(inner, objStart, i - objStart + 1);
            count++;
            objStart = -1;
         }
      }
   }
   return count;
}

ulong OpenFollowerPosition(string symbol, string side, double volume)
{
   if (!SymbolSelect(symbol, true))
   {
      Print("CopyTradeBridge: symbol not available on this account: ", symbol);
      return 0;
   }
   bool ok = (side == "buy")
      ? trade.Buy(volume, symbol)
      : trade.Sell(volume, symbol);
   if (!ok)
   {
      Print("CopyTradeBridge: open failed, retcode=", trade.ResultRetcode(), " ", trade.ResultRetcodeDescription());
      return 0;
   }
   return trade.ResultOrder() != 0 ? trade.ResultOrder() : trade.ResultDeal();
}

bool ModifyFollowerPosition(ulong ticket, double sl, double tp)
{
   if (!PositionSelectByTicket(ticket))
   {
      Print("CopyTradeBridge: modify target ticket not found locally: ", ticket);
      return false;
   }
   double curSl = PositionGetDouble(POSITION_SL);
   double curTp = PositionGetDouble(POSITION_TP);
   return trade.PositionModify(ticket, sl > 0 ? sl : curSl, tp > 0 ? tp : curTp);
}

bool CloseFollowerPosition(ulong ticket)
{
   if (!PositionSelectByTicket(ticket))
   {
      Print("CopyTradeBridge: close target ticket not found locally (already closed?): ", ticket);
      return true; // nothing to do, don't treat as a hard failure
   }
   return trade.PositionClose(ticket);
}

void ReportResult(string executionId, bool success, ulong resultPositionId, string errorMessage)
{
   string body = "{\"status\":\"" + (success ? "executed" : "failed") + "\"";
   if (success && resultPositionId != 0)
      body += ",\"resultPositionId\":\"" + IntegerToString((long)resultPositionId) + "\"";
   if (!success)
      body += ",\"errorMessage\":\"" + JsonEscape(errorMessage) + "\"";
   body += "}";

   string response;
   HttpRequest("POST", "/api/ea/commands/" + executionId + "/result", body, response);
}

void FollowerTick()
{
   string response;
   if (!HttpRequest("GET", "/api/ea/commands", "", response)) return;

   string objects[];
   int count = SplitCommandObjects(response, objects);
   for (int i = 0; i < count; i++)
   {
      string obj = objects[i];
      string executionId = JsonStr(obj, "executionId");
      string action      = JsonStr(obj, "action");
      string symbol      = JsonStr(obj, "symbol");
      string side        = JsonStr(obj, "side");
      double size        = JsonNum(obj, "size", 0);
      double sl          = JsonNum(obj, "sl", 0);
      double tp          = JsonNum(obj, "tp", 0);
      string targetIdStr = JsonStr(obj, "targetPositionId");
      ulong  targetId    = targetIdStr == "" ? 0 : (ulong)StringToInteger(targetIdStr);

      if (executionId == "") continue;

      if (action == "open")
      {
         ulong newTicket = OpenFollowerPosition(symbol, side, size);
         ReportResult(executionId, newTicket != 0, newTicket, newTicket == 0 ? "open failed" : "");
      }
      else if (action == "modify")
      {
         bool ok = ModifyFollowerPosition(targetId, sl, tp);
         ReportResult(executionId, ok, targetId, ok ? "" : "modify failed");
      }
      else if (action == "close")
      {
         bool ok = CloseFollowerPosition(targetId);
         ReportResult(executionId, ok, 0, ok ? "" : "close failed");
      }
   }
}
