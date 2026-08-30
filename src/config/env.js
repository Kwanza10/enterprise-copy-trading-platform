const dotenv = require('dotenv');

dotenv.config();

module.exports = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  // Who can view/edit the admin-only follower-limit settings (see
  // requireAdmin in middleware/auth.js). Defaults to the app owner's own
  // login email so this works out of the box; override with a
  // comma-separated ADMIN_EMAILS env var to add more.
  adminEmails: (process.env.ADMIN_EMAILS || 'kwanzagreen2@gmail.com')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  credentialEncryptionKey: process.env.CREDENTIAL_ENCRYPTION_KEY || 'dev-credential-key-change-me',
  tradeLocker: {
    liveBaseUrl: process.env.TL_BASE_URL || 'https://live.tradelocker.com/backend-api',
    demoBaseUrl: 'https://demo.tradelocker.com/backend-api',
    developerApiKey: process.env.TL_DEVELOPER_API_KEY || '',
    pollIntervalMs: Number(process.env.TL_POLL_INTERVAL_MS || 15000)
  },
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    name: process.env.DB_NAME || 'copy_trading_enterprise',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres'
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT || 6379)
  }
};
