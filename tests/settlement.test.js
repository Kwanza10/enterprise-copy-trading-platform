const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createSettlement,
  calculateSettlementSummary,
  updateSettlementStatus,
  buildSettlementDashboard
} = require('../src/services/settlementService');

test('createSettlement creates a reconciliation record', () => {
  const settlement = createSettlement({
    traderId: 'trader-1',
    followerId: 'user-2',
    strategyId: 'strat-1',
    grossPnl: 1800,
    feeAmount: 150,
    netPayout: 1650,
    status: 'pending'
  });

  assert.equal(settlement.traderId, 'trader-1');
  assert.equal(settlement.followerId, 'user-2');
  assert.equal(settlement.netPayout, 1650);
  assert.equal(settlement.status, 'pending');
  assert.ok(settlement.id);
});

test('calculateSettlementSummary totals pending and completed payouts', () => {
  const settlements = [
    { netPayout: 1500, status: 'completed' },
    { netPayout: 900, status: 'completed' },
    { netPayout: 450, status: 'pending' },
    { netPayout: 120, status: 'rejected' }
  ];

  const summary = calculateSettlementSummary(settlements);

  assert.equal(summary.totalCompleted, 2400);
  assert.equal(summary.totalPending, 450);
  assert.equal(summary.totalRejected, 120);
  assert.equal(summary.totalVolume, 2970);
});

test('updateSettlementStatus approves and rejects payout records', () => {
  const settlement = createSettlement({
    traderId: 'trader-9',
    followerId: 'user-7',
    strategyId: 'strat-9',
    grossPnl: 1200,
    feeAmount: 100,
    netPayout: 1100,
    status: 'pending'
  });

  const approved = updateSettlementStatus(settlement, 'completed', 'Approved by operations');
  const rejected = updateSettlementStatus(settlement, 'rejected', 'Risk policy threshold breached');

  assert.equal(approved.status, 'completed');
  assert.equal(approved.reviewNote, 'Approved by operations');
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.reviewNote, 'Risk policy threshold breached');
});

test('buildSettlementDashboard summarises pending review queues for admins', () => {
  const settlements = [
    { netPayout: 1500, status: 'completed' },
    { netPayout: 900, status: 'pending' },
    { netPayout: 250, status: 'pending' },
    { netPayout: 120, status: 'rejected' }
  ];

  const dashboard = buildSettlementDashboard(settlements);

  assert.equal(dashboard.pendingCount, 2);
  assert.equal(dashboard.totalPendingPayout, 1150);
  assert.equal(dashboard.totalCompletedPayout, 1500);
  assert.equal(dashboard.totalRejectedPayout, 120);
  assert.equal(dashboard.requiresAttention, true);
});
