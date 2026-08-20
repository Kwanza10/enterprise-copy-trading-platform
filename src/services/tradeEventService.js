const crypto = require('crypto');
const db = require('../lib/db');

function toDTO(row) {
  return {
    id: row.id,
    sourceAccountId: row.source_account_id,
    eventType: row.event_type,
    symbol: row.symbol,
    side: row.side,
    size: row.size === null ? null : Number(row.size),
    price: row.price === null ? null : Number(row.price),
    sl: row.sl === null ? null : Number(row.sl),
    tp: row.tp === null ? null : Number(row.tp),
    externalPositionId: row.external_position_id,
    source: row.source,
    status: row.status,
    receivedAt: row.received_at
  };
}

async function createTradeEvent({
  sourceAccountId,
  eventType,
  symbol,
  side,
  size,
  price,
  sl,
  tp,
  externalPositionId,
  source,
  rawPayload
}) {
  const id = crypto.randomUUID();
  const result = await db.query(
    `INSERT INTO copy_trade_events
       (id, source_account_id, event_type, symbol, side, size, price, sl, tp, external_position_id, source, raw_payload, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'received')
     RETURNING *`,
    [
      id,
      sourceAccountId,
      eventType,
      symbol,
      side || null,
      size ?? null,
      price ?? null,
      sl ?? null,
      tp ?? null,
      externalPositionId || null,
      source,
      rawPayload ? JSON.stringify(rawPayload) : null
    ]
  );
  return toDTO(result.rows[0]);
}

// Used when a position_closed event arrives, to find the original
// position_opened event for the same master position so followers' mirrored
// positions can be closed too.
async function findOpenEventByExternalId(sourceAccountId, externalPositionId) {
  const result = await db.query(
    `SELECT * FROM copy_trade_events
     WHERE source_account_id = $1 AND external_position_id = $2 AND event_type = 'position_opened'
     ORDER BY received_at DESC
     LIMIT 1`,
    [sourceAccountId, externalPositionId]
  );
  return result.rows[0] ? toDTO(result.rows[0]) : null;
}

// Webhook bridges (MT4/5 EAs) retry on timeout/connection-reset without any
// idempotency key of their own, so the same position event can arrive twice.
// A duplicate is the same master position reporting the same state again
// within a short window - matched on the fields that would otherwise cause
// it to be re-copied (or re-closed) to followers a second time.
async function findRecentDuplicate({ sourceAccountId, eventType, externalPositionId, side, size, sl, tp, windowMs = 15000 }) {
  const result = await db.query(
    `SELECT * FROM copy_trade_events
     WHERE source_account_id = $1
       AND event_type = $2
       AND external_position_id = $3
       AND side IS NOT DISTINCT FROM $4
       AND size IS NOT DISTINCT FROM $5
       AND sl IS NOT DISTINCT FROM $6
       AND tp IS NOT DISTINCT FROM $7
       AND received_at >= NOW() - ($8 || ' milliseconds')::interval
     ORDER BY received_at DESC
     LIMIT 1`,
    [sourceAccountId, eventType, externalPositionId, side || null, size ?? null, sl ?? null, tp ?? null, windowMs]
  );
  return result.rows[0] ? toDTO(result.rows[0]) : null;
}

async function updateStatus(id, status) {
  await db.query(`UPDATE copy_trade_events SET status = $1 WHERE id = $2`, [status, id]);
}

async function listRecentForUser(userId, limit = 50) {
  const result = await db.query(
    `SELECT e.* FROM copy_trade_events e
     JOIN broker_accounts a ON a.id = e.source_account_id
     WHERE a.user_id = $1
     ORDER BY e.received_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return result.rows.map(toDTO);
}

module.exports = {
  createTradeEvent,
  updateStatus,
  listRecentForUser,
  findOpenEventByExternalId,
  findRecentDuplicate,
  toDTO
};
