function createSettlement({
  traderId,
  followerId,
  strategyId,
  grossPnl,
  feeAmount = 0,
  netPayout,
  status = 'pending'
} = {}) {
  const numericGrossPnl = Number(grossPnl || 0);
  const numericFeeAmount = Number(feeAmount || 0);
  const numericNetPayout = Number(netPayout ?? (numericGrossPnl - numericFeeAmount));

  return {
    id: `settlement-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    traderId,
    followerId,
    strategyId,
    grossPnl: numericGrossPnl,
    feeAmount: numericFeeAmount,
    netPayout: numericNetPayout,
    status,
    createdAt: new Date().toISOString()
  };
}

function calculateSettlementSummary(settlements = []) {
  const totalCompleted = settlements
    .filter((settlement) => settlement.status === 'completed')
    .reduce((sum, settlement) => sum + Number(settlement.netPayout || 0), 0);

  const totalPending = settlements
    .filter((settlement) => settlement.status === 'pending')
    .reduce((sum, settlement) => sum + Number(settlement.netPayout || 0), 0);

  const totalRejected = settlements
    .filter((settlement) => settlement.status === 'rejected')
    .reduce((sum, settlement) => sum + Number(settlement.netPayout || 0), 0);

  return {
    totalCompleted,
    totalPending,
    totalRejected,
    totalVolume: totalCompleted + totalPending + totalRejected
  };
}

function updateSettlementStatus(settlement, nextStatus, reviewNote = '') {
  if (!settlement || !nextStatus) {
    return settlement;
  }

  return {
    ...settlement,
    status: nextStatus,
    reviewNote,
    reviewedAt: new Date().toISOString()
  };
}

function buildSettlementDashboard(settlements = []) {
  const pendingSettlements = settlements.filter((settlement) => settlement.status === 'pending');
  const completedSettlements = settlements.filter((settlement) => settlement.status === 'completed');
  const rejectedSettlements = settlements.filter((settlement) => settlement.status === 'rejected');

  const totalPendingPayout = pendingSettlements.reduce((sum, settlement) => sum + Number(settlement.netPayout || 0), 0);
  const totalCompletedPayout = completedSettlements.reduce((sum, settlement) => sum + Number(settlement.netPayout || 0), 0);
  const totalRejectedPayout = rejectedSettlements.reduce((sum, settlement) => sum + Number(settlement.netPayout || 0), 0);

  return {
    pendingCount: pendingSettlements.length,
    totalPendingPayout,
    totalCompletedPayout,
    totalRejectedPayout,
    requiresAttention: pendingSettlements.length > 0,
    generatedAt: new Date().toISOString()
  };
}

module.exports = {
  createSettlement,
  calculateSettlementSummary,
  updateSettlementStatus,
  buildSettlementDashboard
};
