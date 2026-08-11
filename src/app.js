const express = require('express');
const path = require('path');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const { createWebSocketServer } = require('./services/websocket');
const { seedData } = require('./lib/seedData');
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
const { buildSystemHealth } = require('./services/systemHealth');

const app = express();
const server = http.createServer(app);

app.use(helmet());
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));
app.use(express.static(path.join(__dirname, '..', 'public')));

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

const wsServer = createWebSocketServer(server);

module.exports = { app, server, wsServer };
