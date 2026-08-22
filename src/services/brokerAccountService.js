const crypto = require('crypto');
const db = require('../lib/db');
const cipher = require('../lib/credentialCipher');

const PLATFORMS = ['mt4', 'mt5', 'tradelocker', 'ninjatrader'];
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
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function createBrokerAccount({ userId, platform, role, label, environment, credentials, balance }) {
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

  const id = crypto.randomUUID();
  const webhookToken = crypto.randomBytes(24).toString('hex');
  const credentialsEncrypted = cipher.encrypt(credentials);

  const result = await db.query(
    `INSERT INTO broker_accounts
       (id, user_id, platform, role, label, credentials_encrypted, webhook_token_hash, environment, balance, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')
     RETURNING *`,
    [
      id,
      userId,
      platform,
      role || 'both',
      label || null,
      credentialsEncrypted,
      hashToken(webhookToken),
      environment || 'demo',
      balance || 0
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
  toPublicDTO
};
