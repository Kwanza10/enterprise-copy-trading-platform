function createWalletLedgerEntry({ userId, type, amount, currency = 'USD', status = 'pending', reference = null } = {}) {
  return {
    id: `wallet-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    userId,
    type,
    amount,
    currency,
    status,
    reference,
    createdAt: new Date().toISOString()
  };
}

function calculateWalletSummary(entries = []) {
  const completed = entries.filter((entry) => entry.status === 'completed');

  const totalDeposits = completed
    .filter((entry) => entry.type === 'deposit')
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);

  const totalWithdrawals = completed
    .filter((entry) => entry.type === 'withdrawal')
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);

  const totalFees = completed
    .filter((entry) => entry.type === 'fee')
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);

  const pendingAmount = entries
    .filter((entry) => entry.status === 'pending')
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);

  const availableBalance = totalDeposits - totalWithdrawals - totalFees;

  return {
    availableBalance,
    totalDeposits,
    totalWithdrawals,
    totalFees,
    pendingAmount
  };
}

module.exports = { createWalletLedgerEntry, calculateWalletSummary };
