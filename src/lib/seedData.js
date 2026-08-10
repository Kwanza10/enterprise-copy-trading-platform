const { users, strategies, allocations } = require('./inMemoryStore');

function seedData() {
  if (users.size === 0) {
    users.set('admin-001', {
      id: 'admin-001',
      email: 'admin@copytrading.local',
      role: 'admin',
      status: 'active',
      firstName: 'System',
      lastName: 'Admin',
      createdAt: new Date().toISOString()
    });

    users.set('trader-001', {
      id: 'trader-001',
      email: 'trader@copytrading.local',
      role: 'trader',
      status: 'active',
      firstName: 'Maya',
      lastName: 'Stone',
      createdAt: new Date().toISOString()
    });

    users.set('investor-001', {
      id: 'investor-001',
      email: 'investor@copytrading.local',
      role: 'investor',
      status: 'active',
      firstName: 'David',
      lastName: 'Cole',
      createdAt: new Date().toISOString()
    });
  }

  if (strategies.size === 0) {
    strategies.set('strat-001', {
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
    });
  }

  if (allocations.size === 0) {
    allocations.set('alloc-001', {
      id: 'alloc-001',
      followerId: 'investor-001',
      strategyId: 'strat-001',
      amount: 5000,
      riskTolerance: 'moderate',
      status: 'active',
      createdAt: new Date().toISOString()
    });
  }
}

module.exports = { seedData };
