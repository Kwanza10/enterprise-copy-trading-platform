const crypto = require('crypto');
const db = require('../lib/db');

function toDTO(row) {
  return {
    id: row.id,
    executionId: row.execution_id,
    followerAccountId: row.follower_account_id,
    commandType: row.command_type,
    symbol: row.symbol,
    side: row.side,
    size: row.size === null ? null : Number(row.size),
    sl: row.sl === null ? null : Number(row.sl),
    tp: row.tp === null ? null : Number(row.tp),
    targetPositionId: row.target_position_id,
    status: row.status,
    resultStatus: row.result_status,
    resultPositionId: row.result_position_id,
    errorMessage: row.error_message,
    createdAt: row.created_at
  };
}

async function createCommand({ executionId, followerAccountId, commandType, symbol, side, size, sl, tp, targetPositionId }) {
  const id = crypto.randomUUID();
  const result = await db.query(
    `INSERT INTO bridge_commands
       (id, execution_id, follower_account_id, command_type, symbol, side, size, sl, tp, target_position_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
     RETURNING *`,
    [id, executionId, followerAccountId, commandType, symbol || null, side || null, size ?? null, sl ?? null, tp ?? null, targetPositionId || null]
  );
  return toDTO(result.rows[0]);
}

// Atomically claims this follower's pending commands so a second overlapping
// poll (e.g. an EA retrying after a slow response) can't be handed the same
// command twice - FOR UPDATE SKIP LOCKED means a concurrent claim just skips
// rows already being claimed rather than blocking or double-delivering.
async function claimPendingCommands(followerAccountId, limit = 20) {
  const result = await db.query(
    `UPDATE bridge_commands
     SET status = 'sent', sent_at = NOW()
     WHERE id IN (
       SELECT id FROM bridge_commands
       WHERE follower_account_id = $1 AND status = 'pending'
       ORDER BY created_at
       LIMIT $2
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    [followerAccountId, limit]
  );
  return result.rows.map(toDTO);
}

// Scoped by follower_account_id as well as command id so one follower's
// webhook token can never ack (and thus resolve) another account's command.
async function ackCommand({ commandId, followerAccountId, resultStatus, resultPositionId, errorMessage }) {
  const result = await db.query(
    `UPDATE bridge_commands
     SET status = 'acked', result_status = $3, result_position_id = $4, error_message = $5, acked_at = NOW()
     WHERE id = $1 AND follower_account_id = $2 AND status != 'acked'
     RETURNING *`,
    [commandId, followerAccountId, resultStatus, resultPositionId || null, errorMessage || null]
  );
  return result.rows[0] ? toDTO(result.rows[0]) : null;
}

module.exports = { createCommand, claimPendingCommands, ackCommand, toDTO };
