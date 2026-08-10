const { users, strategies, allocations } = require('../lib/inMemoryStore');

function listUsers() {
  return [...users.values()];
}

function findUserById(userId) {
  return users.get(userId) || null;
}

function createUser(userData) {
  const user = {
    id: userData.id || `user-${Date.now()}`,
    email: userData.email,
    role: userData.role || 'investor',
    status: userData.status || 'active',
    firstName: userData.firstName || '',
    lastName: userData.lastName || '',
    createdAt: new Date().toISOString()
  };

  users.set(user.id, user);
  return user;
}

function getStrategySummary() {
  return [...strategies.values()].map((strategy) => ({
    id: strategy.id,
    name: strategy.name,
    status: strategy.status,
    riskLevel: strategy.riskLevel,
    followers: strategy.followers,
    monthlyReturn: strategy.monthlyReturn,
    winRate: strategy.winRate
  }));
}

function getAllocationSummary(userId) {
  return [...allocations.values()].filter((allocation) => allocation.followerId === userId);
}

module.exports = {
  listUsers,
  findUserById,
  createUser,
  getStrategySummary,
  getAllocationSummary
};
