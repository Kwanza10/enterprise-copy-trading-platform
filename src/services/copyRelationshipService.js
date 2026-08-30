const crypto = require('crypto');
const db = require('../lib/db');
const followerLimitService = require('./followerLimitService');

const RISK_MODES = ['fixed_lot', 'percent_of_master', 'percent_of_balance'];

function toDTO(row) {
  return {
    id: row.id,
    masterAccountId: row.master_account_id,
    followerAccountId: row.follower_account_id,
    followerUserId: row.follower_user_id,
    riskMode: row.risk_mode,
    riskValue: Number(row.risk_value),
    commissionPercent: row.commission_percent === null ? null : Number(row.commission_percent),
    enabled: row.enabled,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function createRelationship({ masterAccountId, followerAccountId, followerUserId, riskMode, riskValue, commissionPercent }) {
  if (!RISK_MODES.includes(riskMode)) {
    throw new Error(`riskMode must be one of: ${RISK_MODES.join(', ')}`);
  }
  if (typeof riskValue !== 'number' || riskValue <= 0) {
    throw new Error('riskValue must be a positive number.');
  }

  const masterAccount = await db.query(`SELECT user_id, is_public FROM broker_accounts WHERE id = $1`, [masterAccountId]);
  if (masterAccount.rows.length === 0) {
    throw new Error('masterAccountId does not exist.');
  }

  const isSelfCopy = masterAccount.rows[0].user_id === followerUserId;
  const status = isSelfCopy ? 'active' : 'pending_approval';

  const limits = await followerLimitService.getLimits();
  if (limits.enabled) {
    const isPublic = masterAccount.rows[0].is_public;
    const cap = isPublic ? limits.maxFollowersPerPublicMaster : limits.maxFollowersPerPrivateMaster;
    const countResult = await db.query(
      `SELECT COUNT(*) FROM trade_copy_relationships
       WHERE master_account_id = $1 AND status IN ('pending_approval', 'active')`,
      [masterAccountId]
    );
    const count = Number(countResult.rows[0].count);
    if (count >= cap) {
      throw new Error(
        `This master account already has ${count} follower(s) linked, the limit is ${cap}` +
        (isPublic ? ' for a public "Copy Me" account.' : ' for a private master account.')
      );
    }
  }

  const id = crypto.randomUUID();
  const result = await db.query(
    `INSERT INTO trade_copy_relationships
       (id, master_account_id, follower_account_id, follower_user_id, risk_mode, risk_value, commission_percent, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [id, masterAccountId, followerAccountId, followerUserId, riskMode, riskValue, commissionPercent ?? null, status]
  );

  return toDTO(result.rows[0]);
}

async function listForUser(userId) {
  const asFollower = await db.query(
    `SELECT * FROM trade_copy_relationships WHERE follower_user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );

  const asMaster = await db.query(
    `SELECT r.* FROM trade_copy_relationships r
     JOIN broker_accounts a ON a.id = r.master_account_id
     WHERE a.user_id = $1
     ORDER BY r.created_at DESC`,
    [userId]
  );

  return { asMaster: asMaster.rows.map(toDTO), asFollower: asFollower.rows.map(toDTO) };
}

async function getRelationshipWithOwners(id) {
  const result = await db.query(
    `SELECT r.*, ma.user_id AS master_user_id
     FROM trade_copy_relationships r
     JOIN broker_accounts ma ON ma.id = r.master_account_id
     WHERE r.id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

// Follower (relationship owner) may change riskMode/riskValue/enabled anytime.
// Master (owner of the master account) may only approve/reject a pending request.
async function updateRelationship(id, requestingUserId, updates) {
  const row = await getRelationshipWithOwners(id);
  if (!row) {
    throw new Error('Copy relationship not found.');
  }

  const isFollower = row.follower_user_id === requestingUserId;
  const isMaster = row.master_user_id === requestingUserId;
  if (!isFollower && !isMaster) {
    const err = new Error('Not authorized to modify this copy relationship.');
    err.statusCode = 403;
    throw err;
  }

  const sets = [];
  const values = [];
  let paramIndex = 1;

  if (updates.riskMode !== undefined || updates.riskValue !== undefined || updates.enabled !== undefined) {
    if (!isFollower) {
      const err = new Error('Only the follower can change riskMode, riskValue, or enabled.');
      err.statusCode = 403;
      throw err;
    }
    if (updates.riskMode !== undefined) {
      if (!RISK_MODES.includes(updates.riskMode)) {
        throw new Error(`riskMode must be one of: ${RISK_MODES.join(', ')}`);
      }
      sets.push(`risk_mode = $${paramIndex++}`);
      values.push(updates.riskMode);
    }
    if (updates.riskValue !== undefined) {
      sets.push(`risk_value = $${paramIndex++}`);
      values.push(updates.riskValue);
    }
    if (updates.enabled !== undefined) {
      sets.push(`enabled = $${paramIndex++}`);
      values.push(Boolean(updates.enabled));
    }
  }

  if (updates.status !== undefined) {
    if (!isMaster) {
      const err = new Error('Only the master account owner can approve or reject this relationship.');
      err.statusCode = 403;
      throw err;
    }
    if (row.status !== 'pending_approval') {
      throw new Error(`Cannot transition relationship from status "${row.status}".`);
    }
    if (!['active', 'rejected'].includes(updates.status)) {
      throw new Error('status must be "active" (approve) or "rejected" (deny).');
    }
    sets.push(`status = $${paramIndex++}`);
    values.push(updates.status);
  }

  if (sets.length === 0) {
    return toDTO(row);
  }

  sets.push(`updated_at = NOW()`);
  values.push(id);

  const result = await db.query(
    `UPDATE trade_copy_relationships SET ${sets.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );

  return toDTO(result.rows[0]);
}

// Used by copyEngine: only relationships that are approved, enabled, and not paused.
async function getActiveRelationshipsForMaster(masterAccountId) {
  const result = await db.query(
    `SELECT * FROM trade_copy_relationships WHERE master_account_id = $1 AND status = 'active' AND enabled = TRUE`,
    [masterAccountId]
  );
  return result.rows.map(toDTO);
}

module.exports = {
  RISK_MODES,
  createRelationship,
  listForUser,
  updateRelationship,
  getActiveRelationshipsForMaster
};
