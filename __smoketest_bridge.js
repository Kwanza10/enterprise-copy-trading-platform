// Integration smoke test for the MT4/MT5 EA command bridge added in
// copyEngine.js / copyExecutionService.js / routes/ea.js. Runs against a
// real local Postgres (uses the same DB_* env as the app - see .env), not a
// mock, since the new claimPendingForFollower query relies on real
// SKIP LOCKED / FOR UPDATE semantics that are hard to fake faithfully.
//
// Exercises, end to end at the service layer (no HTTP):
//   1. master (mt4) opens -> follower (mt5) gets a queued 'open' command
//   2. EA polls (claims) it, reports back a result ticket -> execution 'executed'
//   3. master modifies SL/TP -> follower gets a queued 'modify' command
//      targeting that same result ticket (never a fresh 'open')
//   4. master closes -> follower gets a queued 'close' command, same target
//   5. a modify/close for a position with no matching open follower copy is
//      skipped immediately, never reaches the EA's queue
//   6. an unsupported platform (ninjatrader) still hits the pre-existing stub
//   7. reportBridgeResult rejects a second report for an already-settled command
require('dotenv').config();
const assert = require('assert');
const crypto = require('crypto');
const db = require('./src/lib/db');
const brokerAccountService = require('./src/services/brokerAccountService');
const copyRelationshipService = require('./src/services/copyRelationshipService');
const copyExecutionService = require('./src/services/copyExecutionService');
const copyEngine = require('./src/services/copyEngine');

const cleanupAccountIds = [];
const cleanupUserIds = [];

async function makeUser() {
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, 'x', 'trader')`,
    [id, `bridge-smoketest-${id}@example.com`]
  );
  cleanupUserIds.push(id);
  return id;
}

async function makeAccount(userId, platform, role) {
  const { account } = await brokerAccountService.createBrokerAccount({
    userId,
    platform,
    role,
    label: `smoketest-${platform}-${role}`,
    environment: 'demo',
    credentials: { login: '12345', password: 'x', server: 'Demo-Server' },
    balance: 10000
  });
  cleanupAccountIds.push(account.id);
  return account;
}

async function cleanup() {
  if (cleanupAccountIds.length) {
    await db.query(
      `DELETE FROM copy_executions WHERE follower_account_id = ANY($1::uuid[])`,
      [cleanupAccountIds]
    );
    await db.query(
      `DELETE FROM copy_trade_events WHERE source_account_id = ANY($1::uuid[])`,
      [cleanupAccountIds]
    );
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

async function run() {
  const userId = await makeUser();
  const master = await makeAccount(userId, 'mt4', 'master');
  const follower = await makeAccount(userId, 'mt5', 'follower');
  await copyRelationshipService.createRelationship({
    masterAccountId: master.id,
    followerAccountId: follower.id,
    followerUserId: userId,
    riskMode: 'fixed_lot',
    riskValue: 0.5
  });

  // 1. open
  await copyEngine.processTradeEvent({
    sourceAccountId: master.id,
    eventType: 'position_opened',
    symbol: 'EURUSD',
    side: 'buy',
    size: 1.0,
    price: 1.085,
    sl: null,
    tp: null,
    externalPositionId: 'MT4-100',
    source: 'webhook',
    rawPayload: {}
  });

  let claimed = await copyExecutionService.claimPendingForFollower(follower.id);
  assert.strictEqual(claimed.length, 1, 'expected one queued open command');
  assert.strictEqual(claimed[0].action, 'open');
  assert.strictEqual(claimed[0].symbol, 'EURUSD');
  assert.strictEqual(claimed[0].side, 'buy');
  assert.strictEqual(claimed[0].size, 0.5, 'fixed_lot riskValue should be used as-is');
  assert.strictEqual(claimed[0].targetPositionId, null, 'open has no pre-existing target position');
  console.log('1. master mt4 open -> follower mt5 queued open command: OK');

  // Second poll before a result is reported must not re-deliver the same command.
  const secondPoll = await copyExecutionService.claimPendingForFollower(follower.id);
  assert.strictEqual(secondPoll.length, 0, 'a dispatched command must not be claimed again');
  console.log('   re-poll before result does not re-deliver the claimed command: OK');

  await copyExecutionService.reportBridgeResult(claimed[0].executionId, follower.id, {
    status: 'executed',
    resultPositionId: 'MT5-500'
  });
  console.log('2. EA reports executed with local ticket MT5-500: OK');

  // 3. modify
  await copyEngine.processTradeEvent({
    sourceAccountId: master.id,
    eventType: 'position_modified',
    symbol: 'EURUSD',
    side: 'buy',
    size: 1.0,
    price: 1.085,
    sl: 1.08,
    tp: 1.095,
    externalPositionId: 'MT4-100',
    source: 'webhook',
    rawPayload: {}
  });

  claimed = await copyExecutionService.claimPendingForFollower(follower.id);
  assert.strictEqual(claimed.length, 1);
  assert.strictEqual(claimed[0].action, 'modify');
  assert.strictEqual(claimed[0].targetPositionId, 'MT5-500', 'modify must target the earlier opened position, not create a new one');
  assert.strictEqual(claimed[0].sl, 1.08);
  assert.strictEqual(claimed[0].tp, 1.095);
  await copyExecutionService.reportBridgeResult(claimed[0].executionId, follower.id, {
    status: 'executed',
    resultPositionId: 'MT5-500'
  });
  console.log('3. master modifies SL/TP -> follower queued modify against MT5-500 (in place, not reopened): OK');

  // 4. close
  await copyEngine.processTradeEvent({
    sourceAccountId: master.id,
    eventType: 'position_closed',
    symbol: 'EURUSD',
    externalPositionId: 'MT4-100',
    source: 'webhook',
    rawPayload: {}
  });

  claimed = await copyExecutionService.claimPendingForFollower(follower.id);
  assert.strictEqual(claimed.length, 1);
  assert.strictEqual(claimed[0].action, 'close');
  assert.strictEqual(claimed[0].targetPositionId, 'MT5-500');
  const closeExecutionId = claimed[0].executionId;
  await copyExecutionService.reportBridgeResult(closeExecutionId, follower.id, { status: 'executed' });
  console.log('4. master closes -> follower queued close against MT5-500: OK');

  // 7. a second report on the same (now-executed) command must be rejected
  await assert.rejects(
    () => copyExecutionService.reportBridgeResult(closeExecutionId, follower.id, { status: 'executed' }),
    (err) => err.statusCode === 409,
    'reporting twice on a settled command should be rejected with 409'
  );
  console.log('7. duplicate result report on an already-settled command is rejected: OK');

  // 5. modify/close with no matching open follower position is skipped immediately
  await copyEngine.processTradeEvent({
    sourceAccountId: master.id,
    eventType: 'position_modified',
    symbol: 'EURUSD',
    side: 'buy',
    size: 1.0,
    sl: 1.1,
    tp: 1.2,
    externalPositionId: 'MT4-DOES-NOT-EXIST',
    source: 'webhook',
    rawPayload: {}
  });
  claimed = await copyExecutionService.claimPendingForFollower(follower.id);
  assert.strictEqual(claimed.length, 0, 'a modify for an unknown position must never reach the EA queue');
  console.log('5. modify for a position with no matching open follower copy is skipped, not queued: OK');

  // 6. unsupported platform follower still hits the pre-existing stub path
  const ninjaFollower = await makeAccount(userId, 'ninjatrader', 'follower');
  await copyRelationshipService.createRelationship({
    masterAccountId: master.id,
    followerAccountId: ninjaFollower.id,
    followerUserId: userId,
    riskMode: 'fixed_lot',
    riskValue: 0.5
  });
  await copyEngine.processTradeEvent({
    sourceAccountId: master.id,
    eventType: 'position_opened',
    symbol: 'GBPUSD',
    side: 'sell',
    size: 1.0,
    externalPositionId: 'MT4-200',
    source: 'webhook',
    rawPayload: {}
  });
  const ninjaExec = await db.query(
    `SELECT * FROM copy_executions WHERE follower_account_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [ninjaFollower.id]
  );
  assert.strictEqual(ninjaExec.rows[0].status, 'skipped');
  assert.ok(ninjaExec.rows[0].error_message.startsWith('Stub:'), 'unsupported platforms should still hit the stub message');
  console.log('6. unsupported platform (ninjatrader) still uses the stub-and-skip path unchanged: OK');

  console.log('\nALL MT4/5 BRIDGE TESTS PASSED');
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
