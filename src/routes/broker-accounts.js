const express = require('express');
const { requireAuth } = require('../middleware/auth');
const brokerAccountService = require('../services/brokerAccountService');
const tradeLockerService = require('../services/tradeLockerService');

const router = express.Router();

router.use(requireAuth);

router.post('/', async (req, res) => {
  const { platform, role, label, environment, credentials, balance } = req.body;

  if (!credentials || typeof credentials !== 'object') {
    return res.status(400).json({ error: 'credentials object is required.' });
  }

  try {
    let resolvedCredentials = credentials;

    // TradeLocker's /trade/* endpoints require an accNum header identifying
    // which account to act on. Resolve it once here (via /auth/jwt/all-accounts)
    // rather than requiring the caller to already know their numeric account
    // number - see tradeLockerService.resolveAccountSelection for why this
    // only auto-picks when unambiguous.
    if (platform === 'tradelocker') {
      try {
        const { accountId, accNum } = await tradeLockerService.resolveAccountSelection(
          credentials,
          environment || 'demo'
        );
        resolvedCredentials = { ...credentials, accountId, accNum };
      } catch (error) {
        return res.status(400).json({ error: `TradeLocker account resolution failed: ${error.message}` });
      }
    }

    const { account, webhookToken } = await brokerAccountService.createBrokerAccount({
      userId: req.user.sub,
      platform,
      role,
      label,
      environment,
      credentials: resolvedCredentials,
      balance
    });

    // webhookToken is only ever shown here, at creation time - it's stored
    // hashed, not retrievable again. If it's lost, use
    // POST /:id/webhook-token/regenerate below instead of recreating the account.
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

// Invalidates the current webhook token and issues a new one - the only way
// to recover from a lost token, since it's never stored anywhere but its
// hash. Any bridge/EA still using the old token starts getting 401s
// immediately and needs its config updated with the new one.
router.post('/:id/webhook-token/regenerate', async (req, res) => {
  try {
    const account = await brokerAccountService.getBrokerAccountRowById(req.params.id);
    if (!account || account.user_id !== req.user.sub) {
      return res.status(404).json({ error: 'Broker account not found.' });
    }

    const result = await brokerAccountService.regenerateWebhookToken(req.params.id);
    return res.json(result);
  } catch (error) {
    console.error('Failed to regenerate webhook token:', error.message);
    return res.status(500).json({ error: 'Unable to regenerate webhook token.' });
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
