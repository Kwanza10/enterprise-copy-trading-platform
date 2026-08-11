const express = require('express');
const { requireAuth } = require('../middleware/auth');
const symbolMappingService = require('../services/symbolMappingService');

const router = express.Router();

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const mappings = await symbolMappingService.listMappingsForUser(req.user.sub);
    return res.json(mappings);
  } catch (error) {
    console.error('Failed to list symbol mappings:', error.message);
    return res.status(500).json({ error: 'Unable to list symbol mappings.' });
  }
});

router.post('/', async (req, res) => {
  const { sourcePlatform, sourceSymbol, targetPlatform, targetSymbol } = req.body;

  try {
    const mapping = await symbolMappingService.createMapping({
      userId: req.user.sub,
      sourcePlatform,
      sourceSymbol,
      targetPlatform,
      targetSymbol
    });
    return res.status(201).json({ mapping });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const deleted = await symbolMappingService.deleteMapping(req.params.id, req.user.sub);
    if (!deleted) {
      return res.status(404).json({ error: 'Mapping not found (or not owned by you - global defaults cannot be deleted here).' });
    }
    return res.status(204).send();
  } catch (error) {
    console.error('Failed to delete symbol mapping:', error.message);
    return res.status(500).json({ error: 'Unable to delete symbol mapping.' });
  }
});

module.exports = router;
