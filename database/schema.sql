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
