# MT4/MT5 Copy-Trade Bridge EA

These two Expert Advisors let an MT4 or MT5 account participate in the copy-trading
platform as a master, a follower, or both - without any TradingView webhook, and
without any paid third-party bridge service. MetaTrader has no cloud API of its own,
so this EA is the thing that has to be running inside the terminal, on whatever
machine keeps that terminal open.

- `CopyTradeBridge_MT5.mq5` - for MT5 accounts
- `CopyTradeBridge_MT4.mq4` - for MT4 accounts

Both speak the exact same protocol to the same backend endpoints, so a
TradeLocker↔MT5, MT4↔MT5, or any other combination all just work once each side
has the right EA attached.

**Status: written but not yet run against a live terminal** (this was built without
access to a MetaTrader environment to compile/test in). Treat it as a first draft -
compile it, read through any compiler warnings, and run it on a demo account first.

## What it does

- **As a master:** every few seconds (`InpPollSeconds`), it checks this account's
  open positions and reports any new position, closed position, or SL/TP/trailing-stop
  change to the backend's existing webhook endpoint - the same one any other bridge
  (or a future NinjaTrader EA) would use.
- **As a follower:** on the same timer, it asks the backend "anything for me to do?",
  executes whatever it's told (open/close/modify), and reports back what happened.
  MetaTrader can't accept inbound connections, so this poll-then-report pattern is
  the only way the backend can reach it - this is the standard approach used by
  essentially every free/open-source MT4/5 trade-copier EA.
- **As both:** turn on both `InpActAsMaster` and `InpActAsFollower` on the same
  account if it needs to do both (e.g. it copies from someone else and is also
  copied by others).

## One-time setup, per terminal

1. Open **Tools → Options → Expert Advisors** and check **"Allow WebRequest for
   listed URL"**. Add your backend's base URL (e.g. `https://yourdomain.com`) to the
   list. This step is required - without it, every request the EA makes will fail
   with a WebRequest error in the Experts log.
2. Make sure **AutoTrading / Algo Trading** is enabled (the button in the toolbar).
3. Drag the compiled EA onto a chart for the account you want to bridge. In the
   **Common** tab of the EA's settings, check **"Allow live trading"**.
4. In the **Inputs** tab, set:
   - `InpServerBaseUrl` - your backend's base URL, no trailing slash.
   - `InpWebhookToken` - this specific account's webhook token (issued when the
     broker account was created via `POST /api/broker-accounts` - the platform
     admin/user needs to have this account already registered there).
   - `InpActAsMaster` / `InpActAsFollower` - per this account's role.
5. Check the **Experts** log tab after attaching - on success you'll see a
   `"primed N pre-existing position(s)"` line if acting as master.

## Symbol names

MT4/5 brokers often suffix symbols (`EURUSDm`, `EURUSD.a`, etc.). The EA sends
whatever the broker's own symbol name is - use the platform's symbol-mapping
feature (`/api/symbol-mappings`) to translate between a master's and a follower's
naming, the same way it already does for TradeLocker.

## Combined master + follower on one account

If `InpActAsMaster` and `InpActAsFollower` are both on for the same account, a
trade this EA places on behalf of a *follower* command would otherwise look, on
the very next timer tick, like a brand-new position to open and get reported
right back out as if the account itself had opened it. The master-side diffing
filters these out by `InpMagicNumber` (every order this EA places is tagged with
it), so this loop doesn't happen - just make sure `InpMagicNumber` is left at its
default or set to something unique per EA instance if you're running more than
one on the same terminal.
