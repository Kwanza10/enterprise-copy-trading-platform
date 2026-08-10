const express = require('express');
const { allocations } = require('../lib/inMemoryStore');
const { evaluateRisk } = require('../services/riskEngine');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/allocate', requireAuth, (req, res) => {
  const { followerId, strategyId, amount, riskTolerance } = req.body;

  if (!followerId || !strategyId || !amount) {
    return res.status(400).json({ error: 'followerId, strategyId, and amount are required.' });
  }

  const strategy = { riskLevel: 'moderate' };
  const allocation = {
    id: `alloc-${Date.now()}`,
    followerId,
    strategyId,
    amount,
    riskTolerance: riskTolerance || 'moderate',
    status: 'pending',
    createdAt: new Date().toISOString()
  };

  const risk = evaluateRisk(strategy, allocation);
  if (!risk.approved) {
    allocation.status = 'rejected';
    return res.status(400).json({
      message: 'Allocation rejected by risk engine.',
      risk
    });
  }

  allocation.status = 'active';
  allocations.set(allocation.id, allocation);

  return res.status(201).json({
    message: 'Copy allocation created successfully.',
    allocation,
    risk
  });
});

router.get('/allocations/:followerId', requireAuth, (req, res) => {
  const items = [...allocations.values()].filter((a) => a.followerId === req.params.followerId);
  res.json({ count: items.length, allocations: items });
});

module.exports = router;
