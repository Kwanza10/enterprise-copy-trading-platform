const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateRedisMode,
  getRedisHealthSummary
} = require('../src/services/redisService');

test('evaluateRedisMode prefers redis when config exists', () => {
  const mode = evaluateRedisMode({ REDIS_HOST: 'localhost', REDIS_PORT: 6379 });

  assert.equal(mode, 'redis');
});

test('evaluateRedisMode falls back to standalone mode without redis config', () => {
  const mode = evaluateRedisMode({});

  assert.equal(mode, 'standalone');
});

test('getRedisHealthSummary returns safe health metadata when redis is unavailable', async () => {
  const status = await getRedisHealthSummary({ REDIS_HOST: 'localhost', REDIS_PORT: 6379 });

  assert.ok(['redis', 'standalone'].includes(status.mode));
  assert.ok(typeof status.connected === 'boolean');
  assert.ok(typeof status.message === 'string');
});
