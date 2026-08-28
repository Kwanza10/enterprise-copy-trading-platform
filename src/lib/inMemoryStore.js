const users = new Map();
const strategies = new Map();
const allocations = new Map();
const adminMetrics = {
  totalUsers: 0,
  activeCopyRelationships: 0,
  totalVolume: 0,
  riskAlerts: 0
};

// users is the source of truth read by login/register/requireAuth-adjacent
// lookups, but it only ever lived in process memory - Postgres was written
// to (persistUserToPostgres in auth.js) but never read back from. Every
// process restart (every deploy, since the deploy script ends in `pm2
// restart`) silently wiped every registered user: login would fail with
// "Invalid credentials" even though the row still existed in Postgres, and
// re-registering would mint a new random UUID that no longer matched the
// user's existing broker_accounts/copy relationships. Called once at boot,
// gated behind a reachable Postgres the same way applySchema() is.
async function loadUsersFromPostgres(db) {
  const { rows } = await db.query(
    'SELECT id, email, password_hash, role, status, created_at FROM users'
  );
  for (const row of rows) {
    users.set(row.id, {
      id: row.id,
      email: row.email,
      password: row.password_hash,
      role: row.role,
      status: row.status,
      createdAt: row.created_at
    });
  }
  return rows.length;
}

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
  adminMetrics,
  loadUsersFromPostgres
};
