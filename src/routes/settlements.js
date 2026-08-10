const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  createSettlement,
  calculateSettlementSummary,
  updateSettlementStatus,
  buildSettlementDashboard
} = require('../services/settlementService');

const router = express.Router();
const settlements = [];

router.get('/', requireAuth, (req, res) => {
  res.json({ count: settlements.length, settlements });
});

router.post('/', requireAuth, (req, res) => {
  const { traderId, followerId, strategyId, grossPnl, feeAmount, netPayout, status } = req.body;

  if (!traderId || !followerId || !strategyId || grossPnl === undefined) {
    return res.status(400).json({ error: 'traderId, followerId, strategyId, and grossPnl are required.' });
  }

  const settlement = createSettlement({
    traderId,
    followerId,
    strategyId,
    grossPnl,
    feeAmount,
    netPayout,
    status
  });

  settlements.push(settlement);
  return res.status(201).json({ settlement });
});

router.get('/summary', requireAuth, (req, res) => {
  res.json({ summary: calculateSettlementSummary(settlements) });
});

router.get('/dashboard', requireAuth, (req, res) => {
  res.json({ dashboard: buildSettlementDashboard(settlements) });
});

router.patch('/:id/status', requireAuth, (req, res) => {
  const { id } = req.params;
  const { status, reviewNote } = req.body;

  const index = settlements.findIndex((settlement) => settlement.id === id);
  if (index === -1) {
    return res.status(404).json({ error: 'Settlement not found.' });
  }

  const updated = updateSettlementStatus(settlements[index], status, reviewNote);
  settlements[index] = updated;

  return res.json({ settlement: updated });
});

module.exports = router;
