const express = require('express');
const brokerAccountService = require('../services/brokerAccountService');
const mtBridgeService = require('../services/mtBridgeService');
const copyExecutionService = require('../services/copyExecutionService');

const router = express.Router();

const RESULT_STATUSES = ['executed', 'failed'];

// Same per-account token used by /api/webhook/trade - an MT4/5 EA uses one
// token for both directions: posting its own trade events there, and
// polling/acking commands here when it's a follower.
async function authenticate(req, res) {
  const token = req.headers['x-webhook-token'];
  if (!token) {
    res.status(401).json({ error: 'X-Webhook-Token header is required.' });
    return null;
  }

  let account;
  try {
    account = await brokerAccountService.getBrokerAccountByWebhookToken(token);
  } catch (error) {
    console.error('Bridge token lookup failed:', error.message);
    res.status(500).json({ error: 'Unable to verify webhook token.' });
    return null;
  }

  if (!account || account.status !== 'active') {
    res.status(401).json({ error: 'Invalid or inactive webhook token.' });
    return null;
  }

  return account;
}

// Polled by the EA on a timer. Each call claims (marks 'sent') whatever is
// pending for this account so a retried poll can't be handed - and thus
// risk double-executing - the same command twice.
router.get('/commands', async (req, res) => {
  const account = await authenticate(req, res);
  if (!account) return;

  try {
    const commands = await mtBridgeService.claimPendingCommands(account.id);
    res.json({ commands });
  } catch (error) {
    console.error('Failed to claim bridge commands:', error.message);
    res.status(500).json({ error: 'Unable to fetch pending commands.' });
  }
});

// Reported by the EA after it attempts a command locally (OrderSend /
// OrderClose / OrderModify). Finalizes both the command row and the
// copy_executions row it was created for, so later events (e.g. a
// position_closed needing this open's resultPositionId) see the outcome.
router.post('/commands/:id/ack', async (req, res) => {
  const account = await authenticate(req, res);
  if (!account) return;

  const { status, resultPositionId, errorMessage } = req.body || {};
  if (!RESULT_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${RESULT_STATUSES.join(', ')}` });
  }

  try {
    const command = await mtBridgeService.ackCommand({
      commandId: req.params.id,
      followerAccountId: account.id,
      resultStatus: status,
      resultPositionId: resultPositionId ? String(resultPositionId) : null,
      errorMessage: errorMessage || null
    });

    if (!command) {
      return res.status(404).json({ error: 'Command not found, not yours, or already acknowledged.' });
    }

    if (status === 'executed') {
      // For close/modify, the EA doesn't need to report a ticket back - the
      // position id doesn't change, so fall back to what this command
      // already targeted. Only 'open' commands rely on the EA reporting the
      // new ticket it just created.
      const effectiveResultPositionId = command.resultPositionId || command.targetPositionId;
      await copyExecutionService.markExecuted(command.executionId, effectiveResultPositionId);
    } else {
      await copyExecutionService.markFailed(command.executionId, errorMessage || 'EA reported failure.');
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Failed to ack bridge command:', error.message);
    res.status(500).json({ error: 'Unable to acknowledge command.' });
  }
});

module.exports = router;
