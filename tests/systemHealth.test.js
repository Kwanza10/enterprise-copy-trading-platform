const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSystemHealth } = require('../src/services/systemHealth');

test('buildSystemHealth reports application, database, and redis state', () => {
  const health = buildSystemHealth({
    app: 'ok',
    database: 'connected',
    redis: 'degraded'
  });

  assert.equal(health.status, 'degraded');
  assert.equal(health.database, 'connected');
  assert.equal(health.redis, 'degraded');
  assert.equal(health.app, 'ok');
});
