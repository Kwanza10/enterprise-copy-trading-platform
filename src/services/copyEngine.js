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

// MT4/MT5 have no server-reachable trading API to call directly (unlike
// TradeLocker's REST /trade/* endpoints) - a follower on one of these
// platforms can only be acted on by an EA running inside that terminal, so
// its commands go through the poll/report bridge (see routes/ea.js) instead
// of being executed synchronously here.
const BRIDGE_PLATFORMS = ['mt4', 'mt5'];

// Shared by both the modify and close paths (for every follower platform):
// finds the follower's own position for a given master position, via the
// original position_opened event for that master position, then the
// executed copy of that event for this follower. Returns null if there's no
// matching open follower position (nothing to modify/close). Returns the
// full prior execution (not just its resultPositionId) because
// dispatchToTradeLocker also needs its calculatedSize - the last known
// follower position size - to detect a master-side partial
// close/add-on (see below).
async function resolveFollowerPriorExecution(masterAccountRow, followerAccountRow, tradeEvent) {
  const openEvent = tradeEvent.externalPositionId
    ? await tradeEventService.findOpenEventByExternalId(masterAccountRow.id, tradeEvent.externalPositionId)
    : null;
  const priorExecution = openEvent
    ? await copyExecutionService.findExecutedForTradeEvent(openEvent.id, followerAccountRow.id)
    : null;
  return priorExecution && priorExecution.resultPositionId ? priorExecution : null;
}

// A position_modified event's size is the master's *current* size, not a
// delta - the poller flags any size change (partial close or an add-on
// trade merged into the same position id) the same way it flags an SL/TP
// change, both as 'position_modified' (see tradeLockerPoller.positionHash).
// Below MIN_SIZE_DELTA is float noise from the .toFixed(2)/.toFixed(4)
// rounding in calculateFollowerSize, not a real change.
const MIN_SIZE_DELTA = 0.001;

async function syncFollowerPositionSize({ session, credentials, followerAccountRow, tradeEvent, mappedSymbol, targetPositionId, priorExecution, newSize }) {
  const previousSize = priorExecution.calculatedSize;
  if (previousSize === null || previousSize === undefined) return;

  const sizeDelta = Number((newSize - previousSize).toFixed(4));
  if (Math.abs(sizeDelta) < MIN_SIZE_DELTA) return;

  if (sizeDelta < 0) {
    // Partial close: well-defined against a specific position id/qty.
    await tradeLockerService.closePosition(session, {
      accNum: credentials.accNum,
      positionId: targetPositionId,
      qty: Math.abs(sizeDelta)
    });
  } else {
    // Add-on: this assumes the follower's TradeLocker account is in a
    // netting mode that merges a same-symbol/same-direction fill into the
    // existing position id, matching how the master's own size grew in
    // place rather than as a separate ticket. On a hedging-mode account
    // this instead opens a second, untracked position - TradeLocker's
    // netting-vs-hedging behavior per account type couldn't be confirmed
    // from docs alone (same class of gap tradeLockerService.js's own
    // column-resolution comments flag), so this is a best-effort mirror,
    // not a guaranteed one.
    await tradeLockerService.executeTrade({
      credentials,
      environment: followerAccountRow.environment,
      accountId: credentials.accountId,
      accNum: credentials.accNum,
      symbol: mappedSymbol,
      action: tradeEvent.side,
      size: sizeDelta
    });
  }

  await copyExecutionService.updateCalculatedSize(priorExecution.id, newSize);
}

async function dispatchToTradeLocker({ execution, tradeEvent, followerAccountRow, mappedSymbol, targetPositionId, priorExecution }) {
  try {
    const credentials = brokerAccountService.getDecryptedCredentials(followerAccountRow);
    const session = await tradeLockerService.authenticate(credentials, followerAccountRow.environment);

    if (tradeEvent.eventType === 'position_modified') {
      // Bring the follower's size in line with the master's first (only
      // meaningful for percent_of_master risk mode - fixed_lot/
      // percent_of_balance don't depend on masterSize, so their
      // calculatedSize is unchanged and this is a no-op for them), then
      // modify the follower's *existing* position's SL/TP in place - never
      // place a new order for an SL/TP-only change.
      await syncFollowerPositionSize({
        session,
        credentials,
        followerAccountRow,
        tradeEvent,
        mappedSymbol,
        targetPositionId,
        priorExecution,
        newSize: execution.calculatedSize
      });
      await tradeLockerService.modifyPosition(session, {
        accNum: credentials.accNum,
        positionId: targetPositionId,
        stopLoss: tradeEvent.sl,
        takeProfit: tradeEvent.tp
      });
      await copyExecutionService.markExecuted(execution.id, targetPositionId);
      return;
    }

    if (tradeEvent.eventType === 'position_closed') {
      await tradeLockerService.closePosition(session, {
        accNum: credentials.accNum,
        positionId: targetPositionId,
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

// Queues the command for the follower's EA to pick up on its next GET
// /api/ea/commands poll - leaves the execution row 'pending' (now with
// action/targetPositionId attached) rather than executing anything here,
// since only the EA, running inside that MT4/MT5 terminal, actually can.
async function dispatchToBridge({ execution, tradeEvent, followerAccountRow, targetPositionId }) {
  const action =
    tradeEvent.eventType === 'position_opened'
      ? 'open'
      : tradeEvent.eventType === 'position_closed'
        ? 'close'
        : 'modify';

  await copyExecutionService.queueForBridge(execution.id, { action, targetPositionId });
  console.log(
    `[copyEngine] Queued ${action} command for ${followerAccountRow.platform} follower ${followerAccountRow.id} (execution=${execution.id}) - awaiting EA poll.`
  );
}

async function dispatchExecution({ execution, tradeEvent, followerAccountRow, masterAccountRow, mappedSymbol }) {
  const isMutation = tradeEvent.eventType === 'position_modified' || tradeEvent.eventType === 'position_closed';
  let targetPositionId = null;
  let priorExecution = null;

  if (isMutation) {
    priorExecution = await resolveFollowerPriorExecution(masterAccountRow, followerAccountRow, tradeEvent);
    if (!priorExecution) {
      const verb = tradeEvent.eventType === 'position_modified' ? 'modify' : 'close';
      await copyExecutionService.markSkipped(execution.id, `No matching open follower position found to ${verb}.`);
      return;
    }
    targetPositionId = priorExecution.resultPositionId;
  }

  if (followerAccountRow.platform === 'tradelocker') {
    await dispatchToTradeLocker({ execution, tradeEvent, followerAccountRow, mappedSymbol, targetPositionId, priorExecution });
    return;
  }

  if (BRIDGE_PLATFORMS.includes(followerAccountRow.platform)) {
    await dispatchToBridge({ execution, tradeEvent, followerAccountRow, targetPositionId });
    return;
  }

  const verb = tradeEvent.eventType === 'position_closed' ? 'close' : tradeEvent.eventType === 'position_modified' ? 'modify' : 'open';
  const message = `Stub: ${followerAccountRow.platform} bridge not yet built - would ${verb} ${mappedSymbol} ${execution.calculatedSize} lots on account ${followerAccountRow.id}.`;
  console.log(`[copyEngine] STUB ${followerAccountRow.platform}: ${message}`);
  await copyExecutionService.markSkipped(execution.id, message);
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

  // Durable, DB-level dedup: catches a retried webhook delivery (or any
  // re-emitted event, from either source) before any follower fan-out or
  // real order placement happens - not just before it gets logged.
  if (tradeEvent.isDuplicate) {
    console.log(
      `[copyEngine] Duplicate trade event dropped: source=${tradeEvent.sourceAccountId} type=${tradeEvent.eventType} externalPositionId=${tradeEvent.externalPositionId}`
    );
    return tradeEvent;
  }

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
