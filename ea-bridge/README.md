# MT4/MT5 EA Bridge

MT4 and MT5 have no server-reachable trading API (unlike TradeLocker's REST
`/trade/*` endpoints), so an MT4/MT5 account can only be traded by an Expert
Advisor running inside that terminal. This directory has a reference EA for
each platform (`CopyTradeBridge.mq4`, `CopyTradeBridge.mq5`) that speaks the
same HTTP contract the backend already exposes and that this session verified
end-to-end (both a real-Postgres integration test and a live HTTP round trip
against a running server - see `__smoketest_bridge.js`).

One EA, two roles, chosen by the `IsMasterRole` input:

## Master role (push)

Attach to the account you want copied *from*. Each timer tick it diffs open
positions against the previous tick and `POST`s any open/modify/close to:

```
POST /api/webhook/trade
X-Webhook-Token: <the account's webhook token>
Content-Type: application/json

{
  "eventType": "position_opened" | "position_modified" | "position_closed",
  "symbol": "EURUSD",
  "side": "buy" | "sell",      // omitted for position_closed
  "size": 1.0,                  // omitted for position_closed
  "price": 1.085,
  "sl": 1.08,                   // or null
  "tp": 1.095,                  // or null
  "externalPositionId": "123456789"   // this platform's ticket number
}
```

This is the exact same endpoint TradeLocker's master side reaches via the
poller - the copy engine doesn't care which platform an event came from.

## Follower role (poll)

Attach to the account you want copied *to*. Each timer tick it polls for
queued commands and reports back what happened:

```
GET /api/ea/commands
X-Webhook-Token: <the account's webhook token>

-> { "commands": [
     { "executionId": "...", "action": "open"|"close"|"modify",
       "symbol": "EURUSD", "size": 0.3, "side": "buy",
       "sl": 1.08, "tp": 1.095,               // null for "open"/"close"
       "targetPositionId": "MT5-500" }        // null for "open"
   ] }
```

The poll atomically claims what it returns (status flips `pending` ->
`dispatched`), so a retried poll never hands out the same command twice.
After executing a command locally:

```
POST /api/ea/commands/<executionId>/result
X-Webhook-Token: <the account's webhook token>
Content-Type: application/json

{ "status": "executed", "resultPositionId": "500" }   // "open" -> this account's new ticket
{ "status": "executed" }                                // "close"/"modify" -> ticket omitted
{ "status": "failed", "errorMessage": "..." }
```

`resultPositionId` from an `open` is what later `modify`/`close` commands for
that same master position will carry as `targetPositionId`.

## Setup

1. In the platform: `POST /api/broker-accounts` with `platform: "mt4"` or
   `"mt5"` and `role: "master"` or `"follower"`. The response's
   `webhookToken` is shown once - copy it into the EA's `WebhookToken` input.
2. Create a `trade_copy_relationships` row linking the two accounts:
   `POST /api/copy-relationships`.
3. In MetaTrader: **Tools > Options > Expert Advisors**, add your server's
   base URL under "Allow WebRequest for listed URL". `WebRequest` refuses any
   host not on that list.
4. Compile the matching `.mq4`/`.mq5` file in MetaEditor, attach it to the
   master account's chart with `IsMasterRole=true`, and to the follower
   account's chart with `IsMasterRole=false`. Enable "Allow Algo/Automated
   Trading" on both.

## Status

Written against the platform's verified HTTP contract, but not
compiled/run here - this sandbox has no MetaTrader runtime, the same way it
has no network path to TradeLocker's demo API. Review both files in
MetaEditor's compiler before running on a live or demo account.
