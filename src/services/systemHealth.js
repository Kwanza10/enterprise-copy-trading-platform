function buildSystemHealth({ app = 'ok', database = 'disconnected', redis = 'disconnected' } = {}) {
  const status = [app, database, redis].includes('down') || [app, database, redis].includes('disconnected')
    ? 'down'
    : [app, database, redis].includes('degraded')
      ? 'degraded'
      : 'ok';

  return {
    status,
    app,
    database,
    redis,
    checkedAt: new Date().toISOString()
  };
}

module.exports = { buildSystemHealth };
