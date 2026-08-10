const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createTransfer,
  calculateTransferSummary
} = require('../src/services/transferService');

test('createTransfer creates a valid internal movement record', () => {
  const transfer = createTransfer({
    fromUserId: 'user-1',
    toUserId: 'user-2',
    amount: 250,
    currency: 'USD',
    status: 'pending'
  });

  assert.equal(transfer.fromUserId, 'user-1');
  assert.equal(transfer.toUserId, 'user-2');
  assert.equal(transfer.amount, 250);
  assert.equal(transfer.status, 'pending');
  assert.ok(transfer.id);
});

test('calculateTransferSummary totals completed and pending transfers', () => {
  const transfers = [
    { amount: 500, status: 'completed' },
    { amount: 200, status: 'completed' },
    { amount: 120, status: 'pending' },
    { amount: 90, status: 'failed' }
  ];

  const summary = calculateTransferSummary(transfers);

  assert.equal(summary.totalCompleted, 700);
  assert.equal(summary.totalPending, 120);
  assert.equal(summary.totalFailed, 90);
  assert.equal(summary.totalVolume, 910);
});
