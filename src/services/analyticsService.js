const { strategies, allocations, users } = require('../lib/inMemoryStore');

function buildDashboardOverview() {
  const totalStrategies = strategies.size;
  const totalFollowers = [...allocations.values()].length;
  const totalInvestors = [...users.values()].filter((user) => user.role === 'investor').length;
  const activeStrategies = [...strategies.values()].filter((strategy) => strategy.status === 'active').length;

  return {
    totalStrategies,
    totalFollowers,
    totalInvestors,
    activeStrategies,
    generatedAt: new Date().toISOString()
  };
}

module.exports = { buildDashboardOverview };
