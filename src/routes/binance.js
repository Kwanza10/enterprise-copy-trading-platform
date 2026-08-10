const express = require('express');
const { requireAuth } = require('../middleware/auth');
const binanceService = require('../services/binanceService');

const router = express.Router();

router.use(requireAuth);

router.post('/connect', async (req, res) => {
  const { apiKey, apiSecret, testnet } = req.body;

  if (!apiKey || !apiSecret) {
    return res.status(400).json({ error: 'apiKey and apiSecret are required.' });
  }

  try {
    await binanceService.testConnection({ apiKey, apiSecret, testnet });
    await binanceService.saveCredentials(req.user.sub, { apiKey, apiSecret, testnet });
    return res.status(201).json({ connected: true, testnet: Boolean(testnet) });
  } catch (error) {
    console.error('Binance connect failed:', error.message);
    return res.status(400).json({ error: 'Unable to verify Binance credentials.' });
  }
});

router.get('/trades', async (req, res) => {
  const { symbol } = req.query;

  if (!symbol) {
    return res.status(400).json({ error: 'symbol query parameter is required.' });
  }

  try {
    const credentials = await binanceService.getCredentials(req.user.sub);
    if (!credentials) {
      return res.status(404).json({ error: 'Binance account not connected.' });
    }

    const client = binanceService.createBinanceClient(credentials);
    const trades = await client.getTradeHistory(symbol);
    return res.json({ symbol, count: trades.length, trades });
  } catch (error) {
    console.error('Binance trade history fetch failed:', error.message);
    return res.status(502).json({ error: 'Unable to fetch trade history from Binance.' });
  }
});

router.get('/metrics', async (req, res) => {
  const { symbol } = req.query;

  if (!symbol) {
    return res.status(400).json({ error: 'symbol query parameter is required.' });
  }

  try {
    const credentials = await binanceService.getCredentials(req.user.sub);
    if (!credentials) {
      return res.status(404).json({ error: 'Binance account not connected.' });
    }

    const client = binanceService.createBinanceClient(credentials);
    const trades = await client.getTradeHistory(symbol);
    const metrics = binanceService.calculateMetrics(trades);
    return res.json({ symbol, metrics });
  } catch (error) {
    console.error('Binance metrics calculation failed:', error.message);
    return res.status(502).json({ error: 'Unable to calculate metrics from Binance data.' });
  }
});

module.exports = router;
