const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { users } = require('../lib/inMemoryStore');
const env = require('../config/env');
const db = require('../lib/db');

const router = express.Router();

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

  // Dual-write: the in-memory Map above is what the rest of the app (legacy
  // account/strategy routes) still reads from, but broker_accounts and the
  // copy-trading tables have real FKs against the Postgres users table, so a
  // matching row has to exist there too. Non-fatal if Postgres isn't
  // configured - registration still works for the in-memory-only demo flows.
  try {
    await db.query(
      `INSERT INTO users (id, email, password_hash, role, status) VALUES ($1, $2, $3, $4, $5)`,
      [user.id, user.email, user.password, user.role, user.status]
    );
  } catch (error) {
    console.error('Failed to persist user to Postgres (DB unavailable?):', error.message);
  }

  const token = jwt.sign({ sub: user.id, role: user.role }, env.jwtSecret, {
    expiresIn: '8h'
  });

  return res.status(201).json({
    token,
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

  const token = jwt.sign({ sub: user.id, role: user.role }, env.jwtSecret, {
    expiresIn: '8h'
  });

  return res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status
    }
  });
});

module.exports = router;
