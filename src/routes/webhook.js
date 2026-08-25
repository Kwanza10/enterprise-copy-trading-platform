const express = require('express');
const brokerAccountService = require('../services/brokerAccountService');
const tradeEventService = require('../services/tradeEventService');
const tradeQueue = require('../lib/tradeQueue');

const router = express.Router();

const EVENT_TYPES = ['position_opened', 'position_closed', 'position_modified'];
const SIDES = ['buy', 'sell'];

function validatePayload(body) {
  if (!EVENT_TYPES.includes(body.eventType)) {
    return `eventType must be one of: ${EVENT_TYPES.join(', ')}`;
  }
  if (!body.symbol || typeof body.symbol !== 'string') {
    return 'symbol is required.';
  }
  if (!body.externalPositionId) {
    return 'externalPositionId is required so opens/closes/modifies can be correlated.';
  }
  if (body.eventType !== 'position_closed') {
    if (!SIDES.includes(body.side)) {
      return `side must be one of: ${SIDES.join(', ')} (required for ${body.eventType}).`;
    }
    if (typeof body.size !== 'number' || body.size <= 0) {
      return 'size must be a positive number.';
    }
  }
  return null;
}

// Bridges (MT4/5 EAs) don't log in - each BrokerAccount carries
// its own webhook token, issued once at creation (POST /api/broker-accounts).
router.post('/trade', async (req, res) => {
  const token = req.headers['x-webhook-token'];
  if (!token) {
    return res.status(401).json({ error: 'X-Webhook-Token header is required.' });
  }

  let account;
  try {
    account = await brokerAccountService.getBrokerAccountByWebhookToken(token);
  } catch (error) {
    console.error('Webhook token lookup failed:', error.message);
    return res.status(500).json({ error: 'Unable to verify webhook token.' });
  }

  if (!account || account.status !== 'active') {
    return res.status(401).json({ error: 'Invalid or inactive webhook token.' });
  }

  brokerAccountService.touchLastSeen(account.id).catch((error) => {
    console.error('Failed to update last-seen for webhook account', account.id, error.message);
  });

  const validationError = validatePayload(req.body || {});
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const externalPositionId = String(req.body.externalPositionId);

  // Bridges retry a webhook POST on timeout/connection-reset without any
  // idempotency key of their own, which would otherwise re-copy (or
  // re-close) the same master position to followers a second time. Treat a
  // same-state event for the same master position arriving again within a
  // few seconds as a retry, not a new event.
  try {
    const duplicate = await tradeEventService.findRecentDuplicate({
      sourceAccountId: account.id,
      eventType: req.body.eventType,
      externalPositionId,
      side: req.body.side || null,
      size: req.body.size ?? null,
      sl: req.body.sl ?? null,
      tp: req.body.tp ?? null
    });
    if (duplicate) {
      return res.status(200).json({ received: true, duplicate: true });
    }
  } catch (error) {
    console.error('Webhook idempotency check failed:', error.message);
    return res.status(500).json({ error: 'Unable to verify webhook event.' });
  }

  // Respond immediately so the sending bridge doesn't time out or retry;
  // actual copy-engine processing happens off the request/response cycle.
  res.status(200).json({ received: true });

  tradeQueue.push({
    sourceAccountId: account.id,
    eventType: req.body.eventType,
    symbol: req.body.symbol,
    side: req.body.side || null,
    size: req.body.size ?? null,
    price: req.body.price ?? null,
    sl: req.body.sl ?? null,
    tp: req.body.tp ?? null,
    externalPositionId,
    source: 'webhook',
    rawPayload: req.body
  });
});

module.exports = router;
