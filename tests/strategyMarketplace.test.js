const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createStrategyListing,
  getStrategyPerformanceSnapshot,
  filterStrategyListings
} = require('../src/services/strategyMarketplaceService');

test('createStrategyListing builds a market-ready strategy object', () => {
  const listing = createStrategyListing({
    name: 'Momentum Breakout',
    traderId: 'trader-42',
    riskLevel: 'moderate',
    winRate: 66,
    monthlyReturn: 11.2,
    feePercent: 15,
    maxDrawdown: 9.1
  });

  assert.equal(listing.name, 'Momentum Breakout');
  assert.equal(listing.status, 'listed');
  assert.equal(listing.feePercent, 15);
  assert.ok(listing.id);
});

test('getStrategyPerformanceSnapshot returns summary metrics for a strategy', () => {
  const snapshot = getStrategyPerformanceSnapshot({
    winRate: 72,
    monthlyReturn: 18.5,
    maxDrawdown: 8.3,
    followers: 230,
    feePercent: 12
  });

  assert.equal(snapshot.riskBand, 'balanced');
  assert.equal(snapshot.performanceScore, 86);
  assert.equal(snapshot.followers, 230);
});

test('filterStrategyListings returns only strategies within user constraints', () => {
  const listings = [
    { id: 'a', riskLevel: 'low', monthlyReturn: 4, feePercent: 10 },
    { id: 'b', riskLevel: 'moderate', monthlyReturn: 9, feePercent: 15 },
    { id: 'c', riskLevel: 'high', monthlyReturn: 12, feePercent: 20 }
  ];

  const filtered = filterStrategyListings(listings, {
    maxRiskLevel: 'moderate',
    maxFeePercent: 15,
    minReturn: 5
  });

  assert.deepEqual(filtered.map((item) => item.id), ['b']);
});
