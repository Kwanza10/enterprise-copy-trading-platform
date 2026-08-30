const db = require('../lib/db');

const SETTINGS_KEY = 'follower_limits';

const DEFAULT_LIMITS = {
  enabled: true,
  maxPrivateMastersPerUser: 2,
  maxFollowersPerPrivateMaster: 5,
  maxFollowersPerPublicMaster: 20
};

async function getLimits() {
  const result = await db.query(`SELECT value FROM app_settings WHERE key = $1`, [SETTINGS_KEY]);
  if (result.rows.length === 0) {
    return { ...DEFAULT_LIMITS };
  }
  return { ...DEFAULT_LIMITS, ...result.rows[0].value };
}

async function updateLimits(updates) {
  const current = await getLimits();
  const next = { ...current };

  if (updates.enabled !== undefined) {
    next.enabled = Boolean(updates.enabled);
  }
  for (const field of ['maxPrivateMastersPerUser', 'maxFollowersPerPrivateMaster', 'maxFollowersPerPublicMaster']) {
    if (updates[field] === undefined) continue;
    const value = Number(updates[field]);
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${field} must be a positive whole number.`);
    }
    next[field] = value;
  }

  await db.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [SETTINGS_KEY, JSON.stringify(next)]
  );

  return next;
}

module.exports = { getLimits, updateLimits, DEFAULT_LIMITS };
