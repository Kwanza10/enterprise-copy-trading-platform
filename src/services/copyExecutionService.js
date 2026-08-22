const crypto = require('crypto');
const db = require('../lib/db');

function toDTO(row) {
  return {
    id: row.id,
    tradeEventId: row.trade_event_id,
    followerAccountId: row.follower_account_id,
    calculatedSize: row.calculated_size === null ? null : Number(row.calculated_size),
    mappedSymbol: row.mapped_symbol,
    resultPositionId: row.result_position_id,
    status: row.status,
    errorMessage: row.error_message,
    executedAt: row.executed_at,
    createdAt: row.created_at
  };
}

async function createExecution({ tradeEventId, followerAccountId, calculatedSize, mappedSymbol }) {
  const id = crypto.randomUUID();
  const result = await db.query(
    `INSERT INTO copy_executions (id, trade_event_id, follower_account_id, calculated_size, mapped_symbol, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')
     RETURNING *`,
    [id, tradeEventId, followerAccountId, calculatedSize, mappedSymbol]
  );
  return toDTO(result.rows[0]);
}

async function markExecuted(id, resultPositionId) {
  const result = await db.query(
    `UPDATE copy_executions SET status = 'executed', executed_at = NOW(), result_position_id = $2 WHERE id = $1 RETURNING *`,
    [id, resultPositionId || null]
  );
  return toDTO(result.rows[0]);
}

// Finds the follower's opened position for a given master trade event, so a
// later position_closed event for the same master position can be mirrored.
async function findExecutedForTradeEvent(tradeEventId, followerAccountId) {
  const result = await db.query(
    `SELECT * FROM copy_executions
     WHERE trade_event_id = $1 AND follower_account_id = $2 AND status = 'executed'
     LIMIT 1`,
    [tradeEventId, followerAccountId]
  );
  return result.rows[0] ? toDTO(result.rows[0]) : null;
}

async function markFailed(id, errorMessage) {
  const result = await db.query(
    `UPDATE copy_executions SET status = 'failed', error_message = $2 WHERE id = $1 RETURNING *`,
    [id, errorMessage]
  );
  return toDTO(result.rows[0]);
}

async function markSkipped(id, reason) {
  const result = await db.query(
    `UPDATE copy_executions SET status = 'skipped', error_message = $2 WHERE id = $1 RETURNING *`,
    [id, reason]
  );
  return toDTO(result.rows[0]);
}

// Attaches the MT4/MT5 EA-bridge command details to an already-created
// (status 'pending') execution row, without changing its status - the row
// only becomes visible to an EA's poll once action is set (see
// claimPendingForFollower's "action IS NOT NULL" filter).
async function queueForBridge(id, { action, targetPositionId }) {
  const result = await db.query(
    `UPDATE copy_executions SET action = $2, target_position_id = $3 WHERE id = $1 RETURNING *`,
    [id, action, targetPositionId || null]
  );
  return toDTO(result.rows[0]);
}

// Claims this follower's queued bridge commands for delivery to its EA:
// atomically flips status 'pending' -> 'dispatched' (FOR UPDATE SKIP LOCKED
// so concurrent polls split the queue instead of double-claiming), joined
// against the originating trade event for the side/sl/tp a raw
// copy_executions row doesn't carry on its own.
async function claimPendingForFollower(followerAccountId, limit = 20) {
  const result = await db.query(
    `UPDATE copy_executions ce
     SET status = 'dispatched'
     FROM copy_trade_events te
     WHERE ce.id IN (
       SELECT id FROM copy_executions
       WHERE follower_account_id = $1 AND status = 'pending' AND action IS NOT NULL
       ORDER BY created_at
       LIMIT $2
       FOR UPDATE SKIP LOCKED
     )
     AND te.id = ce.trade_event_id
     RETURNING ce.*, te.side AS te_side, te.sl AS te_sl, te.tp AS te_tp`,
    [followerAccountId, limit]
  );
  return result.rows.map((row) => ({
    executionId: row.id,
    action: row.action,
    symbol: row.mapped_symbol,
    size: row.calculated_size === null ? null : Number(row.calculated_size),
    side: row.te_side,
    sl: row.te_sl === null ? null : Number(row.te_sl),
    tp: row.te_tp === null ? null : Number(row.te_tp),
    targetPositionId: row.target_position_id
  }));
}

// Applies a follower EA's report for a command it previously claimed via
// claimPendingForFollower. Scoped to followerAccountId so one account's EA
// can never resolve another account's command, and requires status
// 'dispatched' so a stray or replayed report can't silently overwrite an
// already-settled outcome.
async function reportBridgeResult(id, followerAccountId, { status, resultPositionId, errorMessage }) {
  const existing = await db.query(`SELECT * FROM copy_executions WHERE id = $1`, [id]);
  const row = existing.rows[0];
  if (!row || row.follower_account_id !== followerAccountId) {
    const error = new Error('Command not found for this account.');
    error.statusCode = 404;
    throw error;
  }
  if (row.status !== 'dispatched') {
    const error = new Error(`Command is not awaiting a result (status=${row.status}).`);
    error.statusCode = 409;
    throw error;
  }

  if (status === 'executed') {
    return markExecuted(id, resultPositionId);
  }
  if (status === 'failed') {
    return markFailed(id, errorMessage || 'EA reported failure.');
  }

  const error = new Error('status must be "executed" or "failed".');
  error.statusCode = 400;
  throw error;
}

async function listRecentForUser(userId, limit = 50) {
  const result = await db.query(
    `SELECT ce.* FROM copy_executions ce
     JOIN broker_accounts a ON a.id = ce.follower_account_id
     WHERE a.user_id = $1
     ORDER BY ce.created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return result.rows.map(toDTO);
}

module.exports = {
  createExecution,
  markExecuted,
  markFailed,
  markSkipped,
  queueForBridge,
  claimPendingForFollower,
  reportBridgeResult,
  findExecutedForTradeEvent,
  listRecentForUser,
  toDTO
};
