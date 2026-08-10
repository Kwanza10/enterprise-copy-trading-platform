const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { createTransfer, calculateTransferSummary } = require('../services/transferService');

const router = express.Router();
const transfers = [];

router.get('/', requireAuth, (req, res) => {
  res.json({ count: transfers.length, transfers });
});

router.post('/', requireAuth, (req, res) => {
  const { fromUserId, toUserId, amount, currency, status, note } = req.body;

  if (!fromUserId || !toUserId || !amount) {
    return res.status(400).json({ error: 'fromUserId, toUserId, and amount are required.' });
  }

  const transfer = createTransfer({
    fromUserId,
    toUserId,
    amount,
    currency,
    status,
    note
  });

  transfers.push(transfer);
  return res.status(201).json({ transfer });
});

router.get('/summary', requireAuth, (req, res) => {
  res.json({ summary: calculateTransferSummary(transfers) });
});

module.exports = router;
