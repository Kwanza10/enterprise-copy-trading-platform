const assert = require('assert');

// Mocked in-memory tables, mirroring __smoketest_idempotency.js's pattern.
const tradeEvents = [];
const executions = [];
const commands = [];

const { Pool } = require('pg');
Pool.prototype.query = async function (text, params = []) {
  const t = text.replace(/\s+/g, ' ').trim();

  if (t.startsWith('INSERT INTO copy_trade_events')) {
    const row = {
      id: params[0], source_account_id: params[1], event_type: params[2], symbol: params[3],
      side: params[4], size: params[5], price: params[6], sl: params[7], tp: params[8],
      external_position_id: params[9], source: params[10], raw_payload: params[11],
      status: 'received', idempotency_key: params[12], received_at: new Date()
    };
    tradeEvents.push(row);
    return { rows: [row] };
  }
  if (t.startsWith('UPDATE copy_trade_events')) return { rowCount: 1 };
  if (t.startsWith('SELECT * FROM copy_trade_events') && t.includes("event_type = 'position_opened'")) {
    const [sourceAccountId, externalPositionId] = params;
    const matches = tradeEvents
      .filter((e) => e.source_account_id === sourceAccountId && e.external_position_id === externalPositionId && e.event_type === 'position_opened')
      .sort((a, b) => b.received_at - a.received_at);
    return { rows: matches.slice(0, 1) };
  }

  if (t.startsWith('SELECT * FROM broker_accounts WHERE id')) {
    const accounts = {
      'master-1': { id: 'master-1', platform: 'tradelocker', status: 'active' },
      'follower-1': { id: 'follower-1', platform: 'mt5', status: 'active', balance: 10000 }
    };
    const row = accounts[params[0]];
    return { rows: row ? [row] : [] };
  }

  if (t.startsWith('INSERT INTO copy_executions')) {
    const row = {
      id: params[0], trade_event_id: params[1], follower_account_id: params[2],
      calculated_size: params[3], mapped_symbol: params[4], result_position_id: null,
      status: 'pending', error_message: null, executed_at: null, created_at: new Date()
    };
    executions.push(row);
    return { rows: [row] };
  }
  if (t.startsWith('SELECT * FROM copy_executions') && t.includes("status = 'executed'")) {
    const [tradeEventId, followerAccountId] = params;
    const row = executions.find((e) => e.trade_event_id === tradeEventId && e.follower_account_id === followerAccountId && e.status === 'executed');
    return { rows: row ? [row] : [] };
  }
  if (t.startsWith('UPDATE copy_executions') && t.includes("status = 'executed'")) {
    const [id, resultPositionId] = params;
    const row = executions.find((e) => e.id === id);
    if (row) { row.status = 'executed'; row.result_position_id = resultPositionId; row.executed_at = new Date(); }
    return { rows: row ? [row] : [] };
  }
  if (t.startsWith('UPDATE copy_executions') && t.includes("status = 'failed'")) {
    const [id, errorMessage] = params;
    const row = executions.find((e) => e.id === id);
    if (row) { row.status = 'failed'; row.error_message = errorMessage; }
    return { rows: row ? [row] : [] };
  }

  if (t.startsWith('INSERT INTO bridge_commands')) {
    const row = {
      id: params[0], execution_id: params[1], follower_account_id: params[2], command_type: params[3],
      symbol: params[4], side: params[5], size: params[6], sl: params[7], tp: params[8],
      target_position_id: params[9], status: 'pending', result_status: null, result_position_id: null,
      error_message: null, created_at: new Date()
    };
    commands.push(row);
    return { rows: [row] };
  }
  if (t.startsWith('UPDATE bridge_commands') && t.includes("status = 'sent'")) {
    const [followerAccountId, limit] = params;
    const claimed = commands
      .filter((c) => c.follower_account_id === followerAccountId && c.status === 'pending')
      .slice(0, limit);
    claimed.forEach((c) => { c.status = 'sent'; c.sent_at = new Date(); });
    return { rows: claimed };
  }
  if (t.startsWith('UPDATE bridge_commands') && t.includes("status = 'acked'")) {
    const [commandId, followerAccountId, resultStatus, resultPositionId, errorMessage] = params;
    const row = commands.find((c) => c.id === commandId && c.follower_account_id === followerAccountId && c.status !== 'acked');
    if (row) {
      row.status = 'acked'; row.result_status = resultStatus;
      row.result_position_id = resultPositionId; row.error_message = errorMessage; row.acked_at = new Date();
    }
    return { rows: row ? [row] : [] };
  }

  throw new Error('Unmocked query: ' + t);
};

const copyRelationshipService = require('./src/services/copyRelationshipService');
copyRelationshipService.getActiveRelationshipsForMaster = async () => [
  { id: 'rel-1', masterAccountId: 'master-1', followerAccountId: 'follower-1', followerUserId: 'user-1', riskMode: 'fixed_lot', riskValue: 0.1, enabled: true, status: 'active' }
];

const symbolMappingService = require('./src/services/symbolMappingService');
symbolMappingService.resolveSymbol = async ({ sourceSymbol }) => sourceSymbol;

async function run() {
  const copyEngine = require('./src/services/copyEngine');
  const mtBridgeService = require('./src/services/mtBridgeService');

  // 1. Master opens a position -> should enqueue an 'open' bridge command for
  //    the mt5 follower, and leave the execution 'pending' (not executed) -
  //    dispatchToMtBridge never calls markExecuted itself.
  await copyEngine.processTradeEvent({
    sourceAccountId: 'master-1', eventType: 'position_opened', symbol: 'EURUSD',
    side: 'buy', size: 1.0, price: 1.085, sl: 1.08, tp: 1.09,
    externalPositionId: 'MT-P1', source: 'webhook', rawPayload: {}
  });

  assert.strictEqual(commands.length, 1, 'one open command should be queued');
  assert.strictEqual(commands[0].command_type, 'open');
  assert.strictEqual(commands[0].status, 'pending');
  const openExecution = executions.find((e) => e.id === commands[0].execution_id);
  assert.strictEqual(openExecution.status, 'pending', 'execution stays pending until the EA acks');
  console.log('position_opened queues an open command for mt5 follower, execution left pending: OK');

  // 2. EA polls -> command should be claimed (marked 'sent'), not re-claimable.
  const claimed = await mtBridgeService.claimPendingCommands('follower-1');
  assert.strictEqual(claimed.length, 1);
  assert.strictEqual(claimed[0].status, 'sent');
  const secondPoll = await mtBridgeService.claimPendingCommands('follower-1');
  assert.strictEqual(secondPoll.length, 0, 'an already-claimed command must not be handed out twice');
  console.log('EA poll claims the command exactly once: OK');

  // 3. EA acks with the new MT ticket -> execution becomes executed with that ticket.
  const ackedCommand = await mtBridgeService.ackCommand({
    commandId: claimed[0].id, followerAccountId: 'follower-1',
    resultStatus: 'executed', resultPositionId: 'MT5-TICKET-999', errorMessage: null
  });
  assert.strictEqual(ackedCommand.status, 'acked');
  // Simulate what the route does after ackCommand succeeds.
  const execRow = executions.find((e) => e.id === ackedCommand.executionId);
  execRow.status = 'executed';
  execRow.result_position_id = ackedCommand.resultPositionId || ackedCommand.targetPositionId;
  assert.strictEqual(execRow.result_position_id, 'MT5-TICKET-999');
  console.log('EA ack finalizes the execution with the reported ticket: OK');

  // 4. Master modifies SL/TP -> should enqueue a 'modify' command targeting
  //    that same ticket, not a new order.
  await copyEngine.processTradeEvent({
    sourceAccountId: 'master-1', eventType: 'position_modified', symbol: 'EURUSD',
    side: 'buy', size: 1.0, price: 1.085, sl: 1.081, tp: 1.095,
    externalPositionId: 'MT-P1', source: 'poll', rawPayload: {}
  });
  const modifyCommand = commands.find((c) => c.command_type === 'modify');
  assert.ok(modifyCommand, 'a modify command should have been queued');
  assert.strictEqual(modifyCommand.target_position_id, 'MT5-TICKET-999', 'modify must target the existing follower ticket, not open a new one');
  assert.strictEqual(modifyCommand.sl, 1.081);
  assert.strictEqual(modifyCommand.tp, 1.095);
  console.log('position_modified queues a modify command targeting the existing ticket: OK');

  // 5. Master closes the position -> should enqueue a 'close' command
  //    targeting the same ticket.
  await copyEngine.processTradeEvent({
    sourceAccountId: 'master-1', eventType: 'position_closed', symbol: 'EURUSD',
    side: 'buy', size: 1.0, price: 1.09, sl: null, tp: null,
    externalPositionId: 'MT-P1', source: 'poll', rawPayload: {}
  });
  const closeCommand = commands.find((c) => c.command_type === 'close');
  assert.ok(closeCommand, 'a close command should have been queued');
  assert.strictEqual(closeCommand.target_position_id, 'MT5-TICKET-999');
  console.log('position_closed queues a close command targeting the existing ticket: OK');

  console.log('\nALL MT BRIDGE TESTS PASSED');
}

run().catch((err) => { console.error('TEST FAILED:', err); process.exit(1); });
