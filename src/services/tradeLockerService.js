const crypto = require('crypto');
const env = require('../config/env');

// Session cache keyed by a fingerprint of (email, server, environment) so
// repeated calls (esp. from the poller, every TL_POLL_INTERVAL_MS) reuse the
// same JWT instead of re-authenticating and burning through rate limits.
const sessionCache = new Map();

function resolveBaseUrl(environment) {
  return environment === 'live' ? env.tradeLocker.liveBaseUrl : env.tradeLocker.demoBaseUrl;
}

function fingerprint(credentials, environment) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ email: credentials.email, server: credentials.server, environment }))
    .digest('hex');
}

function buildHeaders(accessToken, accNum) {
  const headers = { 'Content-Type': 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (accNum !== undefined && accNum !== null) headers.accNum = String(accNum);
  if (env.tradeLocker.developerApiKey) headers['developer-api-key'] = env.tradeLocker.developerApiKey;
  return headers;
}

async function request(baseUrl, requestPath, { method = 'GET', accessToken, accNum, body } = {}) {
  const res = await fetch(`${baseUrl}${requestPath}`, {
    method,
    headers: buildHeaders(accessToken, accNum),
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data.errmsg || data.message || res.statusText;
    throw new Error(`TradeLocker ${method} ${requestPath} failed: ${res.status} ${message}`);
  }
  return data;
}

function unwrap(data) {
  return data && data.d ? data.d : data;
}

async function authenticate(credentials, environment) {
  const key = fingerprint(credentials, environment);
  const cached = sessionCache.get(key);
  if (cached && new Date(cached.expireDate).getTime() - Date.now() > 30000) {
    return cached;
  }

  const baseUrl = resolveBaseUrl(environment);
  const data = await request(baseUrl, '/auth/jwt/token', {
    method: 'POST',
    body: { email: credentials.email, password: credentials.password, server: credentials.server }
  });

  const session = { accessToken: data.accessToken, expireDate: data.expireDate, baseUrl };
  sessionCache.set(key, session);
  return session;
}

async function listAccounts(session) {
  const data = await request(session.baseUrl, '/auth/jwt/all-accounts', { accessToken: session.accessToken });
  const payload = unwrap(data);
  return payload.accounts || [];
}

// /trade/* endpoints require an accNum header identifying which of the
// login's accounts to act on - TradeLocker's docs don't expose a "default
// account" flag, so auto-picking is only safe when exactly one account
// exists. With multiple, guessing wrong means trading on the wrong account,
// so this fails closed and lists the choices instead of silently choosing.
async function resolveAccountSelection(credentials, environment) {
  if (credentials.accountId && credentials.accNum) {
    return { accountId: credentials.accountId, accNum: credentials.accNum };
  }

  const session = await authenticate(credentials, environment);
  const accounts = await listAccounts(session);
  const active = accounts.filter((a) => a.status === 'ACTIVE');
  const candidates = active.length > 0 ? active : accounts;

  if (candidates.length === 0) {
    throw new Error('No TradeLocker accounts found for these credentials.');
  }
  if (candidates.length > 1) {
    const summary = candidates
      .map((a) => `${a.name} (accountId=${a.id}, accNum=${a.accNum}, ${a.currency})`)
      .join('; ');
    throw new Error(
      `Multiple TradeLocker accounts found - specify accountId and accNum explicitly. Available: ${summary}`
    );
  }

  return { accountId: candidates[0].id, accNum: candidates[0].accNum };
}

async function listInstruments(session, accountId, accNum) {
  const data = await request(session.baseUrl, `/trade/accounts/${accountId}/instruments`, {
    accessToken: session.accessToken,
    accNum
  });
  return unwrap(data).instruments || [];
}

function resolveInstrument(instruments, symbol) {
  const match = instruments.find(
    (i) => i.name === symbol || i.name.toUpperCase() === String(symbol).toUpperCase()
  );
  if (!match) {
    throw new Error(`TradeLocker instrument not found for symbol "${symbol}".`);
  }
  const route = (match.routes || []).find((r) => r.type === 'TRADE') || (match.routes || [])[0];
  if (!route) {
    throw new Error(`TradeLocker instrument "${symbol}" has no trade route configured.`);
  }
  return { tradableInstrumentId: match.tradableInstrumentId, routeId: route.id };
}

async function placeMarketOrder(session, { accountId, accNum, tradableInstrumentId, routeId, side, qty }) {
  const data = await request(session.baseUrl, `/trade/accounts/${accountId}/orders`, {
    method: 'POST',
    accessToken: session.accessToken,
    accNum,
    body: { qty, routeId, side, validity: 'IOC', type: 'market', tradableInstrumentId, price: 0 }
  });
  return unwrap(data);
}

async function closePosition(session, { accNum, positionId, qty }) {
  const data = await request(session.baseUrl, `/trade/positions/${positionId}`, {
    method: 'DELETE',
    accessToken: session.accessToken,
    accNum,
    body: { qty: qty || 0 }
  });
  return unwrap(data);
}

async function getPositions(session, accountId, accNum) {
  const data = await request(session.baseUrl, `/trade/accounts/${accountId}/positions`, {
    accessToken: session.accessToken,
    accNum
  });
  return unwrap(data).positions || [];
}

async function getConfig(session, accNum) {
  const data = await request(session.baseUrl, `/trade/config`, {
    accessToken: session.accessToken,
    accNum
  });
  return unwrap(data);
}

// Positions/orders come back as column-index arrays; the field order is only
// known via /trade/config's *Config.columns. Build a { fieldName -> index }
// map once per config fetch, matching column ids against known candidate
// names. TradeLocker's exact column id strings couldn't be confirmed from
// docs alone (no live response was reachable while building this), so
// matching is normalized (strips spaces/underscores/case) and candidate
// lists are intentionally broad - see resolveColumnIndex's thrown error and
// the raw-columns log in getConfig callers for how a real mismatch surfaces.
const FIELD_CANDIDATES = {
  id: ['id', 'positionid', 'position', 'ticket', 'orderid'],
  tradableInstrumentId: ['tradableinstrumentid', 'instrumentid', 'instrument'],
  side: ['side', 'direction', 'buysell'],
  size: ['qty', 'quantity', 'size', 'volume', 'lots', 'lotsize'],
  openPrice: ['openprice', 'price', 'avgprice', 'averageprice', 'entryprice'],
  stopLoss: ['stoploss', 'sl'],
  takeProfit: ['takeprofit', 'tp'],
  openDate: ['opendate', 'timestamp', 'opentime', 'createddate', 'createddate', 'date']
};

function normalizeColumnKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Fields a caller can't safely proceed without - if these don't resolve,
// downstream position-diffing silently breaks (e.g. every position getting
// the same undefined id) instead of failing visibly, so this throws instead.
const REQUIRED_FIELDS = ['id', 'side', 'size'];

function buildColumnResolver(columnsConfig) {
  const columns = (columnsConfig && columnsConfig.positionsConfig && columnsConfig.positionsConfig.columns) || [];
  const indexByField = {};

  for (const [field, candidates] of Object.entries(FIELD_CANDIDATES)) {
    const normalizedCandidates = candidates.map(normalizeColumnKey);
    const idx = columns.findIndex((col) => {
      const key = normalizeColumnKey(col.id || col.field || col.title || col.name || '');
      return normalizedCandidates.includes(key);
    });
    if (idx >= 0) indexByField[field] = idx;
  }

  const missingRequired = REQUIRED_FIELDS.filter((field) => indexByField[field] === undefined);
  if (missingRequired.length > 0) {
    const rawColumns = columns.map((c) => c.id || c.field || c.title || c.name || JSON.stringify(c));
    throw new Error(
      `TradeLocker positionsConfig column resolution failed for: ${missingRequired.join(', ')}. ` +
      `Raw columns from /trade/config: [${rawColumns.join(', ')}]. Update FIELD_CANDIDATES in tradeLockerService.js to match.`
    );
  }

  return indexByField;
}

function mapPositionRow(row, columnResolver) {
  const at = (field) => (columnResolver[field] !== undefined ? row[columnResolver[field]] : undefined);
  return {
    id: at('id'),
    tradableInstrumentId: at('tradableInstrumentId'),
    side: at('side'),
    size: at('size'),
    openPrice: at('openPrice'),
    stopLoss: at('stopLoss'),
    takeProfit: at('takeProfit'),
    openDate: at('openDate')
  };
}

function extractRateLimit(config, rateLimitType) {
  const rateLimits = config.rateLimits || [];
  const entry = rateLimits.find((r) => r.rateLimitType === rateLimitType);
  if (!entry) return null;
  const intervalMs = entry.measure === 'MINUTES' ? entry.intervalNum * 60000 : entry.intervalNum * 1000;
  return { limit: entry.limit, intervalMs };
}

async function executeTrade({ credentials, environment, accountId, accNum, symbol, action, size }) {
  if (action === 'close') {
    throw new Error('Use closePosition() with an external_position_id for close actions.');
  }

  const session = await authenticate(credentials, environment);
  const instruments = await listInstruments(session, accountId, accNum);
  const { tradableInstrumentId, routeId } = resolveInstrument(instruments, symbol);
  return placeMarketOrder(session, { accountId, accNum, tradableInstrumentId, routeId, side: action, qty: size });
}

module.exports = {
  authenticate,
  listAccounts,
  resolveAccountSelection,
  listInstruments,
  resolveInstrument,
  placeMarketOrder,
  closePosition,
  getPositions,
  getConfig,
  buildColumnResolver,
  mapPositionRow,
  extractRateLimit,
  executeTrade
};
