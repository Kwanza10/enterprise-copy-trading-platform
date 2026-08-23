const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { users } = require('../lib/inMemoryStore');
const env = require('../config/env');
const db = require('../lib/db');

const router = express.Router();
const googleClient = env.googleClientId ? new OAuth2Client(env.googleClientId) : null;

function issueToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, env.jwtSecret, { expiresIn: '8h' });
}

// Dual-writes into Postgres alongside the in-memory Map, same as /register -
// broker_accounts and the copy-trading tables have real FKs against the
// Postgres users table. Non-fatal if Postgres is unreachable.
async function persistUserToPostgres(user) {
  try {
    await db.query(
      `INSERT INTO users (id, email, password_hash, role, status) VALUES ($1, $2, $3, $4, $5)`,
      [user.id, user.email, user.password, user.role, user.status]
    );
  } catch (error) {
    console.error('Failed to persist user to Postgres (DB unavailable?):', error.message);
  }
}

// The dashboard fetches this on load to know whether to render a "Sign in
// with Google" button at all, and which client ID to initialize it with -
// avoids hardcoding a client ID into the static HTML file.
router.get('/google-config', (req, res) => {
  res.json({ enabled: Boolean(env.googleClientId), clientId: env.googleClientId || null });
});

router.post('/register', async (req, res) => {
  const { email, password, role = 'investor' } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const existing = [...users.values()].find((user) => user.email === email);
  if (existing) {
    return res.status(409).json({ error: 'User already exists.' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = {
    id: crypto.randomUUID(),
    email,
    password: hashedPassword,
    role,
    createdAt: new Date().toISOString(),
    status: 'active'
  };

  users.set(user.id, user);
  await persistUserToPostgres(user);

  return res.status(201).json({
    token: issueToken(user),
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status
    }
  });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  const user = [...users.values()].find((entry) => entry.email === email);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  return res.json({
    token: issueToken(user),
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status
    }
  });
});

// Verifies the ID token Google Identity Services hands the frontend after a
// successful "Sign in with Google" - this is the standard server-side check
// (confirms the token is genuinely signed by Google and issued for *this*
// app's client ID, not just decoding it and trusting whatever it says).
// Finds-or-creates a local user by the verified email, then issues our own
// app JWT so everything downstream (requireAuth, authHeaders()) is
// unchanged - Google is only ever involved in this one request.
router.post('/google', async (req, res) => {
  if (!googleClient) {
    return res.status(503).json({ error: 'Google sign-in is not configured on this server (GOOGLE_CLIENT_ID unset).' });
  }

  const { credential } = req.body;
  if (!credential) {
    return res.status(400).json({ error: 'credential (Google ID token) is required.' });
  }

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: env.googleClientId });
    payload = ticket.getPayload();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid Google credential: ' + error.message });
  }

  if (!payload || !payload.email) {
    return res.status(401).json({ error: 'Google credential did not include an email address.' });
  }
  if (!payload.email_verified) {
    return res.status(401).json({ error: 'Google account email is not verified.' });
  }

  const email = payload.email;
  let user = [...users.values()].find((entry) => entry.email === email);

  if (!user) {
    // Google-authenticated users never log in with a password - this hash
    // is random and unknown to anyone, it only exists to satisfy
    // password_hash NOT NULL in Postgres without a schema change.
    const unusablePassword = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
    user = {
      id: crypto.randomUUID(),
      email,
      password: unusablePassword,
      role: 'investor',
      createdAt: new Date().toISOString(),
      status: 'active'
    };
    users.set(user.id, user);
    await persistUserToPostgres(user);
  }

  return res.json({
    token: issueToken(user),
    user: { id: user.id, email: user.email, role: user.role, status: user.status }
  });
});

module.exports = router;
