const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const followerLimitService = require('../services/followerLimitService');

const router = express.Router();

router.use(requireAuth);
router.use(requireAdmin);

router.get('/follower-limits', async (req, res) => {
  try {
    const limits = await followerLimitService.getLimits();
    return res.json({ limits });
  } catch (error) {
    console.error('Failed to load follower limits:', error.message);
    return res.status(500).json({ error: 'Unable to load follower limits.' });
  }
});

router.put('/follower-limits', async (req, res) => {
  try {
    const limits = await followerLimitService.updateLimits(req.body || {});
    return res.json({ limits });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

module.exports = router;
