const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createMarketTick,
  buildMarketOverview
} = require('../src/services/marketDataService');

test('createMarketTick produces a valid market tick snapshot', () => {
  const tick = createMarketTick({
    symbol: 'EURUSD',
    bid: 1.0852,
    ask: 1.0856,
    volume: 4200
  });

  assert.equal(tick.symbol, 'EURUSD');
  assert.equal(tick.bid, 1.0852);
  assert.equal(tick.ask, 1.0856);
  assert.ok(tick.midPrice > 1.08);
  assert.ok(tick.timestamp);
});

test('buildMarketOverview summarizes trend and volatility across symbols', () => {
  const overview = buildMarketOverview([
    { symbol: 'EURUSD', change: 0.42, volume: 3000 },
    { symbol: 'BTCUSD', change: -1.4, volume: 8800 },
    { symbol: 'XAUUSD', change: 0.9, volume: 1500 }
  ]);

  assert.equal(overview.count, 3);
  assert.equal(overview.gainers, 2);
  assert.equal(overview.losers, 1);
  assert.equal(overview.totalVolume, 13300);
  assert.ok(['bullish', 'mixed', 'bearish'].includes(overview.marketBias));
});
