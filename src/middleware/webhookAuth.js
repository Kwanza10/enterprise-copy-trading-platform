const brokerAccountService = require('../services/brokerAccountService');

// Shared by every bridge-facing endpoint (master EAs posting trade events,
// follower EAs polling/reporting on copy commands) - each BrokerAccount
// carries its own webhook token issued once at creation (POST
// /api/broker-accounts), since bridges don't log in with a user JWT.
async function requireWebhookToken(req, res, next) {
  const token = req.headers['x-webhook-token'];
  if (!token) {
    return res.status(401).json({ error: 'X-Webhook-Token header is required.' });
  }

  try {
    const account = await brokerAccountService.getBrokerAccountByWebhookToken(token);
    if (!account || account.status !== 'active') {
      return res.status(401).json({ error: 'Invalid or inactive webhook token.' });
    }
    req.brokerAccount = account;
    return next();
  } catch (error) {
    console.error('Webhook token lookup failed:', error.message);
    return res.status(500).json({ error: 'Unable to verify webhook token.' });
  }
}

module.exports = { requireWebhookToken };
