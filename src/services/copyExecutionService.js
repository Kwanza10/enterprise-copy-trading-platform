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
  findExecutedForTradeEvent,
  listRecentForUser,
  toDTO
};
