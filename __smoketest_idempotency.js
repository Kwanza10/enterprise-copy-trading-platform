const assert = require('assert');

const events = [];
const { Pool } = require('pg');
Pool.prototype.query = async function (text, params = []) {
  const t = text.replace(/\s+/g, ' ').trim();

  if (t.startsWith('INSERT INTO copy_trade_events')) {
    const idempotencyKey = params[12];
    if (events.some((e) => e.idempotency_key === idempotencyKey)) {
      return { rows: [] }; // simulates ON CONFLICT (idempotency_key) DO NOTHING
    }
    const row = {
      id: params[0], source_account_id: params[1], event_type: params[2], symbol: params[3],
      side: params[4], size: params[5], price: params[6], sl: params[7], tp: params[8],
      external_position_id: params[9], source: params[10], raw_payload: params[11],
      status: 'received', idempotency_key: idempotencyKey, received_at: new Date()
    };
    events.push(row);
    return { rows: [row] };
  }
  if (t.startsWith('UPDATE copy_trade_events')) return { rowCount: 1 };
  if (t.startsWith('SELECT * FROM broker_accounts WHERE id')) return { rows: [] }; // forces early-return path, fan-out never reached in this test anyway if duplicate short-circuits first
  throw new Error('Unmocked query: ' + t);
};

let fanOutCalled = false;
const copyRelationshipService = require('./src/services/copyRelationshipService');
copyRelationshipService.getActiveRelationshipsForMaster = async () => { fanOutCalled = true; return []; };

async function run() {
  const tradeEventService = require('./src/services/tradeEventService');
  const copyEngine = require('./src/services/copyEngine');

  const basePayload = {
    sourceAccountId: 'acct-1', eventType: 'position_opened', symbol: 'EURUSD',
    side: 'buy', size: 0.1, price: 1.085, sl: null, tp: null,
    externalPositionId: 'MT-P1', source: 'webhook', rawPayload: {}
  };

  // 1. First delivery: real insert
  const first = await tradeEventService.createTradeEvent(basePayload);
  assert.strictEqual(first.isDuplicate, false);
  assert.strictEqual(events.length, 1);
  console.log('first delivery inserts a real row: OK');

  // 2. Exact retry (same payload) -> detected as duplicate, no new row
  const retry = await tradeEventService.createTradeEvent({ ...basePayload });
  assert.strictEqual(retry.isDuplicate, true);
  assert.strictEqual(events.length, 1, 'retry must not create a second row');
  console.log('retried delivery (identical payload) detected as duplicate, no second row: OK');

  // 3. A legitimately different event for the same position (SL changed) -> NOT treated as duplicate
  const modified = await tradeEventService.createTradeEvent({ ...basePayload, eventType: 'position_modified', sl: 1.08 });
  assert.strictEqual(modified.isDuplicate, false, 'a genuinely different modification must not be blocked');
  assert.strictEqual(events.length, 2);
  console.log('legitimately different modification (different SL) is NOT blocked: OK');

  // 4. copyEngine.processTradeEvent: duplicate must short-circuit BEFORE fan-out, not just get logged after
  fanOutCalled = false;
  await copyEngine.processTradeEvent({ ...basePayload }); // exact repeat of #1/#2 payload again
  assert.strictEqual(fanOutCalled, false, 'copyEngine must skip relationship fan-out entirely for a duplicate');
  console.log('copyEngine skips follower fan-out for a duplicate event: OK');

  // 5. Sanity: a genuinely new (non-duplicate) event DOES reach fan-out
  fanOutCalled = false;
  await copyEngine.processTradeEvent({ ...basePayload, externalPositionId: 'MT-P2' });
  assert.strictEqual(fanOutCalled, true, 'a real new event must still reach fan-out');
  console.log('copyEngine still processes a genuinely new event normally: OK');

  console.log('\nALL IDEMPOTENCY TESTS PASSED');
}

run().catch((err) => { console.error('TEST FAILED:', err); process.exit(1); });
