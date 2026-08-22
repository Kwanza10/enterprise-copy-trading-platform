// Smoke test for the TradeLocker "copies everything" gap: a position_modified
// event's size is the master's CURRENT size (not a delta) - the poller
// flags a partial close or an add-on trade the same way it flags an SL/TP
// change (both 'position_modified', see tradeLockerPoller.positionHash).
// Before this fix, dispatchToTradeLocker's modify branch only ever touched
// SL/TP and silently dropped any size change.
//
// Uses the real local Postgres for broker_accounts/relationships/events
// (same pattern as __smoketest_bridge.js), but mocks tradeLockerService's
// actual TradeLocker API calls, since this sandbox has no network path to
// TradeLocker (see the network-policy blocker discussed earlier in this
// session) - authenticate/executeTrade/closePosition/modifyPosition are
// replaced with recording stubs before copyEngine is required, which is
// safe because copyEngine calls them via `tradeLockerService.<fn>(...)`
// property access (not destructured), and require() caching means it's
// patching the exact object copyEngine already imported.
require('dotenv').config();
const assert = require('assert');
const crypto = require('crypto');
const db = require('./src/lib/db');
const brokerAccountService = require('./src/services/brokerAccountService');
const copyRelationshipService = require('./src/services/copyRelationshipService');
const tradeLockerService = require('./src/services/tradeLockerService');

const calls = { executeTrade: [], closePosition: [], modifyPosition: [] };
let nextFollowerTicket = 1;

tradeLockerService.authenticate = async () => ({ accessToken: 'mock', baseUrl: 'mock', expireDate: Date.now() + 60000 });
tradeLockerService.executeTrade = async (args) => {
  calls.executeTrade.push({ symbol: args.symbol, action: args.action, size: args.size, stopLoss: args.stopLoss, takeProfit: args.takeProfit });
  return { positionId: `TL-F-${nextFollowerTicket++}` };
};
tradeLockerService.closePosition = async (session, args) => {
  calls.closePosition.push({ positionId: args.positionId, qty: args.qty });
  return {};
};
tradeLockerService.modifyPosition = async (session, args) => {
  calls.modifyPosition.push({ positionId: args.positionId, stopLoss: args.stopLoss, takeProfit: args.takeProfit });
  return {};
};

// copyEngine must be required AFTER the mocks above are in place.
const copyEngine = require('./src/services/copyEngine');

const cleanupAccountIds = [];
const cleanupUserIds = [];

async function makeUser() {
  const id = crypto.randomUUID();
  await db.query(`INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, 'x', 'trader')`, [
    id,
    `resize-smoketest-${id}@example.com`
  ]);
  cleanupUserIds.push(id);
  return id;
}

async function makeAccount(userId, role) {
  const { account } = await brokerAccountService.createBrokerAccount({
    userId,
    platform: 'tradelocker',
    role,
    label: `resize-smoketest-tradelocker-${role}`,
    environment: 'demo',
    credentials: { email: 'x@example.com', password: 'x', server: 'Demo', accountId: '1', accNum: 1 },
    balance: 10000
  });
  cleanupAccountIds.push(account.id);
  return account;
}

async function cleanup() {
  if (cleanupAccountIds.length) {
    await db.query(`DELETE FROM copy_executions WHERE follower_account_id = ANY($1::uuid[])`, [cleanupAccountIds]);
    await db.query(`DELETE FROM copy_trade_events WHERE source_account_id = ANY($1::uuid[])`, [cleanupAccountIds]);
    await db.query(
      `DELETE FROM trade_copy_relationships WHERE master_account_id = ANY($1::uuid[]) OR follower_account_id = ANY($1::uuid[])`,
      [cleanupAccountIds]
    );
    await db.query(`DELETE FROM broker_accounts WHERE id = ANY($1::uuid[])`, [cleanupAccountIds]);
  }
  if (cleanupUserIds.length) {
    await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [cleanupUserIds]);
  }
}

async function getExecution(followerAccountId) {
  const result = await db.query(
    `SELECT * FROM copy_executions WHERE follower_account_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [followerAccountId]
  );
  return result.rows[0];
}

async function run() {
  const userId = await makeUser();

  // --- percent_of_master: follower size must track master's size changes ---
  const master = await makeAccount(userId, 'master');
  const follower = await makeAccount(userId, 'follower');
  await copyRelationshipService.createRelationship({
    masterAccountId: master.id,
    followerAccountId: follower.id,
    followerUserId: userId,
    riskMode: 'percent_of_master',
    riskValue: 50 // follower always trades 50% of master's current size
  });

  // 1. open at master size 2.0 -> follower opens at 1.0
  await copyEngine.processTradeEvent({
    sourceAccountId: master.id,
    eventType: 'position_opened',
    symbol: 'EURUSD',
    side: 'buy',
    size: 2.0,
    price: 1.085,
    externalPositionId: 'TL-M-1',
    source: 'poll',
    rawPayload: {}
  });
  assert.strictEqual(calls.executeTrade.length, 1);
  assert.strictEqual(calls.executeTrade[0].size, 1.0);
  let exec = await getExecution(follower.id);
  assert.strictEqual(exec.status, 'executed');
  assert.strictEqual(Number(exec.calculated_size), 1.0);
  assert.strictEqual(exec.result_position_id, 'TL-F-1');
  console.log('1. open: master 2.0 -> follower opened at 1.0 (50%): OK');

  // 2. master partial-closes down to 1.2 -> follower should partial-close by 0.4 (1.0 -> 0.6)
  await copyEngine.processTradeEvent({
    sourceAccountId: master.id,
    eventType: 'position_modified',
    symbol: 'EURUSD',
    side: 'buy',
    size: 1.2,
    sl: 1.05,
    tp: 1.10,
    externalPositionId: 'TL-M-1',
    source: 'poll',
    rawPayload: {}
  });
  assert.strictEqual(calls.closePosition.length, 1, 'partial close must call closePosition');
  assert.strictEqual(calls.closePosition[0].positionId, 'TL-F-1');
  assert.strictEqual(calls.closePosition[0].qty, 0.4, 'partial close qty must be the follower-side delta, not the master-side delta');
  assert.strictEqual(calls.executeTrade.length, 1, 'a decrease must not also place a new order');
  assert.strictEqual(calls.modifyPosition.length, 1, 'SL/TP must still be synced alongside the resize');
  assert.deepStrictEqual(calls.modifyPosition[0], { positionId: 'TL-F-1', stopLoss: 1.05, takeProfit: 1.10 });
  exec = await getExecution(follower.id); // the modify's own execution row (skipped/executed marker), not the tracked one
  const openExec = await db.query(
    `SELECT * FROM copy_executions WHERE follower_account_id = $1 AND result_position_id = 'TL-F-1' ORDER BY created_at ASC LIMIT 1`,
    [follower.id]
  );
  assert.strictEqual(Number(openExec.rows[0].calculated_size), 0.6, 'tracked follower size must be updated after the partial close');
  console.log('2. partial close: master 2.0 -> 1.2 -> follower partial-closed 1.0 -> 0.6 (qty=0.4), SL/TP still synced: OK');

  // 3. master adds back up to 3.0 -> follower must NOT place an add-on order.
  // TradeLocker's official Python SDK confirms same-direction orders don't
  // merge into an existing position (create_order's position_netting flag
  // defaults to False, and even then only nets *opposite*-side exposure) -
  // an add-on order here would open a second, untracked position that never
  // gets closed later. SL/TP must still sync; size must NOT change.
  await copyEngine.processTradeEvent({
    sourceAccountId: master.id,
    eventType: 'position_modified',
    symbol: 'EURUSD',
    side: 'buy',
    size: 3.0,
    sl: 1.05,
    tp: 1.10,
    externalPositionId: 'TL-M-1',
    source: 'poll',
    rawPayload: {}
  });
  assert.strictEqual(calls.executeTrade.length, 1, 'an increase must NOT place an additional order (would orphan an untracked position)');
  assert.strictEqual(calls.closePosition.length, 1, 'an increase must not call closePosition either');
  assert.strictEqual(calls.modifyPosition.length, 2, 'SL/TP must still sync even when the resize itself is skipped');
  const openExec2 = await db.query(
    `SELECT * FROM copy_executions WHERE follower_account_id = $1 AND result_position_id = 'TL-F-1' ORDER BY created_at ASC LIMIT 1`,
    [follower.id]
  );
  assert.strictEqual(Number(openExec2.rows[0].calculated_size), 0.6, 'tracked follower size must stay unchanged when the add-on is skipped');
  console.log('3. add-on: master 1.2 -> 3.0 -> follower size deliberately left at 0.6 (no untracked position opened), SL/TP still synced: OK');

  // 4. close -> full close (qty 0) on the follower's tracked position
  await copyEngine.processTradeEvent({
    sourceAccountId: master.id,
    eventType: 'position_closed',
    symbol: 'EURUSD',
    externalPositionId: 'TL-M-1',
    source: 'poll',
    rawPayload: {}
  });
  assert.strictEqual(calls.closePosition.length, 2);
  assert.deepStrictEqual(calls.closePosition[1], { positionId: 'TL-F-1', qty: 0 });
  console.log('4. close: full close (qty=0) on the tracked follower position: OK');

  // --- fixed_lot: follower size must NOT track master's size changes ---
  // A separate master account, isolated from the percent_of_master
  // relationship above (which is still active) - otherwise firing a new
  // event on the same master would fan out to BOTH followers, which would
  // add its own executeTrade calls and confuse this section's counts.
  const master2 = await makeAccount(userId, 'master');
  const fixedFollower = await makeAccount(userId, 'follower');
  await copyRelationshipService.createRelationship({
    masterAccountId: master2.id,
    followerAccountId: fixedFollower.id,
    followerUserId: userId,
    riskMode: 'fixed_lot',
    riskValue: 0.2
  });

  const beforeExecuteCount = calls.executeTrade.length;
  const beforeCloseCount = calls.closePosition.length;

  await copyEngine.processTradeEvent({
    sourceAccountId: master2.id,
    eventType: 'position_opened',
    symbol: 'GBPUSD',
    side: 'sell',
    size: 1.0,
    externalPositionId: 'TL-M-2',
    source: 'poll',
    rawPayload: {}
  });
  await copyEngine.processTradeEvent({
    sourceAccountId: master2.id,
    eventType: 'position_modified',
    symbol: 'GBPUSD',
    side: 'sell',
    size: 5.0, // master's size changed a lot...
    sl: 1.30,
    tp: 1.20,
    externalPositionId: 'TL-M-2',
    source: 'poll',
    rawPayload: {}
  });

  // ...but a fixed_lot follower always trades exactly riskValue lots, so no
  // resize call should have been made at all - only the SL/TP modify.
  assert.strictEqual(calls.executeTrade.length, beforeExecuteCount + 1, 'fixed_lot: only the original open should have placed an order');
  assert.strictEqual(calls.closePosition.length, beforeCloseCount, 'fixed_lot: a master size change must never trigger a partial close');
  const fixedExec = await db.query(
    `SELECT * FROM copy_executions WHERE follower_account_id = $1 ORDER BY created_at ASC LIMIT 1`,
    [fixedFollower.id]
  );
  assert.strictEqual(Number(fixedExec.rows[0].calculated_size), 0.2, 'fixed_lot size must stay constant despite the master resizing');
  console.log('5. fixed_lot: master size 1.0 -> 5.0 does NOT resize the follower (stays at riskValue): OK');

  // 6. master opens WITH SL/TP already set -> follower's opening order must
  // carry them too, not open unprotected until some later modify event.
  await copyEngine.processTradeEvent({
    sourceAccountId: master2.id,
    eventType: 'position_opened',
    symbol: 'XAUUSD',
    side: 'buy',
    size: 1.0,
    sl: 2300,
    tp: 2400,
    externalPositionId: 'TL-M-3',
    source: 'poll',
    rawPayload: {}
  });
  const openWithStops = calls.executeTrade[calls.executeTrade.length - 1];
  assert.strictEqual(openWithStops.stopLoss, 2300, "master's SL at open must be carried onto the follower's opening order");
  assert.strictEqual(openWithStops.takeProfit, 2400, "master's TP at open must be carried onto the follower's opening order");
  console.log('6. open with SL/TP already set on master: follower opening order carries stopLoss=2300, takeProfit=2400: OK');

  console.log('\nALL TRADELOCKER RESIZE TESTS PASSED');
}

run()
  .catch((err) => {
    console.error('TEST FAILED:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await db.getPool().end();
  });
