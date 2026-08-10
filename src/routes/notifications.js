const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { createNotification, summarizeNotifications } = require('../services/notificationService');

const router = express.Router();
const notifications = [];

router.get('/', requireAuth, (req, res) => {
  res.json({ count: notifications.length, notifications });
});

router.post('/', requireAuth, (req, res) => {
  const { userId, channel, title, body, priority } = req.body;

  if (!userId || !title || !body) {
    return res.status(400).json({ error: 'userId, title, and body are required.' });
  }

  const notification = createNotification({ userId, channel, title, body, priority });
  notifications.push(notification);

  return res.status(201).json({ notification });
});

router.get('/summary', requireAuth, (req, res) => {
  res.json({ summary: summarizeNotifications(notifications) });
});

module.exports = router;
