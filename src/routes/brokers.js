const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  listBrokerProviders,
  createBrokerConnection,
  getBrokerStatus
} = require('../services/brokerService');

const router = express.Router();

router.get('/providers', requireAuth, (req, res) => {
  res.json({ brokers: listBrokerProviders() });
});

router.get('/providers/:brokerId', requireAuth, (req, res) => {
  const broker = getBrokerStatus(req.params.brokerId);
  if (!broker) {
    return res.status(404).json({ error: 'Broker provider not found.' });
  }

  return res.json({ broker });
});

router.post('/connect', requireAuth, (req, res) => {
  const { brokerName, brokerType, accountName } = req.body;

  if (!brokerName || !brokerType || !accountName) {
    return res.status(400).json({ error: 'brokerName, brokerType, and accountName are required.' });
  }

  const connection = createBrokerConnection({
    userId: req.user.sub,
    brokerName,
    brokerType,
    accountName
  });

  return res.status(201).json({ connection });
});

module.exports = router;
