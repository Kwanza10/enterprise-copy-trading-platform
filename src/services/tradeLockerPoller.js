const env = require('../config/env');
const brokerAccountService = require('./brokerAccountService');
const tradeLockerService = require('./tradeLockerService');
const copyEngine = require('./copyEngine');

// Each master account gets its own independent setInterval (per spec: "safe
// under standard 2 req/sec limit," staggered starts). Because timers are
// independent and each poll cycle is wrapped in try/catch, one account's
// network error or rate-limit hit can never block or crash another account's
// polling loop - no shared loop / no need for a top-level Promise.allSettled
// batch, isolation is structural.

function findRateLimit(config, typeSubstrings) {
  const rateLimits = config.rateLimits || [];
  const entry = rateLimits.find((r) =>
    typeSubstrings.some((s) => String(r.rateLimitType || '').toUpperCase().includes(s))
  );
  if (!entry) return null;
  const intervalMs = entry.measure === 'MINUTES' ? entry.intervalNum * 60000 : entry.intervalNum * 1000;
  return { limit: entry.limit, intervalMs };
}

function positionHash(pos) {
  return `${pos.side}:${pos.size}:${pos.stopLoss}:${pos.takeProfit}`;
}

function buildEvent(eventType, accountRow, pos, instrumentsByTLId) {
  const instrument = instrumentsByTLId.get(String(pos.tradableInstrumentId));
  if (!instrument) {
    console.warn(
      `[tradeLockerPoller] account=${accountRow.id} could not resolve instrument name for tradableInstrumentId=${pos.tradableInstrumentId} - falling back to raw id as symbol, follower execution will fail to match it.`
    );
  }
  return {
    sourceAccountId: accountRow.id,
    eventType,
    symbol: instrument ? instrument.name : String(pos.tradableInstrumentId),
    side: pos.side,
    size: pos.size,
    price: pos.openPrice,
    sl: pos.stopLoss,
    tp: pos.takeProfit,
    externalPositionId: String(pos.id),
    source: 'poll',
    rawPayload: pos
  };
}

function diffPositions(accountRow, positions, prevMap, instrumentsByTLId) {
  const currentMap = new Map();
  const events = [];

  for (const pos of positions) {
    const id = String(pos.id);
    const hash = positionHash(pos);
    currentMap.set(id, { hash, pos });

    const prev = prevMap.get(id);
    if (!prev) {
      events.push(buildEvent('position_opened', accountRow, pos, instrumentsByTLId));
    } else if (prev.hash !== hash) {
      events.push(buildEvent('position_modified', accountRow, pos, instrumentsByTLId));
    }
  }

  for (const [id, prev] of prevMap) {
    if (!currentMap.has(id)) {
      events.push(buildEvent('position_closed', accountRow, prev.pos, instrumentsByTLId));
    }
  }

  return { currentMap, events };
}

async function initAccountContext(accountRow) {
  const credentials = brokerAccountService.getDecryptedCredentials(accountRow);
  const session = await tradeLockerService.authenticate(credentials, accountRow.environment);
  const config = await tradeLockerService.getConfig(session, credentials.accNum);
  const columnResolver = tradeLockerService.buildColumnResolver(config);
  console.log(`[tradeLockerPoller] account=${accountRow.id} resolved position columns:`, columnResolver);
  const instruments = await tradeLockerService.listInstruments(session, credentials.accountId, credentials.accNum);
  // Keyed by String(tradableInstrumentId): /instruments returns it as a JSON
  // number but /positions' column-array rows aren't guaranteed to match that
  // type, and Map key lookup is strict-equality - a silent type mismatch here
  // was exactly what caused symbol resolution to fall back to the raw id.
  const instrumentsByTLId = new Map(instruments.map((i) => [String(i.tradableInstrumentId), i]));

  const rateLimit = findRateLimit(config, ['POSITION']);
  const minGapMs = rateLimit ? Math.ceil(rateLimit.intervalMs / rateLimit.limit) : 0;
  const effectiveIntervalMs = Math.max(env.tradeLocker.pollIntervalMs, minGapMs);

  return { lastPositions: new Map(), instrumentsByTLId, columnResolver, effectiveIntervalMs, credentials };
}

// Seeds ctx.lastPositions from whatever is already open on the master before
// the very first diff runs. Without this, every (re)start of the poller -
// e.g. a deploy - sees an empty lastPositions map and diffPositions treats
// every pre-existing position as brand new, re-emitting position_opened for
// positions that were already open (and likely already copied) before this
// process started, duplicating follower trades on every restart.
async function primeAccountContext(accountRow, ctx) {
  try {
    const session = await tradeLockerService.authenticate(ctx.credentials, accountRow.environment);
    const rawPositions = await tradeLockerService.getPositions(session, ctx.credentials.accountId, ctx.credentials.accNum);
    const positions = rawPositions.map((row) => tradeLockerService.mapPositionRow(row, ctx.columnResolver));

    const primedMap = new Map();
    for (const pos of positions) {
      primedMap.set(String(pos.id), { hash: positionHash(pos), pos });
    }
    ctx.lastPositions = primedMap;

    console.log(
      `[tradeLockerPoller] account=${accountRow.id} primed with ${positions.length} pre-existing position(s) - won't re-emit position_opened for these.`
    );
  } catch (error) {
    console.error(
      `[tradeLockerPoller] account=${accountRow.id} failed to prime existing positions, first cycle may re-emit duplicate opens: ${error.message}`
    );
  }
}

async function runCycle(accountRow, ctx) {
  const start = Date.now();
  try {
    const session = await tradeLockerService.authenticate(ctx.credentials, accountRow.environment);
    const rawPositions = await tradeLockerService.getPositions(session, ctx.credentials.accountId, ctx.credentials.accNum);
    const positions = rawPositions.map((row) => tradeLockerService.mapPositionRow(row, ctx.columnResolver));

    const { currentMap, events } = diffPositions(accountRow, positions, ctx.lastPositions, ctx.instrumentsByTLId);
    ctx.lastPositions = currentMap;

    for (const event of events) {
      await copyEngine.processTradeEvent(event);
    }

    console.log(
      `[tradeLockerPoller] account=${accountRow.id} cycleMs=${Date.now() - start} positions=${positions.length} events=${events.length}`
    );
  } catch (error) {
    console.error(`[tradeLockerPoller] account=${accountRow.id} poll cycle failed: ${error.message}`);
  }
}

async function setupAccountPolling(accountRow) {
  let ctx;
  try {
    ctx = await initAccountContext(accountRow);
  } catch (error) {
    console.error(`[tradeLockerPoller] account=${accountRow.id} failed to initialize, will not poll: ${error.message}`);
    return;
  }

  await primeAccountContext(accountRow, ctx);

  console.log(`[tradeLockerPoller] account=${accountRow.id} polling every ${ctx.effectiveIntervalMs}ms`);
  runCycle(accountRow, ctx);
  setInterval(() => runCycle(accountRow, ctx), ctx.effectiveIntervalMs);
}

async function start() {
  console.log(
    `[tradeLockerPoller] TL_DEVELOPER_API_KEY: ${env.tradeLocker.developerApiKey ? 'present' : 'not set - using default rate limits'}`
  );

  let masterAccounts = [];
  try {
    masterAccounts = await brokerAccountService.listAccountsByPlatformAndRole('tradelocker', 'master');
  } catch (error) {
    console.error(`[tradeLockerPoller] Could not load TradeLocker master accounts, poller idle: ${error.message}`);
    return;
  }

  if (masterAccounts.length === 0) {
    console.log('[tradeLockerPoller] No TradeLocker master accounts found - poller idle.');
    return;
  }

  const staggerWindowMs = env.tradeLocker.pollIntervalMs;
  masterAccounts.forEach((accountRow, index) => {
    const staggerDelay = Math.floor((index / masterAccounts.length) * staggerWindowMs);
    setTimeout(() => setupAccountPolling(accountRow), staggerDelay);
  });
}

module.exports = { start };
