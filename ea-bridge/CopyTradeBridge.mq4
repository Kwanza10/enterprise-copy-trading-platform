//+------------------------------------------------------------------+
//| CopyTradeBridge.mq4                                              |
//| Reference MT4 Expert Advisor for the Enterprise Copy Trading      |
//| Platform's MT4/MT5 bridge - see ea-bridge/README.md for the full |
//| HTTP contract (src/routes/webhook.js, src/routes/ea.js) and the  |
//| MT5 companion EA (CopyTradeBridge.mq5) this mirrors.              |
//|                                                                    |
//| Same two roles as the MT5 version, but against MT4's legacy       |
//| ticket-based Order* API (no netting, one order == one position):  |
//|  - Master: diffs open orders each timer tick, POSTs opens/        |
//|    modifies/closes to /api/webhook/trade.                         |
//|  - Follower: GETs /api/ea/commands each tick, executes each via   |
//|    OrderSend/OrderModify/OrderClose, POSTs the outcome back.      |
//|                                                                    |
//| NOTE: written to the platform's verified HTTP contract but not    |
//| compiled/run here (no MetaTrader runtime in this environment) -  |
//| review in the MetaEditor compiler before running on a live/demo  |
//| account.                                                           |
//+------------------------------------------------------------------+
#property copyright "Enterprise Copy Trading Platform"
#property version   "1.00"
#property strict

input string ServerBaseUrl   = "http://127.0.0.1:3000";
input string WebhookToken    = "";
input bool   IsMasterRole    = true;
input int    PollIntervalSec = 5;
input int    HttpTimeoutMs   = 5000;
input int    MagicNumber     = 20260822;

#define MAX_TRACKED 500
int    g_prevTicket[MAX_TRACKED];
int    g_prevType[MAX_TRACKED];    // OP_BUY / OP_SELL
double g_prevLots[MAX_TRACKED];
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
   EventSetTimer(MathMax(1, PollIntervalSec));
   if (IsMasterRole)
      PrimeMasterSnapshot();
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
//| HTTP + JSON helpers (identical contract to CopyTradeBridge.mq5)  |
//+------------------------------------------------------------------+
bool HttpRequest(string method, string path, string body, string &response)
{
   string headers = "Content-Type: application/json\r\nX-Webhook-Token: " + WebhookToken + "\r\n";
   char postData[];
   if (StringLen(body) > 0)
   {
      int len = StringToCharArray(body, postData, 0, StringLen(body), CP_UTF8);
      ArrayResize(postData, len - 1);
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

string JsonEscape(string s)
{
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   return s;
}

string JsonStr(string obj, string key)
{
   string needle = "\"" + key + "\":\"";
   int start = StringFind(obj, needle);
   if (start == -1) return "";
   start += StringLen(needle);
   int end = start;
   while (end < StringLen(obj) && StringGetChar(obj, end) != '"')
   {
      if (StringGetChar(obj, end) == '\\') end++;
      end++;
   }
   return StringSubstr(obj, start, end - start);
}

bool JsonIsNull(string obj, string key)
{
   return StringFind(obj, "\"" + key + "\":null") != -1;
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
      int c = StringGetChar(obj, end);
      if (c == ',' || c == '}') break;
      end++;
   }
   return StrToDouble(StringSubstr(obj, start, end - start));
}

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
      int c = StringGetChar(inner, i);
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

//+------------------------------------------------------------------+
//| Master role                                                       |
//+------------------------------------------------------------------+
string SideOf(int orderType) { return orderType == OP_BUY ? "buy" : "sell"; }

void PrimeMasterSnapshot()
{
   g_prevCount = 0;
   for (int i = 0; i < OrdersTotal() && g_prevCount < MAX_TRACKED; i++)
   {
      if (!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if (OrderType() != OP_BUY && OrderType() != OP_SELL) continue; // skip pending orders
      g_prevTicket[g_prevCount] = OrderTicket();
      g_prevType[g_prevCount]   = OrderType();
      g_prevLots[g_prevCount]   = OrderLots();
      g_prevSl[g_prevCount]     = OrderStopLoss();
      g_prevTp[g_prevCount]     = OrderTakeProfit();
      g_prevCount++;
   }
   Print("CopyTradeBridge: primed with ", g_prevCount, " pre-existing position(s) - won't re-announce these as new.");
}

int FindPrev(int ticket)
{
   for (int i = 0; i < g_prevCount; i++)
      if (g_prevTicket[i] == ticket) return i;
   return -1;
}

string BuildTradeEventJson(string eventType, string symbol, string side, double lots, double price,
                            double sl, double tp, int ticket)
{
   string json = "{";
   json += "\"eventType\":\"" + eventType + "\",";
   json += "\"symbol\":\"" + JsonEscape(symbol) + "\",";
   if (StringLen(side) > 0) json += "\"side\":\"" + side + "\",";
   if (eventType != "position_closed") json += "\"size\":" + DoubleToString(lots, 2) + ",";
   json += "\"price\":" + DoubleToString(price, Digits) + ",";
   json += "\"sl\":" + (sl > 0 ? DoubleToString(sl, Digits) : "null") + ",";
   json += "\"tp\":" + (tp > 0 ? DoubleToString(tp, Digits) : "null") + ",";
   json += "\"externalPositionId\":\"" + IntegerToString(ticket) + "\"";
   json += "}";
   return json;
}

void PostTradeEvent(string eventType, string symbol, string side, double lots, double price,
                     double sl, double tp, int ticket)
{
   string body = BuildTradeEventJson(eventType, symbol, side, lots, price, sl, tp, ticket);
   string response;
   if (HttpRequest("POST", "/api/webhook/trade", body, response))
      Print("CopyTradeBridge: reported ", eventType, " for ticket ", ticket, " -> ", response);
}

void MasterTick()
{
   int    curTicket[MAX_TRACKED];
   int    curType[MAX_TRACKED];
   double curLots[MAX_TRACKED];
   double curSl[MAX_TRACKED];
   double curTp[MAX_TRACKED];
   int    curCount = 0;

   for (int i = 0; i < OrdersTotal() && curCount < MAX_TRACKED; i++)
   {
      if (!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if (OrderType() != OP_BUY && OrderType() != OP_SELL) continue;

      int    ticket = OrderTicket();
      string symbol = OrderSymbol();
      string side   = SideOf(OrderType());
      double lots   = OrderLots();
      double sl     = OrderStopLoss();
      double tp     = OrderTakeProfit();
      double openPx = OrderOpenPrice();

      curTicket[curCount] = ticket;
      curType[curCount]   = OrderType();
      curLots[curCount]   = lots;
      curSl[curCount]     = sl;
      curTp[curCount]     = tp;
      curCount++;

      int prevIdx = FindPrev(ticket);
      if (prevIdx == -1)
      {
         PostTradeEvent("position_opened", symbol, side, lots, openPx, sl, tp, ticket);
      }
      else if (g_prevType[prevIdx] != OrderType() || g_prevLots[prevIdx] != lots ||
               g_prevSl[prevIdx] != sl || g_prevTp[prevIdx] != tp)
      {
         PostTradeEvent("position_modified", symbol, side, lots, openPx, sl, tp, ticket);
      }
   }

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
   ArrayCopy(g_prevType, curType, 0, 0, curCount);
   ArrayCopy(g_prevLots, curLots, 0, 0, curCount);
   ArrayCopy(g_prevSl, curSl, 0, 0, curCount);
   ArrayCopy(g_prevTp, curTp, 0, 0, curCount);
}

//+------------------------------------------------------------------+
//| Follower role                                                     |
//+------------------------------------------------------------------+
int OpenFollowerPosition(string symbol, string side, double lots)
{
   RefreshRates();
   int type = side == "buy" ? OP_BUY : OP_SELL;
   double price = side == "buy" ? MarketInfo(symbol, MODE_ASK) : MarketInfo(symbol, MODE_BID);
   int ticket = OrderSend(symbol, type, lots, price, 3, 0, 0, "copytrade", MagicNumber, 0, clrNONE);
   if (ticket < 0)
      Print("CopyTradeBridge: open failed, error=", GetLastError());
   return ticket;
}

bool ModifyFollowerPosition(int ticket, double sl, double tp)
{
   if (!OrderSelect(ticket, SELECT_BY_TICKET))
   {
      Print("CopyTradeBridge: modify target ticket not found locally: ", ticket);
      return false;
   }
   double newSl = sl > 0 ? sl : OrderStopLoss();
   double newTp = tp > 0 ? tp : OrderTakeProfit();
   bool ok = OrderModify(ticket, OrderOpenPrice(), newSl, newTp, 0, clrNONE);
   if (!ok) Print("CopyTradeBridge: modify failed, error=", GetLastError());
   return ok;
}

bool CloseFollowerPosition(int ticket)
{
   if (!OrderSelect(ticket, SELECT_BY_TICKET))
   {
      Print("CopyTradeBridge: close target ticket not found locally (already closed?): ", ticket);
      return true;
   }
   RefreshRates();
   string symbol = OrderSymbol();
   double price = OrderType() == OP_BUY ? MarketInfo(symbol, MODE_BID) : MarketInfo(symbol, MODE_ASK);
   bool ok = OrderClose(ticket, OrderLots(), price, 3, clrNONE);
   if (!ok) Print("CopyTradeBridge: close failed, error=", GetLastError());
   return ok;
}

void ReportResult(string executionId, bool success, int resultPositionId, string errorMessage)
{
   string body = "{\"status\":\"" + (success ? "executed" : "failed") + "\"";
   if (success && resultPositionId > 0)
      body += ",\"resultPositionId\":\"" + IntegerToString(resultPositionId) + "\"";
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
      int    targetId    = targetIdStr == "" ? 0 : (int)StrToInteger(targetIdStr);

      if (executionId == "") continue;

      if (action == "open")
      {
         int newTicket = OpenFollowerPosition(symbol, side, size);
         ReportResult(executionId, newTicket > 0, newTicket, newTicket <= 0 ? "open failed" : "");
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
