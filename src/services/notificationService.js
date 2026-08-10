function createNotification({ userId, channel = 'inapp', title = 'Alert', body = '', priority = 'medium' } = {}) {
  return {
    id: `notif-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    userId,
    channel,
    title,
    body,
    priority,
    status: 'queued',
    createdAt: new Date().toISOString()
  };
}

function summarizeNotifications(items = []) {
  const byPriority = { high: 0, medium: 0, low: 0 };
  const byChannel = {};

  for (const item of items) {
    const priority = item.priority || 'medium';
    const channel = item.channel || 'inapp';

    byPriority[priority] = (byPriority[priority] || 0) + 1;
    byChannel[channel] = (byChannel[channel] || 0) + 1;
  }

  return {
    total: items.length,
    byPriority,
    byChannel
  };
}

module.exports = { createNotification, summarizeNotifications };
