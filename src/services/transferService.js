function createTransfer({ fromUserId, toUserId, amount, currency = 'USD', status = 'pending', note = '' } = {}) {
  return {
    id: `transfer-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    fromUserId,
    toUserId,
    amount: Number(amount),
    currency,
    status,
    note,
    createdAt: new Date().toISOString()
  };
}

function calculateTransferSummary(transfers = []) {
  const totalCompleted = transfers
    .filter((transfer) => transfer.status === 'completed')
    .reduce((sum, transfer) => sum + Number(transfer.amount || 0), 0);

  const totalPending = transfers
    .filter((transfer) => transfer.status === 'pending')
    .reduce((sum, transfer) => sum + Number(transfer.amount || 0), 0);

  const totalFailed = transfers
    .filter((transfer) => transfer.status === 'failed')
    .reduce((sum, transfer) => sum + Number(transfer.amount || 0), 0);

  return {
    totalCompleted,
    totalPending,
    totalFailed,
    totalVolume: totalCompleted + totalPending + totalFailed
  };
}

module.exports = { createTransfer, calculateTransferSummary };
