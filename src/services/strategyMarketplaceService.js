function createStrategyListing({
  id,
  name,
  traderId,
  riskLevel = 'moderate',
  winRate = 0,
  monthlyReturn = 0,
  maxDrawdown = 0,
  followers = 0,
  minInvestment = 0,
  feePercent = 0,
  strategyType = 'scalping',
  status = 'listed'
} = {}) {
  return {
    id: id || `listing-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    name,
    traderId,
    riskLevel,
    winRate: Number(winRate),
    monthlyReturn: Number(monthlyReturn),
    maxDrawdown: Number(maxDrawdown),
    followers: Number(followers),
    minInvestment: Number(minInvestment),
    feePercent: Number(feePercent),
    strategyType,
    status,
    createdAt: new Date().toISOString()
  };
}

function getStrategyPerformanceSnapshot(strategy = {}) {
  const winRate = Number(strategy.winRate || 0);
  const monthlyReturn = Number(strategy.monthlyReturn || 0);
  const maxDrawdown = Number(strategy.maxDrawdown || 0);
  const followers = Number(strategy.followers || 0);
  const feePercent = Number(strategy.feePercent || 0);

  let riskBand = 'balanced';
  if (maxDrawdown >= 15 || winRate < 50) {
    riskBand = 'aggressive';
  } else if (maxDrawdown <= 8 && winRate >= 60) {
    riskBand = 'balanced';
  } else if (maxDrawdown <= 5 && winRate >= 65) {
    riskBand = 'conservative';
  }

  const performanceScore = Math.max(
    0,
    Math.min(100, Math.round((winRate * 0.7) + (monthlyReturn * 2.5) - (maxDrawdown * 1.2) - (feePercent * 0.06)))
  );

  return {
    riskBand,
    performanceScore,
    followers,
    monthlyReturn,
    winRate,
    feePercent,
    maxDrawdown,
    generatedAt: new Date().toISOString()
  };
}

function filterStrategyListings(listings = [], filters = {}) {
  const {
    maxRiskLevel = 'high',
    maxFeePercent = 100,
    minReturn = 0
  } = filters;

  const riskOrder = { low: 1, moderate: 2, high: 3, extreme: 4 };
  const maxRiskValue = riskOrder[maxRiskLevel] || 99;

  return listings.filter((listing) => {
    const riskValue = riskOrder[listing.riskLevel] || 0;
    const passRisk = riskValue <= maxRiskValue;
    const passFee = Number(listing.feePercent || 0) <= Number(maxFeePercent);
    const passReturn = Number(listing.monthlyReturn || 0) >= Number(minReturn);
    return passRisk && passFee && passReturn;
  });
}

module.exports = {
  createStrategyListing,
  getStrategyPerformanceSnapshot,
  filterStrategyListings
};
