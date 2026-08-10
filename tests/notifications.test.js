const test = require('node:test');
const assert = require('node:assert/strict');
const { createNotification, summarizeNotifications } = require('../src/services/notificationService');

test('createNotification stores alert metadata and content', () => {
  const notification = createNotification({
    userId: 'user-2',
    channel: 'email',
    title: 'Trade alert',
    body: 'A copy allocation was approved.',
    priority: 'high'
  });

  assert.equal(notification.userId, 'user-2');
  assert.equal(notification.channel, 'email');
  assert.equal(notification.priority, 'high');
  assert.equal(notification.title, 'Trade alert');
  assert.equal(notification.status, 'queued');
  assert.ok(notification.id);
});

test('summarizeNotifications groups by priority and channel', () => {
  const notifications = [
    { priority: 'high', channel: 'email' },
    { priority: 'high', channel: 'sms' },
    { priority: 'medium', channel: 'email' },
    { priority: 'low', channel: 'inapp' }
  ];

  const summary = summarizeNotifications(notifications);

  assert.equal(summary.total, 4);
  assert.equal(summary.byPriority.high, 2);
  assert.equal(summary.byPriority.medium, 1);
  assert.equal(summary.byChannel.email, 2);
  assert.equal(summary.byChannel.sms, 1);
});
