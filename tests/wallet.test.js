const test = require('node:test');
const assert = require('node:assert/strict');
const { createWalletLedgerEntry, calculateWalletSummary } = require('../src/services/walletService');

test('createWalletLedgerEntry records a funded or debited wallet transaction', () => {
  const entry = createWalletLedgerEntry({
    userId: 'user-10',
    type: 'deposit',
    amount: 2500,
    currency: 'USD',
    status: 'completed'
  });

  assert.equal(entry.userId, 'user-10');
  assert.equal(entry.type, 'deposit');
  assert.equal(entry.amount, 2500);
  assert.equal(entry.currency, 'USD');
  assert.equal(entry.status, 'completed');
  assert.ok(entry.id);
});

test('calculateWalletSummary totals balances and recent movements', () => {
  const entries = [
    { type: 'deposit', amount: 5000, status: 'completed' },
    { type: 'withdrawal', amount: 1500, status: 'completed' },
    { type: 'fee', amount: 75, status: 'completed' },
    { type: 'deposit', amount: 1000, status: 'pending' }
  ];

  const summary = calculateWalletSummary(entries);

  assert.equal(summary.availableBalance, 3425);
  assert.equal(summary.totalDeposits, 5000);
  assert.equal(summary.totalWithdrawals, 1500);
  assert.equal(summary.totalFees, 75);
  assert.equal(summary.pendingAmount, 1000);
});
