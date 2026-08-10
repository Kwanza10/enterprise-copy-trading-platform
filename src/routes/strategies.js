const express = require('express');
const { strategies, adminMetrics } = require('../lib/inMemoryStore');

const router = express.Router();

router.get('/', (req, res) => {
  const items = [...strategies.values()];
  res.json({
    count: items.length,
    strategies: items
  });
});

router.get('/:id', (req, res) => {
  const strategy = strategies.get(req.params.id);
  if (!strategy) {
    return res.status(404).json({ error: 'Strategy not found.' });
  }

  return res.json(strategy);
});

router.post('/', (req, res) => {
  const body = req.body;
  const strategy = {
    id: `strat-${Date.now()}`,
    name: body.name || 'New Strategy',
    traderId: body.traderId || 'trader-unknown',
    status: body.status || 'draft',
    riskLevel: body.riskLevel || 'moderate',
    winRate: body.winRate || 0,
    monthlyReturn: body.monthlyReturn || 0,
    maxDrawdown: body.maxDrawdown || 0,
    followers: body.followers || 0,
    minInvestment: body.minInvestment || 0,
    feePercent: body.feePercent || 0,
    strategyType: body.strategyType || 'scalping'
  };

  strategies.set(strategy.id, strategy);
  res.status(201).json(strategy);
});

router.get('/dashboard/summary', (req, res) => {
  res.json({
    metrics: adminMetrics,
    generatedAt: new Date().toISOString()
  });
});

module.exports = router;
