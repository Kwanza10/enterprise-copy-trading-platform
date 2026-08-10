const fs = require('fs');
const path = require('path');

const PERMISSION_TYPES = ['webSearch', 'mcpServers'];
const PERMISSIONS_FILE = path.join(__dirname, '..', '..', '.permissions.json');
const AUDIT_LOG_FILE = path.join(__dirname, '..', '..', 'logs', 'ai-assistant-audit.log');

function defaultPermissionRecord() {
  return { allowed: false, decided: false, permanent: false, askForPermission: true };
}

function assertValidType(type) {
  if (!PERMISSION_TYPES.includes(type)) {
    throw new Error(`Unknown permission type "${type}". Expected one of: ${PERMISSION_TYPES.join(', ')}`);
  }
}

function loadPermissions() {
  try {
    return JSON.parse(fs.readFileSync(PERMISSIONS_FILE, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { users: {} };
    throw error;
  }
}

function savePermissions(data) {
  fs.writeFileSync(PERMISSIONS_FILE, JSON.stringify(data, null, 2));
}

function ensureUserRecord(data, userId, type) {
  if (!data.users[userId]) data.users[userId] = {};
  if (!data.users[userId][type]) data.users[userId][type] = defaultPermissionRecord();
  return data.users[userId][type];
}

function appendAuditLog(entry) {
  fs.mkdirSync(path.dirname(AUDIT_LOG_FILE), { recursive: true });
  fs.appendFileSync(AUDIT_LOG_FILE, `${JSON.stringify({ timestamp: new Date().toISOString(), ...entry })}\n`);
}

function readAuditLog(userId) {
  let raw;
  try {
    raw = fs.readFileSync(AUDIT_LOG_FILE, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => !userId || entry.userId === userId);
}

function checkPermission(userId, type) {
  assertValidType(type);
  const data = loadPermissions();
  const record = ensureUserRecord(data, userId, type);
  savePermissions(data);
  return { allowed: record.allowed === true, shouldAsk: record.askForPermission && !record.decided };
}

function checkWebSearchPermission(userId) {
  return checkPermission(userId, 'webSearch');
}

function checkMCPPermission(userId) {
  return checkPermission(userId, 'mcpServers');
}

function grantPermission(userId, type, permanent = false) {
  assertValidType(type);
  const data = loadPermissions();
  const record = ensureUserRecord(data, userId, type);
  record.allowed = true;
  record.decided = true;
  record.permanent = Boolean(permanent);
  savePermissions(data);
  appendAuditLog({ userId, type, action: 'grant', permanent: Boolean(permanent) });
  return { allowed: true, shouldAsk: false };
}

function denyPermission(userId, type) {
  assertValidType(type);
  const data = loadPermissions();
  const record = ensureUserRecord(data, userId, type);
  record.allowed = false;
  record.decided = true;
  record.permanent = false;
  savePermissions(data);
  appendAuditLog({ userId, type, action: 'deny' });
  return { allowed: false, shouldAsk: false };
}

function togglePermissionPrompt(userId, type, enabled) {
  assertValidType(type);
  const data = loadPermissions();
  const record = ensureUserRecord(data, userId, type);
  record.askForPermission = Boolean(enabled);
  savePermissions(data);
  appendAuditLog({ userId, type, action: 'toggle_prompt', enabled: Boolean(enabled) });
  return getStatus(userId);
}

function getAuditLog(userId) {
  return readAuditLog(userId);
}

function getStatus(userId) {
  const data = loadPermissions();
  const status = {};
  for (const type of PERMISSION_TYPES) {
    status[type] = { ...ensureUserRecord(data, userId, type) };
  }
  savePermissions(data);
  return status;
}

// Express middleware: only lets admins hit routes that manage other users' permissions.
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin role required.' });
  }
  return next();
}

// Express middleware factory: gate a route so it only runs if the caller has
// granted permission for the given AI assistant feature (webSearch / mcpServers).
function requirePermission(type) {
  assertValidType(type);
  return function permissionGate(req, res, next) {
    const userId = req.user && req.user.sub;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const { allowed, shouldAsk } = checkPermission(userId, type);
    if (!allowed) {
      appendAuditLog({ userId, type, action: 'blocked', path: req.originalUrl });
      return res.status(403).json({ error: `${type} permission not granted.`, shouldAsk });
    }

    appendAuditLog({ userId, type, action: 'used', path: req.originalUrl });
    return next();
  };
}

const requireWebSearchPermission = requirePermission('webSearch');
const requireMCPPermission = requirePermission('mcpServers');

module.exports = {
  checkWebSearchPermission,
  checkMCPPermission,
  grantPermission,
  denyPermission,
  togglePermissionPrompt,
  getAuditLog,
  getStatus,
  requireWebSearchPermission,
  requireMCPPermission,
  requireAdmin
};
