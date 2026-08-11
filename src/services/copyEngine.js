const brokerAccountService = require('./brokerAccountService');
const copyRelationshipService = require('./copyRelationshipService');
const symbolMappingService = require('./symbolMappingService');
const tradeEventService = require('./tradeEventService');
const copyExecutionService = require('./copyExecutionService');
const tradeLockerService = require('./tradeLockerService');

// Simplified, documented approximation of USD value per 1.0 standard lot,
// used only for the percent_of_balance risk mode's sizing formula
// (riskAmount / pipValue, per spec). Ignores live conversion rates, JPY-pair
// pip sizing, and stop-loss distance - a real implementation should source
// per-instrument pip value from the broker rather than this static table.
const APPROX_USD_VALUE_PER_LOT = {
  XAUUSD: 100,
  US30: 10,
  NAS100: 20,
  DEFAULT: 10
};

function pipValueFor(symbol) {
  return APPROX_USD_VALUE_PER_LOT[String(symbol).toUpperCase()] || APPROX_USD_VALUE_PER_LOT.DEFAULT;
}

function calculateFollowerSize({ riskMode, riskValue, masterSize, followerBalance, symbol }) {
  switch (riskMode) {
    case 'fixed_lot':
      return riskValue;
    case 'percent_of_master':
      return Number((Number(masterSize || 0) * (riskValue / 100)).toFixed(2));
    case 'percent_of_balance': {
      const riskAmount = followerBalance * (riskValue / 100);
      return Number((riskAmount / pipValueFor(symbol)).toFixed(2));
    }
    default:
      throw new Error(`Unknown riskMode "${riskMode}".`);
  }
}

async function dispatchExecution({ execution, tradeEvent, followerAccountRow, masterAccountRow, mappedSymbol }) {
  if (tradeEvent.eventType === 'position_modified') {
    await copyExecutionService.markSkipped(
      execution.id,
      'position_modified events are not mirrored in Phase 1 (SL/TP sync not yet implemented).'
    );
    return;
  }

  if (followerAccountRow.platform !== 'tradelocker') {
    const verb = tradeEvent.eventType === 'position_closed' ? 'close' : 'open';
    const message = `Stub: ${followerAccountRow.platform} bridge not yet built - would ${verb} ${mappedSymbol} ${execution.calculatedSize} lots on account ${followerAccountRow.id}.`;
    console.log(`[copyEngine] STUB ${followerAccountRow.platform}: ${message}`);
    await copyExecutionService.markSkipped(execution.id, message);
    return;
  }

  try {
    const credentials = brokerAccountService.getDecryptedCredentials(followerAccountRow);

    if (tradeEvent.eventType === 'position_closed') {
      const openEvent = tradeEvent.externalPositionId
        ? await tradeEventService.findOpenEventByExternalId(masterAccountRow.id, tradeEvent.externalPositionId)
        : null;
      const priorExecution = openEvent
        ? await copyExecutionService.findExecutedForTradeEvent(openEvent.id, followerAccountRow.id)
        : null;

      if (!priorExecution || !priorExecution.resultPositionId) {
        await copyExecutionService.markSkipped(execution.id, 'No matching open follower position found to close.');
        return;
      }

      const session = await tradeLockerService.authenticate(credentials, followerAccountRow.environment);
      await tradeLockerService.closePosition(session, {
        accNum: credentials.accNum,
        positionId: priorExecution.resultPositionId,
        qty: 0
      });
      await copyExecutionService.markExecuted(execution.id);
      return;
    }

    const order = await tradeLockerService.executeTrade({
      credentials,
      environment: followerAccountRow.environment,
      accountId: credentials.accountId,
      accNum: credentials.accNum,
      symbol: mappedSymbol,
      action: tradeEvent.side,
      size: execution.calculatedSize
    });

    const resultPositionId = order && (order.positionId || order.orderId || order.id);
    await copyExecutionService.markExecuted(execution.id, resultPositionId ? String(resultPositionId) : null);
  } catch (error) {
    await copyExecutionService.markFailed(execution.id, error.message);
  }
}

async function processRelationship({ relationship, tradeEvent, masterAccountRow }) {
  const followerAccountRow = await brokerAccountService.getBrokerAccountRowById(relationship.followerAccountId);
  if (!followerAccountRow || followerAccountRow.status !== 'active') {
    return;
  }

  const mappedSymbol = await symbolMappingService.resolveSymbol({
    userId: relationship.followerUserId,
    sourcePlatform: masterAccountRow.platform,
    sourceSymbol: tradeEvent.symbol,
    targetPlatform: followerAccountRow.platform
  });

  const calculatedSize = calculateFollowerSize({
    riskMode: relationship.riskMode,
    riskValue: relationship.riskValue,
    masterSize: tradeEvent.size,
    followerBalance: Number(followerAccountRow.balance),
    symbol: mappedSymbol
  });

  const execution = await copyExecutionService.createExecution({
    tradeEventId: tradeEvent.id,
    followerAccountId: followerAccountRow.id,
    calculatedSize,
    mappedSymbol
  });

  await dispatchExecution({ execution, tradeEvent, followerAccountRow, masterAccountRow, mappedSymbol });
}

// Single entry point for both the webhook receiver and the TradeLocker
// poller - callers must never branch on where the event came from.
async function processTradeEvent(input) {
  const tradeEvent = await tradeEventService.createTradeEvent(input);
  await tradeEventService.updateStatus(tradeEvent.id, 'processing');

  try {
    const masterAccountRow = await brokerAccountService.getBrokerAccountRowById(tradeEvent.sourceAccountId);
    if (!masterAccountRow) {
      await tradeEventService.updateStatus(tradeEvent.id, 'failed');
      return tradeEvent;
    }

    const relationships = await copyRelationshipService.getActiveRelationshipsForMaster(masterAccountRow.id);

    await Promise.allSettled(
      relationships.map((relationship) => processRelationship({ relationship, tradeEvent, masterAccountRow }))
    );

    await tradeEventService.updateStatus(tradeEvent.id, 'completed');
  } catch (error) {
    console.error('[copyEngine] processTradeEvent failed:', error.message);
    await tradeEventService.updateStatus(tradeEvent.id, 'failed');
  }

  return tradeEvent;
}

module.exports = { processTradeEvent, calculateFollowerSize };
