const { Client } = require('pg');

function evaluatePersistenceMode(env = {}) {
  const hasDatabaseConfig = Boolean(
    env.DB_HOST || env.DB_NAME || env.DB_USER || env.DB_PASSWORD || env.DATABASE_URL
  );

  return hasDatabaseConfig ? 'postgres' : 'memory-fallback';
}

async function getDatabaseHealthSummary(env = {}) {
  const mode = evaluatePersistenceMode(env);

  if (mode !== 'postgres') {
    return {
      mode,
      connected: false,
      message: 'Database not configured; platform is running in memory fallback mode.'
    };
  }

  const client = new Client({
    host: env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT || 5432),
    database: env.DB_NAME || 'copy_trading_enterprise',
    user: env.DB_USER || 'postgres',
    password: env.DB_PASSWORD || 'postgres',
    connectionTimeoutMillis: 1000
  });

  try {
    await client.connect();
    return {
      mode,
      connected: true,
      message: 'PostgreSQL connected successfully.'
    };
  } catch (error) {
    return {
      mode,
      connected: false,
      message: `PostgreSQL unavailable: ${error.message}`
    };
  } finally {
    client.end().catch(() => {});
  }
}

module.exports = { evaluatePersistenceMode, getDatabaseHealthSummary };
