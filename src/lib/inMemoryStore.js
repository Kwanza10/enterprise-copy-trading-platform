const users = new Map();
const strategies = new Map();
const allocations = new Map();
const adminMetrics = {
  totalUsers: 0,
  activeCopyRelationships: 0,
  totalVolume: 0,
  riskAlerts: 0
};

function seedInitialData() {
  if (strategies.size > 0) return;

  const exampleStrategy = {
    id: 'strat-001',
    name: 'BlueWave Momentum',
    traderId: 'trader-001',
    status: 'active',
    riskLevel: 'moderate',
    winRate: 68.5,
    monthlyReturn: 12.4,
    maxDrawdown: 8.7,
    followers: 128,
    minInvestment: 250,
    feePercent: 15,
    strategyType: 'intraday'
  };

  strategies.set(exampleStrategy.id, exampleStrategy);
  adminMetrics.totalUsers = 342;
  adminMetrics.activeCopyRelationships = 184;
  adminMetrics.totalVolume = 1284000;
  adminMetrics.riskAlerts = 3;
}

seedInitialData();

module.exports = {
  users,
  strategies,
  allocations,
  adminMetrics
};
