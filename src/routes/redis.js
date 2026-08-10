const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getRedisHealthSummary } = require('../services/redisService');

const router = express.Router();

router.get('/health', requireAuth, async (req, res) => {
  const summary = await getRedisHealthSummary(process.env);
  res.json({ redis: summary });
});

module.exports = router;
