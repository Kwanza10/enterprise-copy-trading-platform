const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  listUsers,
  findUserById,
  getStrategySummary,
  getAllocationSummary
} = require('../services/accountService');

const router = express.Router();

router.get('/me', requireAuth, (req, res) => {
  const user = findUserById(req.user.sub);
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  return res.json({ user });
});

router.get('/', requireAuth, (req, res) => {
  res.json({ users: listUsers() });
});

router.get('/strategies', requireAuth, (req, res) => {
  res.json({ strategies: getStrategySummary() });
});

router.get('/allocations/:userId', requireAuth, (req, res) => {
  res.json({ allocations: getAllocationSummary(req.params.userId) });
});

module.exports = router;
