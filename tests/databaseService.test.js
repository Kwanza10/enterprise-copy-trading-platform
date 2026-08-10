const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluatePersistenceMode,
  getDatabaseHealthSummary
} = require('../src/services/databaseService');

test('evaluatePersistenceMode prefers postgres when database config exists', () => {
  const mode = evaluatePersistenceMode({
    DB_HOST: 'localhost',
    DB_NAME: 'copy_trading_enterprise'
  });

  assert.equal(mode, 'postgres');
});

test('evaluatePersistenceMode falls back to in-memory mode without DB config', () => {
  const mode = evaluatePersistenceMode({});

  assert.equal(mode, 'memory-fallback');
});

test('getDatabaseHealthSummary returns a safe status even when Postgres is unavailable', async () => {
  const status = await getDatabaseHealthSummary({
    DB_HOST: 'localhost',
    DB_NAME: 'copy_trading_enterprise',
    DB_USER: 'postgres',
    DB_PASSWORD: 'postgres'
  });

  assert.ok(['postgres', 'memory-fallback'].includes(status.mode));
  assert.ok(typeof status.connected === 'boolean');
});
