const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  createStrategyListing,
  getStrategyPerformanceSnapshot,
  filterStrategyListings
} = require('../services/strategyMarketplaceService');

const router = express.Router();
const listings = [
  createStrategyListing({
    name: 'BlueWave Momentum',
    traderId: 'trader-001',
    riskLevel: 'moderate',
    winRate: 68.5,
    monthlyReturn: 12.4,
    feePercent: 15,
    maxDrawdown: 8.7,
    followers: 128,
    minInvestment: 250,
    strategyType: 'intraday'
  })
];

router.get('/', requireAuth, (req, res) => {
  res.json({ count: listings.length, listings });
});

router.get('/snapshot/:id', requireAuth, (req, res) => {
  const listing = listings.find((item) => item.id === req.params.id);
  if (!listing) {
    return res.status(404).json({ error: 'Strategy listing not found.' });
  }

  return res.json({ snapshot: getStrategyPerformanceSnapshot(listing) });
});

router.post('/filter', requireAuth, (req, res) => {
  const filtered = filterStrategyListings(listings, req.body || {});
  res.json({ count: filtered.length, listings: filtered });
});

module.exports = router;
