const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { createWalletLedgerEntry, calculateWalletSummary } = require('../services/walletService');

const router = express.Router();
const ledger = [];

router.get('/ledger', requireAuth, (req, res) => {
  res.json({ count: ledger.length, entries: ledger });
});

router.post('/deposit', requireAuth, (req, res) => {
  const { userId, amount, currency, reference } = req.body;

  if (!userId || !amount) {
    return res.status(400).json({ error: 'userId and amount are required.' });
  }

  const entry = createWalletLedgerEntry({
    userId,
    type: 'deposit',
    amount: Number(amount),
    currency,
    status: 'completed',
    reference
  });

  ledger.push(entry);
  return res.status(201).json({ entry });
});

router.post('/withdraw', requireAuth, (req, res) => {
  const { userId, amount, currency, reference } = req.body;

  if (!userId || !amount) {
    return res.status(400).json({ error: 'userId and amount are required.' });
  }

  const entry = createWalletLedgerEntry({
    userId,
    type: 'withdrawal',
    amount: Number(amount),
    currency,
    status: 'pending',
    reference
  });

  ledger.push(entry);
  return res.status(201).json({ entry });
});

router.get('/summary', requireAuth, (req, res) => {
  res.json({ summary: calculateWalletSummary(ledger) });
});

module.exports = router;
