const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads/eas');
    require('fs').mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}-${file.originalname}`);
  }
});

const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

router.post('/upload', (req, res) => {
  res.json({ message: 'EA upload endpoint', disclaimer: 'BrokersSync is NOT liable for EA performance or losses' });
});

router.get('/my-eas', (req, res) => {
  res.json({ eas: [] });
});

router.delete('/:eaId', (req, res) => {
  res.json({ message: 'EA deleted' });
});

router.get('/disclaimer', (req, res) => {
  res.json({ disclaimer: 'BrokersSync is NOT liable for EA performance, losses, or malfunctions. User assumes full risk.' });
});

module.exports = router;
