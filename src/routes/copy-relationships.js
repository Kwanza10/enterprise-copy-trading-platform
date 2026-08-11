const express = require('express');
const { requireAuth } = require('../middleware/auth');
const brokerAccountService = require('../services/brokerAccountService');
const copyRelationshipService = require('../services/copyRelationshipService');

const router = express.Router();

router.use(requireAuth);

router.post('/', async (req, res) => {
  const { masterAccountId, followerAccountId, riskMode, riskValue, commissionPercent } = req.body;

  if (!masterAccountId || !followerAccountId) {
    return res.status(400).json({ error: 'masterAccountId and followerAccountId are required.' });
  }

  try {
    const followerAccount = await brokerAccountService.getBrokerAccountRowById(followerAccountId);
    if (!followerAccount || followerAccount.user_id !== req.user.sub) {
      return res.status(403).json({ error: 'followerAccountId must belong to the authenticated user.' });
    }

    const relationship = await copyRelationshipService.createRelationship({
      masterAccountId,
      followerAccountId,
      followerUserId: req.user.sub,
      riskMode,
      riskValue,
      commissionPercent
    });

    return res.status(201).json({ relationship });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const relationships = await copyRelationshipService.listForUser(req.user.sub);
    return res.json(relationships);
  } catch (error) {
    console.error('Failed to list copy relationships:', error.message);
    return res.status(500).json({ error: 'Unable to list copy relationships.' });
  }
});

// Follower may update riskMode/riskValue/enabled anytime (pause/resume, change lot sizing).
// Master may only approve/reject a pending cross-user request via { status }.
router.patch('/:id', async (req, res) => {
  try {
    const relationship = await copyRelationshipService.updateRelationship(req.params.id, req.user.sub, req.body);
    return res.json({ relationship });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ error: error.message });
  }
});

module.exports = router;
