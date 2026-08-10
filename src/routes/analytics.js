const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { buildDashboardOverview } = require('../services/analyticsService');

const router = express.Router();

router.get('/overview', requireAuth, (req, res) => {
  res.json({ overview: buildDashboardOverview() });
});

module.exports = router;
