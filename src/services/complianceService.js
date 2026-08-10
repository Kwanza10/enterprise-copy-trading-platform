function createComplianceEvent({ userId, eventType, severity = 'low', details = {} } = {}) {
  return {
    id: `compliance-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    userId,
    eventType,
    severity,
    details,
    createdAt: new Date().toISOString()
  };
}

function summarizeComplianceEvents(events = []) {
  const bySeverity = { high: 0, medium: 0, low: 0 };
  const byEventType = {};

  for (const event of events) {
    const severity = event.severity || 'low';
    const eventType = event.eventType || 'unknown';

    bySeverity[severity] = (bySeverity[severity] || 0) + 1;
    byEventType[eventType] = (byEventType[eventType] || 0) + 1;
  }

  return {
    total: events.length,
    bySeverity,
    byEventType
  };
}

module.exports = { createComplianceEvent, summarizeComplianceEvents };
