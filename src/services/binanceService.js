const crypto = require('crypto');
const Binance = require('binance-api-node').default;
const { Pool } = require('pg');
const env = require('../config/env');
const cipher = require('../lib/credentialCipher');
const { evaluatePersistenceMode } = require('./databaseService');

const TESTNET_HTTP_BASE = 'https://testnet.binance.vision';

const memoryCredentialStore = new Map();
let pool = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      host: env.db.host,
      port: env.db.port,
      database: env.db.name,
      user: env.db.user,
      password: env.db.password
    });
  }
  return pool;
}

function usePostgres() {
  return evaluatePersistenceMode(process.env) === 'postgres';
}

async function saveCredentials(userId, { apiKey, apiSecret, testnet }) {
  const encrypted = cipher.encrypt({ apiKey, apiSecret, testnet: Boolean(testnet) });

  if (!usePostgres()) {
    memoryCredentialStore.set(userId, encrypted);
    return;
  }

  const db = getPool();
  const updated = await db.query(
    `UPDATE broker_connections SET api_key_encrypted = $1, status = 'connected'
     WHERE user_id = $2 AND broker_name = 'binance'`,
    [encrypted, userId]
  );

  if (updated.rowCount === 0) {
    await db.query(
      `INSERT INTO broker_connections (id, user_id, broker_name, broker_type, account_name, api_key_encrypted, status)
       VALUES ($1, $2, 'binance', 'crypto', 'Binance', $3, 'connected')`,
      [crypto.randomUUID(), userId, encrypted]
    );
  }
}

async function getCredentials(userId) {
  if (!usePostgres()) {
    const encrypted = memoryCredentialStore.get(userId);
    return encrypted ? cipher.decrypt(encrypted) : null;
  }

  const db = getPool();
  const result = await db.query(
    `SELECT api_key_encrypted FROM broker_connections
     WHERE user_id = $1 AND broker_name = 'binance' AND status = 'connected'
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );

  if (result.rows.length === 0) return null;
  return cipher.decrypt(result.rows[0].api_key_encrypted);
}

function createBinanceClient({ apiKey, apiSecret, testnet }) {
  const client = Binance({
    apiKey,
    apiSecret,
    httpBase: testnet ? TESTNET_HTTP_BASE : undefined
  });

  async function getTradeHistory(symbol) {
    if (!symbol) {
      throw new Error('symbol is required.');
    }

    const fills = await client.myTrades({ symbol });
    return matchTradesFifo(fills);
  }

  return { getTradeHistory };
}

// Binance's myTrades endpoint returns individual fills, not paired entry/exit
// trades. We reconstruct round-trip trades with FIFO lot matching so each
// closed position has a single entry price, exit price, and realized P&L.
function matchTradesFifo(fills) {
  const bySymbol = new Map();
  for (const fill of fills) {
    if (!bySymbol.has(fill.symbol)) bySymbol.set(fill.symbol, []);
    bySymbol.get(fill.symbol).push(fill);
  }

  const closedTrades = [];

  for (const symbolFills of bySymbol.values()) {
    symbolFills.sort((a, b) => a.time - b.time);
    const openLots = [];

    for (const fill of symbolFills) {
      const price = Number(fill.price);
      const qty = Number(fill.qty);
      const commission = Number(fill.commission || 0);

      if (fill.isBuyer) {
        openLots.push({ price, qty, time: fill.time, commission });
        continue;
      }

      let remaining = qty;
      let saleCommissionRemaining = commission;

      while (remaining > 0 && openLots.length > 0) {
        const lot = openLots[0];
        const matchedQty = Math.min(lot.qty, remaining);
        const lotCommissionShare = lot.commission * (matchedQty / lot.qty);
        const saleCommissionShare = saleCommissionRemaining * (matchedQty / remaining);
        const pnl = (price - lot.price) * matchedQty - lotCommissionShare - saleCommissionShare;

        closedTrades.push({
          symbol: fill.symbol,
          quantity: matchedQty,
          entryPrice: lot.price,
          exitPrice: price,
          entryDate: new Date(lot.time).toISOString(),
          exitDate: new Date(fill.time).toISOString(),
          pnl
        });

        lot.qty -= matchedQty;
        lot.commission -= lotCommissionShare;
        remaining -= matchedQty;
        saleCommissionRemaining -= saleCommissionShare;

        if (lot.qty <= 0) openLots.shift();
      }
    }
  }

  return closedTrades.sort((a, b) => new Date(a.exitDate) - new Date(b.exitDate));
}

function calculateMetrics(trades) {
  const totalTrades = trades.length;
  if (totalTrades === 0) {
    return {
      totalTrades: 0,
      totalPnl: 0,
      winRate: 0,
      winningTrades: 0,
      losingTrades: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0,
      largestWin: 0,
      largestLoss: 0
    };
  }

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
  const grossProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));

  return {
    totalTrades,
    totalPnl,
    winRate: (wins.length / totalTrades) * 100,
    winningTrades: wins.length,
    losingTrades: losses.length,
    avgWin: wins.length ? grossProfit / wins.length : 0,
    avgLoss: losses.length ? grossLoss / losses.length : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    largestWin: wins.length ? Math.max(...wins.map((t) => t.pnl)) : 0,
    largestLoss: losses.length ? Math.min(...losses.map((t) => t.pnl)) : 0
  };
}

async function testConnection({ apiKey, apiSecret, testnet }) {
  const client = Binance({
    apiKey,
    apiSecret,
    httpBase: testnet ? TESTNET_HTTP_BASE : undefined
  });
  await client.accountInfo();
}

module.exports = {
  saveCredentials,
  getCredentials,
  createBinanceClient,
  calculateMetrics,
  testConnection
};
