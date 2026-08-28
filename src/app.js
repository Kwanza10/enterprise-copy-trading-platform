const express = require('express');
const path = require('path');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const { createWebSocketServer } = require('./services/websocket');
const db = require('./lib/db');
const { seedData } = require('./lib/seedData');
const { loadUsersFromPostgres } = require('./lib/inMemoryStore');
const authRoutes = require('./routes/auth');
const accountRoutes = require('./routes/accounts');
const brokerRoutes = require('./routes/brokers');
const strategyRoutes = require('./routes/strategies');
const copyEngineRoutes = require('./routes/copy-engine');
const adminRoutes = require('./routes/admin');
const analyticsRoutes = require('./routes/analytics');
const complianceRoutes = require('./routes/compliance');
const notificationRoutes = require('./routes/notifications');
const walletRoutes = require('./routes/wallet');
const marketRoutes = require('./routes/market');
const marketplaceRoutes = require('./routes/marketplace');
const transferRoutes = require('./routes/transfers');
const settlementRoutes = require('./routes/settlements');
const redisRoutes = require('./routes/redis');
const aiAssistantRoutes = require('./routes/ai-assistant');
const brokerAccountRoutes = require('./routes/broker-accounts');
const copyRelationshipRoutes = require('./routes/copy-relationships');
const symbolMappingRoutes = require('./routes/symbol-mappings');
const webhookRoutes = require('./routes/webhook');
const mtBridgeRoutes = require('./routes/mtBridge');
const tradeFeedRoutes = require('./routes/trade-feed');
const tradeQueue = require('./lib/tradeQueue');
const copyEngine = require('./services/copyEngine');
const symbolMappingService = require('./services/symbolMappingService');
const tradeLockerPoller = require('./services/tradeLockerPoller');
const { buildSystemHealth } = require('./services/systemHealth');

const app = express();
const server = http.createServer(app);

// helmet()'s default Content-Security-Policy blocks two things dashboard.js
// and dashboard.html rely on: script-src only allows same-origin <script
// src>, so the Google Identity Services script tag needs an explicit
// exception; and script-src-attr defaults to 'none', which blocks the
// inline onclick="..." attributes the dashboard's dynamically-rendered
// tables use (regenerateWebhookToken, removeAccount, approveRelationship,
// updateRisk) - loosening only that one directive, not script-src itself,
// still blocks any arbitrary inline <script> block from ever running.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'script-src': ["'self'", 'https://accounts.google.com'],
      'script-src-attr': ["'unsafe-inline'"],
      'frame-src': ["'self'", 'https://accounts.google.com'],
      'connect-src': ["'self'", 'https://accounts.google.com'],
      'img-src': ["'self'", 'data:', 'https://*.googleusercontent.com']
    }
  }
}));
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));
// No caching on dashboard.html/dashboard.js - express.static's defaults
// (Last-Modified + ETag only, no Cache-Control) still let some browsers
// serve a stale copy without revalidating, which has repeatedly meant a
// deployed dashboard fix wasn't actually visible until a hard refresh.
// no-store (rather than no-cache) is used deliberately: no-cache still
// permits a cache to store the response and revalidate via ETag, which
// some browsers/carrier proxies do unreliably on plain HTTP. no-store
// forbids caching the response at all, so every load is a fresh fetch.
// Pragma/Expires are included for older or transparent HTTP proxies that
// don't honor Cache-Control.
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// express.static only serves index.html at '/' by default, and this app's
// entry point is named dashboard.html - without this, visiting the bare
// domain (e.g. https://brokerssync.com) 404s with Express's default
// "Cannot GET /" instead of landing on the actual app.
app.get('/', (req, res) => {
  res.redirect('/dashboard.html');
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'enterprise-copy-trading-platform',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/enterprise/status', (req, res) => {
  const health = buildSystemHealth({
    app: 'ok',
    database: 'connected',
    redis: 'degraded'
  });

  res.json({
    platform: 'Enterprise Copy Trading Platform',
    status: health.status,
    modules: ['auth', 'strategy', 'copy-engine', 'risk', 'admin', 'analytics'],
    health
  });
});

seedData();

app.use('/api/auth', authRoutes);
app.use('/api/ea', require('./routes/ea'));
app.use('/api/accounts', accountRoutes);
app.use('/api/brokers', brokerRoutes);
app.use('/api/strategies', strategyRoutes);
app.use('/api/copy', copyEngineRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/compliance', complianceRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/market', marketRoutes);
app.use('/api/marketplace', marketplaceRoutes);
app.use('/api/transfers', transferRoutes);
app.use('/api/settlements', settlementRoutes);
app.use('/api/redis', redisRoutes);
app.use('/api/ai-assistant', aiAssistantRoutes);
app.use('/api/broker-accounts', brokerAccountRoutes);
app.use('/api/copy-relationships', copyRelationshipRoutes);
app.use('/api/symbol-mappings', symbolMappingRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/bridge', mtBridgeRoutes);
app.use('/api/trade-feed', tradeFeedRoutes);

const wsServer = createWebSocketServer(server);

tradeQueue.setProcessor(copyEngine.processTradeEvent);

// DB-dependent startup work - never let a missing/unreachable Postgres
// (e.g. local dev with no DB_* env vars set) crash the whole process.
// Schema application runs first and gates the rest, so a column/table
// added to database/schema.sql actually exists on production before
// anything else tries to read or write it - see applySchema() in
// src/lib/db.js for why this needs to run here at all.
db.applySchema()
  .then(() => {
    loadUsersFromPostgres(db)
      .then((count) => console.log(`Rehydrated ${count} user(s) from Postgres.`))
      .catch((error) => {
        console.error('User rehydration skipped (DB unavailable?):', error.message);
      });
    symbolMappingService.seedGlobalDefaults().catch((error) => {
      console.error('Symbol mapping seed skipped:', error.message);
    });
    tradeLockerPoller.start().catch((error) => {
      console.error('TradeLocker poller failed to start:', error.message);
    });
  })
  .catch((error) => {
    console.error('Schema apply skipped (DB unavailable?):', error.message);
  });

module.exports = { app, server, wsServer };
