const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { users } = require('../lib/inMemoryStore');
const env = require('../config/env');

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
    id: `user-${Date.now()}`,
    email,
    password: hashedPassword,
    role,
    createdAt: new Date().toISOString(),
    status: 'active'
  };

  users.set(user.id, user);

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
