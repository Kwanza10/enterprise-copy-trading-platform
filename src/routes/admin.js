const express = require('express');
const { adminMetrics } = require('../lib/inMemoryStore');

const router = express.Router();

router.get('/dashboard', (req, res) => {
  res.json({
    summary: adminMetrics,
    alerts: [
      { id: 'risk-01', level: 'medium', message: 'Portfolio drawdown exceeded configured threshold for one strategy.' },
      { id: 'risk-02', level: 'high', message: 'Manual intervention required for a high-volatility investor group.' }
    ]
  });
});

module.exports = router;
