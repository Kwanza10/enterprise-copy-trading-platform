const express = require('express');
const { requireAuth } = require('../middleware/auth');
const tradeEventService = require('../services/tradeEventService');
const copyExecutionService = require('../services/copyExecutionService');

const router = express.Router();

router.use(requireAuth);

// Powers the dashboard's live trade feed: recent TradeEvents (as master) and
// the CopyExecutions they produced (as follower) - no direct broker API
// calls from the frontend, per spec.
router.get('/', async (req, res) => {
  try {
    const [events, executions] = await Promise.all([
      tradeEventService.listRecentForUser(req.user.sub, 50),
      copyExecutionService.listRecentForUser(req.user.sub, 50)
    ]);
    return res.json({ events, executions });
  } catch (error) {
    console.error('Failed to load trade feed:', error.message);
    return res.status(500).json({ error: 'Unable to load trade feed.' });
  }
});

module.exports = router;
