const crypto = require('crypto');
const db = require('../lib/db');

const PLATFORMS = ['mt4', 'mt5', 'tradelocker'];
const COMMON_SYMBOLS = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'US30', 'NAS100'];

function toDTO(row) {
  return {
    id: row.id,
    userId: row.user_id,
    sourcePlatform: row.source_platform,
    sourceSymbol: row.source_symbol,
    targetPlatform: row.target_platform,
    targetSymbol: row.target_symbol,
    createdAt: row.created_at
  };
}

// Lookup order: user-specific override -> global default (user_id IS NULL) -> identity fallback.
async function resolveSymbol({ userId, sourcePlatform, sourceSymbol, targetPlatform }) {
  const result = await db.query(
    `SELECT * FROM symbol_mappings
     WHERE source_platform = $1 AND source_symbol = $2 AND target_platform = $3
       AND (user_id = $4 OR user_id IS NULL)
     ORDER BY user_id NULLS LAST
     LIMIT 1`,
    [sourcePlatform, sourceSymbol, targetPlatform, userId]
  );

  if (result.rows.length > 0) {
    return result.rows[0].target_symbol;
  }

  return sourceSymbol;
}

async function listMappingsForUser(userId) {
  const result = await db.query(
    `SELECT * FROM symbol_mappings WHERE user_id = $1 OR user_id IS NULL ORDER BY user_id NULLS LAST, source_symbol`,
    [userId]
  );

  const rows = result.rows.map(toDTO);
  return {
    custom: rows.filter((r) => r.userId === userId),
    global: rows.filter((r) => r.userId === null)
  };
}

async function createMapping({ userId, sourcePlatform, sourceSymbol, targetPlatform, targetSymbol }) {
  if (!PLATFORMS.includes(sourcePlatform) || !PLATFORMS.includes(targetPlatform)) {
    throw new Error(`platform must be one of: ${PLATFORMS.join(', ')}`);
  }
  if (!sourceSymbol || !targetSymbol) {
    throw new Error('sourceSymbol and targetSymbol are required.');
  }

  const id = crypto.randomUUID();
  const result = await db.query(
    `INSERT INTO symbol_mappings (id, user_id, source_platform, source_symbol, target_platform, target_symbol)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [id, userId, sourcePlatform, sourceSymbol.toUpperCase(), targetPlatform, targetSymbol.toUpperCase()]
  );

  return toDTO(result.rows[0]);
}

// Only deletes mappings owned by userId - global defaults (user_id IS NULL)
// are not removable through the user-facing route.
async function deleteMapping(id, userId) {
  const result = await db.query(
    `DELETE FROM symbol_mappings WHERE id = $1 AND user_id = $2 RETURNING id`,
    [id, userId]
  );
  return result.rowCount > 0;
}

// Seeds identity mappings (same symbol on both sides) for common instruments
// across every platform pair, so they show up in the dashboard as editable
// defaults. Real cross-broker suffix conventions (e.g. "EURUSD.a") vary per
// broker and aren't known generically, so this seed intentionally starts
// identity-only; users override per their own broker's naming via POST.
async function seedGlobalDefaults() {
  const existing = await db.query(`SELECT COUNT(*)::int AS count FROM symbol_mappings WHERE user_id IS NULL`);
  if (existing.rows[0].count > 0) return;

  const rows = [];
  for (const sourcePlatform of PLATFORMS) {
    for (const targetPlatform of PLATFORMS) {
      if (sourcePlatform === targetPlatform) continue;
      for (const symbol of COMMON_SYMBOLS) {
        rows.push([crypto.randomUUID(), null, sourcePlatform, symbol, targetPlatform, symbol]);
      }
    }
  }

  for (const row of rows) {
    await db.query(
      `INSERT INTO symbol_mappings (id, user_id, source_platform, source_symbol, target_platform, target_symbol)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      row
    );
  }
}

module.exports = {
  PLATFORMS,
  resolveSymbol,
  listMappingsForUser,
  createMapping,
  deleteMapping,
  seedGlobalDefaults
};
