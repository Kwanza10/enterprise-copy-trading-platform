const crypto = require('crypto');
const db = require('../lib/db');
const cipher = require('../lib/credentialCipher');
const followerLimitService = require('./followerLimitService');

const PLATFORMS = ['mt4', 'mt5', 'tradelocker'];
const ROLES = ['master', 'follower', 'both'];
const ENVIRONMENTS = ['demo', 'live'];

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function toPublicDTO(row) {
  return {
    id: row.id,
    userId: row.user_id,
    platform: row.platform,
    role: row.role,
    label: row.label,
    environment: row.environment,
    balance: Number(row.balance),
    status: row.status,
    isPublic: row.is_public,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// A private (non-"Copy Me") master account is capped at maxPrivateMastersPerUser
// - the actual follower-count cap per master is enforced separately in
// copyRelationshipService, since that's where followers actually attach.
// A public ("Copy Me") master isn't counted against this cap - it's meant to
// be created deliberately, not accidentally used up as one of the private slots.
async function assertPrivateMasterSlotAvailable(userId) {
  const limits = await followerLimitService.getLimits();
  if (!limits.enabled) return;

  const result = await db.query(
    `SELECT COUNT(*) FROM broker_accounts
     WHERE user_id = $1 AND role IN ('master', 'both') AND is_public = FALSE AND status = 'active'`,
    [userId]
  );
  const count = Number(result.rows[0].count);
  if (count >= limits.maxPrivateMastersPerUser) {
    throw new Error(
      `You already have ${count} private master account(s), the limit is ${limits.maxPrivateMastersPerUser}. ` +
      `Mark a new one as a public "Copy Me" account instead, or remove an existing master first.`
    );
  }
}

async function createBrokerAccount({ userId, platform, role, label, environment, credentials, balance, isPublic }) {
  if (!PLATFORMS.includes(platform)) {
    throw new Error(`platform must be one of: ${PLATFORMS.join(', ')}`);
  }
  if (role && !ROLES.includes(role)) {
    throw new Error(`role must be one of: ${ROLES.join(', ')}`);
  }
  if (environment && !ENVIRONMENTS.includes(environment)) {
    throw new Error(`environment must be one of: ${ENVIRONMENTS.join(', ')}`);
  }
  if (!credentials || typeof credentials !== 'object') {
    throw new Error('credentials object is required.');
  }
  // MT4/MT5 accounts have no credentials to fail login on (the EA connects
  // later via webhook token), so without this an empty label would sail
  // through and create a real, blank, un-attributable account.
  if (!label || !label.trim()) {
    throw new Error('label is required.');
  }

  const resolvedRole = role || 'both';
  const resolvedIsPublic = Boolean(isPublic);
  if (['master', 'both'].includes(resolvedRole) && !resolvedIsPublic) {
    await assertPrivateMasterSlotAvailable(userId);
  }

  const id = crypto.randomUUID();
  const webhookToken = crypto.randomBytes(24).toString('hex');
  const credentialsEncrypted = cipher.encrypt(credentials);

  const result = await db.query(
    `INSERT INTO broker_accounts
       (id, user_id, platform, role, label, credentials_encrypted, webhook_token_hash, environment, balance, status, is_public)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', $10)
     RETURNING *`,
    [
      id,
      userId,
      platform,
      resolvedRole,
      label || null,
      credentialsEncrypted,
      hashToken(webhookToken),
      environment || 'demo',
      balance || 0,
      resolvedIsPublic
    ]
  );

  return { account: toPublicDTO(result.rows[0]), webhookToken };
}

async function listBrokerAccountsForUser(userId) {
  const result = await db.query(
    `SELECT * FROM broker_accounts WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows.map(toPublicDTO);
}

async function getBrokerAccountRowById(accountId) {
  const result = await db.query(`SELECT * FROM broker_accounts WHERE id = $1`, [accountId]);
  return result.rows[0] || null;
}

async function getBrokerAccountByWebhookToken(rawToken) {
  const result = await db.query(
    `SELECT * FROM broker_accounts WHERE webhook_token_hash = $1`,
    [hashToken(rawToken)]
  );
  return result.rows[0] || null;
}

async function listAccountsByPlatformAndRole(platform, role) {
  const result = await db.query(
    `SELECT * FROM broker_accounts WHERE platform = $1 AND role IN ($2, 'both') AND status = 'active'`,
    [platform, role]
  );
  return result.rows;
}

function getDecryptedCredentials(accountRow) {
  return cipher.decrypt(accountRow.credentials_encrypted);
}

// The webhook token is stored only as a hash, so a lost token can't be
// recovered - this issues a new one and invalidates the old one in the same
// update, rather than requiring the account to be deleted and recreated.
async function regenerateWebhookToken(accountId) {
  const webhookToken = crypto.randomBytes(24).toString('hex');
  const result = await db.query(
    `UPDATE broker_accounts SET webhook_token_hash = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [hashToken(webhookToken), accountId]
  );
  if (result.rows.length === 0) {
    return null;
  }
  return { account: toPublicDTO(result.rows[0]), webhookToken };
}

async function updateStatus(accountId, status) {
  await db.query(`UPDATE broker_accounts SET status = $1, updated_at = NOW() WHERE id = $2`, [status, accountId]);
}

async function updateBalance(accountId, balance) {
  await db.query(`UPDATE broker_accounts SET balance = $1, updated_at = NOW() WHERE id = $2`, [balance, accountId]);
}

// Called on every authenticated bridge/webhook call an account's token
// makes (see mtBridge.js, webhook.js) and on every successful TradeLocker
// poll cycle (tradeLockerPoller.js) - the only positive signal a follower
// EA actually connected, since a successful poll produces no log line of
// its own. Fire-and-forget from callers; a lost heartbeat update isn't
// worth failing the request over.
async function touchLastSeen(accountId) {
  await db.query(`UPDATE broker_accounts SET last_seen_at = NOW() WHERE id = $1`, [accountId]);
}

module.exports = {
  PLATFORMS,
  ROLES,
  ENVIRONMENTS,
  createBrokerAccount,
  listBrokerAccountsForUser,
  getBrokerAccountRowById,
  getBrokerAccountByWebhookToken,
  listAccountsByPlatformAndRole,
  getDecryptedCredentials,
  regenerateWebhookToken,
  updateStatus,
  updateBalance,
  touchLastSeen,
  toPublicDTO
};
