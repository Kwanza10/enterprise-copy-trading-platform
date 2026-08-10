const test = require('node:test');
const assert = require('node:assert/strict');
const { createComplianceEvent, summarizeComplianceEvents } = require('../src/services/complianceService');

test('createComplianceEvent records a severity-aware audit event', () => {
  const event = createComplianceEvent({
    userId: 'user-1',
    eventType: 'kyc_review',
    severity: 'high',
    details: { status: 'flagged' }
  });

  assert.equal(event.userId, 'user-1');
  assert.equal(event.eventType, 'kyc_review');
  assert.equal(event.severity, 'high');
  assert.equal(event.details.status, 'flagged');
  assert.ok(event.id);
  assert.ok(event.createdAt);
});

test('summarizeComplianceEvents condenses counts by severity and event type', () => {
  const events = [
    { severity: 'high', eventType: 'kyc_review' },
    { severity: 'high', eventType: 'trade_limit' },
    { severity: 'medium', eventType: 'kyc_review' },
    { severity: 'low', eventType: 'manual_review' }
  ];

  const summary = summarizeComplianceEvents(events);

  assert.equal(summary.total, 4);
  assert.equal(summary.bySeverity.high, 2);
  assert.equal(summary.bySeverity.medium, 1);
  assert.equal(summary.bySeverity.low, 1);
  assert.equal(summary.byEventType.kyc_review, 2);
});
