const express = require('express');
const { createMarketTick, buildMarketOverview } = require('../services/marketDataService');

const router = express.Router();
const marketSnapshots = [
  createMarketTick({ symbol: 'EURUSD', bid: 1.0852, ask: 1.0856, volume: 4200 }),
  createMarketTick({ symbol: 'BTCUSD', bid: 65810, ask: 65880, volume: 9800 }),
  createMarketTick({ symbol: 'XAUUSD', bid: 2334.1, ask: 2334.8, volume: 1500 })
];

router.get('/ticks', (req, res) => {
  res.json({ count: marketSnapshots.length, ticks: marketSnapshots });
});

router.get('/overview', (req, res) => {
  const inputs = marketSnapshots.map((tick) => ({
    symbol: tick.symbol,
    change: Number((Math.random() * 2 - 1).toFixed(2)),
    volume: tick.volume
  }));

  res.json({ overview: buildMarketOverview(inputs) });
});

router.post('/tick', (req, res) => {
  const { symbol, bid, ask, volume } = req.body;

  if (!symbol || bid == null || ask == null) {
    return res.status(400).json({ error: 'symbol, bid, and ask are required.' });
  }

  const tick = createMarketTick({ symbol, bid, ask, volume });
  marketSnapshots.push(tick);

  return res.status(201).json({ tick });
});

router.get('/level2/:symbol', (req, res) => {
  const { symbol } = req.params;
  const tick = marketSnapshots.find(t => t.symbol === symbol);
  if (!tick) return res.status(404).json({ error: `Symbol ${symbol} not found` });
  const level2Data = {
    symbol: symbol,
    timestamp: new Date().toISOString(),
    bids: [
      { price: tick.bid, size: Math.floor(Math.random() * 100) + 10 },
      { price: tick.bid - 0.01, size: Math.floor(Math.random() * 80) + 15 },
      { price: tick.bid - 0.02, size: Math.floor(Math.random() * 60) + 20 },
      { price: tick.bid - 0.03, size: Math.floor(Math.random() * 50) + 25 },
      { price: tick.bid - 0.04, size: Math.floor(Math.random() * 40) + 30 }
    ],
    asks: [
      { price: tick.ask, size: Math.floor(Math.random() * 100) + 10 },
      { price: tick.ask + 0.01, size: Math.floor(Math.random() * 80) + 15 },
      { price: tick.ask + 0.02, size: Math.floor(Math.random() * 60) + 20 },
      { price: tick.ask + 0.03, size: Math.floor(Math.random() * 50) + 25 },
      { price: tick.ask + 0.04, size: Math.floor(Math.random() * 40) + 30 }
    ],
    spread: (tick.ask - tick.bid).toFixed(6),
    volume: tick.volume
  };
  res.json(level2Data);
});

module.exports = router;
