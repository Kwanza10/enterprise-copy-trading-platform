const redis = require('redis');

function evaluateRedisMode(env = {}) {
  const hasRedisConfig = Boolean(
    env.REDIS_HOST || env.REDIS_PORT || env.REDIS_URL
  );

  return hasRedisConfig ? 'redis' : 'standalone';
}

async function getRedisHealthSummary(env = {}) {
  const mode = evaluateRedisMode(env);

  if (mode !== 'redis') {
    return {
      mode,
      connected: false,
      message: 'Redis not configured; platform is running in standalone mode.'
    };
  }

  const client = redis.createClient({
    socket: {
      host: env.REDIS_HOST || 'localhost',
      port: Number(env.REDIS_PORT || 6379),
      connectTimeout: 1000
    }
  });

  try {
    await client.connect();
    await client.ping();
    return {
      mode,
      connected: true,
      message: 'Redis connected successfully.'
    };
  } catch (error) {
    return {
      mode,
      connected: false,
      message: `Redis unavailable: ${error.message}`
    };
  } finally {
    client.quit().catch(() => {});
  }
}

module.exports = { evaluateRedisMode, getRedisHealthSummary };
