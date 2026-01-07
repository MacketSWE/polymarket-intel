CREATE TABLE top_trader_trades (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  transaction_hash TEXT NOT NULL UNIQUE,

  -- Trader info
  proxy_wallet TEXT NOT NULL,
  name TEXT,
  pseudonym TEXT,
  profile_image TEXT,

  -- Market info
  slug TEXT NOT NULL,
  event_slug TEXT NOT NULL,
  title TEXT NOT NULL,
  icon TEXT,
  condition_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  outcome_index INTEGER NOT NULL,

  -- Position info (aggregated)
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  total_size DECIMAL(20, 8) NOT NULL,
  total_value DECIMAL(20, 8) NOT NULL,
  avg_price DECIMAL(10, 8) NOT NULL,
  trade_count INTEGER NOT NULL DEFAULT 1,

  -- Timestamps
  first_timestamp BIGINT NOT NULL,
  latest_timestamp BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Resolution tracking
  resolved_status TEXT CHECK (resolved_status IN ('won', 'lost')),
  end_date TIMESTAMPTZ,
  last_resolution_check TIMESTAMPTZ,
  profit_per_dollar DECIMAL(10, 4),

  -- Unique constraint: one row per trader/market/side/outcome
  UNIQUE (proxy_wallet, slug, side, outcome)
);

-- Indexes
CREATE INDEX idx_ttt_proxy_wallet ON top_trader_trades(proxy_wallet);
CREATE INDEX idx_ttt_latest_timestamp ON top_trader_trades(latest_timestamp DESC);
CREATE INDEX idx_ttt_slug ON top_trader_trades(slug);
CREATE INDEX idx_ttt_side ON top_trader_trades(side);

-- Enable Row Level Security
ALTER TABLE public.top_trader_trades ENABLE ROW LEVEL SECURITY;
