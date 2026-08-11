const crypto = require('crypto');
const db = require('../lib/db');
const cipher = require('../lib/credentialCipher');

const PLATFORMS = ['mt4', 'mt5', 'tradelocker', 'ninjatrader'];
const ROLES = ['master', 'follower', 'both'];

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function toPublicDTO(row) {
  return {
    id: row.id,
    userId: row.user_id,
    platform: row.platform,
    role: row.role,
    accountLabel: row.account_label,
    balance: Number(row.balance),
    status: row.status,
    createdAt: row.created_at,
    lastSyncAt: row.last_sync_at
  };
}

async function createBrokerAccount({ userId, platform, role, accountLabel, credentials, balance }) {
  if (!PLATFORMS.includes(platform)) {
    throw new Error(`platform must be one of: ${PLATFORMS.join(', ')}`);
  }
  if (role && !ROLES.includes(role)) {
    throw new Error(`role must be one of: ${ROLES.join(', ')}`);
  }
  if (!credentials || typeof credentials !== 'object') {
    throw new Error('credentials object is required.');
  }

  const id = crypto.randomUUID();
  const webhookToken = crypto.randomBytes(24).toString('hex');
  const encryptedCredentials = cipher.encrypt(credentials);

  const result = await db.query(
    `INSERT INTO broker_accounts
       (id, user_id, platform, role, account_label, encrypted_credentials, webhook_token_hash, balance, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')
     RETURNING *`,
    [id, userId, platform, role || 'both', accountLabel || null, encryptedCredentials, hashToken(webhookToken), balance || 0]
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

async function getDecryptedCredentials(accountRow) {
  return cipher.decrypt(accountRow.encrypted_credentials);
}

async function touchLastSync(accountId) {
  await db.query(`UPDATE broker_accounts SET last_sync_at = NOW() WHERE id = $1`, [accountId]);
}

module.exports = {
  PLATFORMS,
  ROLES,
  createBrokerAccount,
  listBrokerAccountsForUser,
  getBrokerAccountRowById,
  getBrokerAccountByWebhookToken,
  getDecryptedCredentials,
  touchLastSync,
  toPublicDTO
};
