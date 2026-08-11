const express = require('express');
const { requireAuth } = require('../middleware/auth');
const brokerAccountService = require('../services/brokerAccountService');

const router = express.Router();

router.use(requireAuth);

router.post('/', async (req, res) => {
  const { platform, role, label, environment, credentials, balance } = req.body;

  if (!credentials || typeof credentials !== 'object') {
    return res.status(400).json({ error: 'credentials object is required.' });
  }

  try {
    const { account, webhookToken } = await brokerAccountService.createBrokerAccount({
      userId: req.user.sub,
      platform,
      role,
      label,
      environment,
      credentials,
      balance
    });

    // webhookToken is only ever shown here, at creation time - it's stored
    // hashed, not retrievable again, so the bridge/EA config must capture it now.
    return res.status(201).json({ account, webhookToken });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const accounts = await brokerAccountService.listBrokerAccountsForUser(req.user.sub);
    return res.json({ accounts });
  } catch (error) {
    console.error('Failed to list broker accounts:', error.message);
    return res.status(500).json({ error: 'Unable to list broker accounts.' });
  }
});

// Soft delete: keeps history intact for past TradeEvents/CopyExecutions
// that reference this account, just stops it from being polled/matched.
router.delete('/:id', async (req, res) => {
  try {
    const account = await brokerAccountService.getBrokerAccountRowById(req.params.id);
    if (!account || account.user_id !== req.user.sub) {
      return res.status(404).json({ error: 'Broker account not found.' });
    }
    await brokerAccountService.updateStatus(req.params.id, 'disabled');
    return res.status(204).send();
  } catch (error) {
    console.error('Failed to remove broker account:', error.message);
    return res.status(500).json({ error: 'Unable to remove broker account.' });
  }
});

module.exports = router;
