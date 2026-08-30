const jwt = require('jsonwebtoken');
const env = require('../config/env');

function requireAdmin(req, res, next) {
  const email = (req.user && req.user.email || '').toLowerCase();
  if (!email || !env.adminEmails.includes(email)) {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  return next();
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication token required.' });
  }

  try {
    const decoded = jwt.verify(token, env.jwtSecret);
    req.user = decoded;
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

module.exports = { requireAuth, requireAdmin };
