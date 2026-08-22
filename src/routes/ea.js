const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { requireWebhookToken } = require('../middleware/webhookAuth');
const copyExecutionService = require('../services/copyExecutionService');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads/eas');
    require('fs').mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}-${file.originalname}`);
  }
});

const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

router.post('/upload', (req, res) => {
  res.json({ message: 'EA upload endpoint', disclaimer: 'BrokersSync is NOT liable for EA performance or losses' });
});

router.get('/my-eas', (req, res) => {
  res.json({ eas: [] });
});

router.delete('/:eaId', (req, res) => {
  res.json({ message: 'EA deleted' });
});

router.get('/disclaimer', (req, res) => {
  res.json({ disclaimer: 'BrokersSync is NOT liable for EA performance, losses, or malfunctions. User assumes full risk.' });
});

// --- Follower command bridge (MT4/MT5) ---
// MT4/MT5 have no server-reachable trading API, so a follower account's
// positions can only be opened/modified/closed by an EA running inside that
// terminal. copyEngine queues commands as copy_executions rows (status
// 'pending', action set); this is where the follower EA polls for them and
// reports back what happened after executing locally.

// GET /api/ea/commands - claims (status -> 'dispatched') and returns this
// account's queued commands. Claiming is atomic (SELECT ... FOR UPDATE SKIP
// LOCKED under the hood) so a retried poll can never hand out the same
// command twice.
router.get('/commands', requireWebhookToken, async (req, res) => {
  try {
    const commands = await copyExecutionService.claimPendingForFollower(req.brokerAccount.id);
    return res.json({ commands });
  } catch (error) {
    console.error('Failed to claim EA commands:', error.message);
    return res.status(500).json({ error: 'Unable to fetch commands.' });
  }
});

// POST /api/ea/commands/:executionId/result - the EA reports what happened
// when it executed a claimed command locally (its own position ticket for
// 'open', or a failure reason). Only accepted for a command this account
// actually claimed and that's still awaiting a result.
router.post('/commands/:executionId/result', requireWebhookToken, async (req, res) => {
  const { status, resultPositionId, errorMessage } = req.body || {};
  try {
    const execution = await copyExecutionService.reportBridgeResult(req.params.executionId, req.brokerAccount.id, {
      status,
      resultPositionId,
      errorMessage
    });
    return res.json({ execution });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message });
  }
});

module.exports = router;
