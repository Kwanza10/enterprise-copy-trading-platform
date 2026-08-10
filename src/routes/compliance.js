const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { createComplianceEvent, summarizeComplianceEvents } = require('../services/complianceService');

const router = express.Router();
const complianceLog = [];

router.get('/events', requireAuth, (req, res) => {
  res.json({ count: complianceLog.length, events: complianceLog });
});

router.post('/events', requireAuth, (req, res) => {
  const { userId, eventType, severity, details } = req.body;

  if (!userId || !eventType) {
    return res.status(400).json({ error: 'userId and eventType are required.' });
  }

  const event = createComplianceEvent({ userId, eventType, severity, details });
  complianceLog.push(event);

  return res.status(201).json({ event });
});

router.get('/summary', requireAuth, (req, res) => {
  res.json({ summary: summarizeComplianceEvents(complianceLog) });
});

module.exports = router;
