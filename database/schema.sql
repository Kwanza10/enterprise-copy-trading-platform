CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(30) NOT NULL DEFAULT 'investor',
  first_name VARCHAR(120),
  last_name VARCHAR(120),
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  kyc_status VARCHAR(30) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS broker_connections (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  broker_name VARCHAR(100) NOT NULL,
  broker_type VARCHAR(50) NOT NULL,
  account_name VARCHAR(200),
  api_key_encrypted TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'connected',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS strategies (
  id UUID PRIMARY KEY,
  trader_id UUID NOT NULL REFERENCES users(id),
  name VARCHAR(200) NOT NULL,
  risk_level VARCHAR(30) NOT NULL DEFAULT 'moderate',
  strategy_type VARCHAR(60) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'draft',
  win_rate NUMERIC(5,2) DEFAULT 0,
  monthly_return NUMERIC(10,2) DEFAULT 0,
  max_drawdown NUMERIC(10,2) DEFAULT 0,
  followers_count INTEGER DEFAULT 0,
  min_investment NUMERIC(12,2) DEFAULT 0,
  fee_percent NUMERIC(5,2) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS copy_relationships (
  id UUID PRIMARY KEY,
  follower_id UUID NOT NULL REFERENCES users(id),
  trader_id UUID NOT NULL REFERENCES users(id),
  strategy_id UUID NOT NULL REFERENCES strategies(id),
  allocation_amount NUMERIC(12,2) NOT NULL,
  risk_tolerance VARCHAR(30) NOT NULL DEFAULT 'moderate',
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trade_events (
  id UUID PRIMARY KEY,
  strategy_id UUID REFERENCES strategies(id),
  user_id UUID REFERENCES users(id),
  symbol VARCHAR(40) NOT NULL,
  side VARCHAR(10) NOT NULL,
  quantity NUMERIC(12,4) NOT NULL,
  price NUMERIC(12,4) NOT NULL,
  pnl NUMERIC(12,2) DEFAULT 0,
  event_type VARCHAR(30) NOT NULL DEFAULT 'trade',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS compliance_events (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  event_type VARCHAR(80) NOT NULL,
  severity VARCHAR(30) NOT NULL DEFAULT 'info',
  details JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_alerts (
  id UUID PRIMARY KEY,
  severity VARCHAR(30) NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  acknowledged BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Webhook + poll-driven copy-trading hub (MT4/MT5/TradeLocker/NinjaTrader).
-- Note: "trade_events" is already taken above by the strategy-marketplace
-- allocation feature (different shape: strategy_id/quantity/pnl, unrelated to
-- raw broker-account trade mirroring), so this feature's event table is named
-- copy_trade_events below to avoid a collision. "copy_relationships" is
-- likewise taken, so this feature uses trade_copy_relationships.

CREATE TABLE IF NOT EXISTS broker_accounts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  platform VARCHAR(20) NOT NULL CHECK (platform IN ('mt4', 'mt5', 'tradelocker', 'ninjatrader')),
  role VARCHAR(20) NOT NULL DEFAULT 'both' CHECK (role IN ('master', 'follower', 'both')),
  label VARCHAR(200),
  credentials_encrypted TEXT NOT NULL,
  webhook_token_hash VARCHAR(64) NOT NULL UNIQUE,
  environment VARCHAR(10) NOT NULL DEFAULT 'demo' CHECK (environment IN ('demo', 'live')),
  balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'error')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_broker_accounts_user_id ON broker_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_broker_accounts_webhook_token_hash ON broker_accounts(webhook_token_hash);
CREATE INDEX IF NOT EXISTS idx_broker_accounts_platform_role ON broker_accounts(platform, role);

-- user_id NULL = global/admin default mapping. Lookup order (see
-- symbolMappingService.js): user-specific mapping -> global default -> identity fallback.
CREATE TABLE IF NOT EXISTS symbol_mappings (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  source_platform VARCHAR(20) NOT NULL CHECK (source_platform IN ('mt4', 'mt5', 'tradelocker', 'ninjatrader')),
  source_symbol VARCHAR(40) NOT NULL,
  target_platform VARCHAR(20) NOT NULL CHECK (target_platform IN ('mt4', 'mt5', 'tradelocker', 'ninjatrader')),
  target_symbol VARCHAR(40) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_symbol_mappings_lookup
  ON symbol_mappings(source_platform, source_symbol, target_platform, user_id);

-- status: pending_approval/active/rejected/cancelled gates cross-user copying
-- (a follower cannot silently attach to another user's master account) while
-- self-to-self relationships activate immediately. Not in the original model
-- shorthand but required to fulfil the master-approval decision made earlier.
CREATE TABLE IF NOT EXISTS trade_copy_relationships (
  id UUID PRIMARY KEY,
  master_account_id UUID NOT NULL REFERENCES broker_accounts(id),
  follower_account_id UUID NOT NULL REFERENCES broker_accounts(id),
  follower_user_id UUID NOT NULL REFERENCES users(id),
  risk_mode VARCHAR(30) NOT NULL DEFAULT 'fixed_lot' CHECK (risk_mode IN ('fixed_lot', 'percent_of_master', 'percent_of_balance')),
  risk_value NUMERIC(12, 4) NOT NULL,
  commission_percent NUMERIC(5, 2),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval', 'active', 'rejected', 'cancelled')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_copy_relationships_master ON trade_copy_relationships(master_account_id);
CREATE INDEX IF NOT EXISTS idx_copy_relationships_follower_user ON trade_copy_relationships(follower_user_id);

CREATE TABLE IF NOT EXISTS copy_trade_events (
  id UUID PRIMARY KEY,
  source_account_id UUID NOT NULL REFERENCES broker_accounts(id),
  event_type VARCHAR(20) NOT NULL CHECK (event_type IN ('position_opened', 'position_closed', 'position_modified')),
  symbol VARCHAR(40) NOT NULL,
  side VARCHAR(10) CHECK (side IN ('buy', 'sell')),
  size NUMERIC(12, 4),
  price NUMERIC(14, 5),
  sl NUMERIC(14, 5),
  tp NUMERIC(14, 5),
  external_position_id VARCHAR(100),
  source VARCHAR(10) NOT NULL CHECK (source IN ('webhook', 'poll')),
  raw_payload JSONB,
  status VARCHAR(20) NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'queued', 'processing', 'completed', 'failed')),
  idempotency_key VARCHAR(64),
  received_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- CREATE TABLE IF NOT EXISTS above is a no-op against an already-existing
-- table, so this column needs its own idempotent add for databases that
-- already ran an earlier version of this schema.
ALTER TABLE copy_trade_events ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_copy_trade_events_source_account ON copy_trade_events(source_account_id);
-- Durable dedup for retried webhook deliveries (or any re-emitted event):
-- computed from source account + external position id + event type + the
-- same side/size/sl/tp fields the poller already hashes to detect position
-- changes. Plain unique index, not partial - Postgres already treats
-- multiple NULLs as non-conflicting, so pre-existing rows without a key are
-- unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_copy_trade_events_idempotency_key ON copy_trade_events(idempotency_key);

CREATE TABLE IF NOT EXISTS copy_executions (
  id UUID PRIMARY KEY,
  trade_event_id UUID NOT NULL REFERENCES copy_trade_events(id),
  follower_account_id UUID NOT NULL REFERENCES broker_accounts(id),
  calculated_size NUMERIC(12, 4),
  mapped_symbol VARCHAR(40),
  result_position_id VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'executed', 'failed', 'skipped')),
  error_message TEXT,
  executed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_copy_executions_trade_event ON copy_executions(trade_event_id);
CREATE INDEX IF NOT EXISTS idx_copy_executions_follower ON copy_executions(follower_account_id);
