const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  checkWebSearchPermission,
  checkMCPPermission,
  grantPermission,
  denyPermission,
  togglePermissionPrompt,
  getAuditLog,
  getStatus,
  requireAdmin
} = require('../middleware/permission-manager');

const router = express.Router();
const PERMISSION_TYPES = ['webSearch', 'mcpServers'];

function validateType(req, res, next) {
  if (!PERMISSION_TYPES.includes(req.params.type)) {
    return res.status(400).json({ error: `type must be one of: ${PERMISSION_TYPES.join(', ')}` });
  }
  return next();
}

router.use(requireAuth);

router.get('/status', (req, res) => {
  res.json({ status: getStatus(req.user.sub) });
});

router.get('/audit-log', (req, res) => {
  res.json({ auditLog: getAuditLog(req.user.sub) });
});

router.get('/permissions/:type/check', validateType, (req, res) => {
  const check = req.params.type === 'webSearch'
    ? checkWebSearchPermission(req.user.sub)
    : checkMCPPermission(req.user.sub);
  res.json(check);
});

router.post('/permissions/:type/grant', validateType, (req, res) => {
  const { permanent } = req.body;
  const result = grantPermission(req.user.sub, req.params.type, Boolean(permanent));
  res.json(result);
});

router.post('/permissions/:type/deny', validateType, (req, res) => {
  const result = denyPermission(req.user.sub, req.params.type);
  res.json(result);
});

// Admin-only: manage or inspect any user's AI-assistant permissions.
router.post('/admin/:userId/permissions/:type/toggle-prompt', requireAdmin, validateType, (req, res) => {
  const { enabled } = req.body;
  const status = togglePermissionPrompt(req.params.userId, req.params.type, Boolean(enabled));
  res.json({ status });
});

router.get('/admin/:userId/status', requireAdmin, (req, res) => {
  res.json({ status: getStatus(req.params.userId) });
});

router.get('/admin/:userId/audit-log', requireAdmin, (req, res) => {
  res.json({ auditLog: getAuditLog(req.params.userId) });
});

module.exports = router;
