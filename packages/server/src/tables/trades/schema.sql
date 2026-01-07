CREATE TABLE trades (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  transaction_hash TEXT NOT NULL UNIQUE,
  proxy_wallet TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  asset TEXT NOT NULL,
  condition_id TEXT NOT NULL,
  size DECIMAL(20, 8) NOT NULL,
  price DECIMAL(10, 8) NOT NULL,
  amount DECIMAL(20, 8) GENERATED ALWAYS AS (size * price) STORED,
  timestamp BIGINT NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  icon TEXT,
  event_slug TEXT NOT NULL,
  outcome TEXT NOT NULL,
  outcome_index INTEGER NOT NULL,
  name TEXT,
  pseudonym TEXT,
  bio TEXT,
  profile_image TEXT,
  profile_image_optimized TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- Classification columns
  good_trader BOOLEAN DEFAULT NULL,
  follow_score INTEGER,
  insider_score INTEGER,
  bot_score INTEGER,
  whale_score INTEGER,
  classification TEXT,
  take_bet BOOLEAN DEFAULT NULL,
  -- Resolution tracking
  resolved_status TEXT CHECK (resolved_status IN ('won', 'lost')),
  end_date TIMESTAMPTZ,
  last_resolution_check TIMESTAMPTZ,
  profit_per_dollar DECIMAL(10, 4)
);

CREATE INDEX idx_trades_proxy_wallet ON trades(proxy_wallet);
CREATE INDEX idx_trades_timestamp ON trades(timestamp DESC);
CREATE INDEX idx_trades_event_slug ON trades(event_slug);
CREATE INDEX idx_trades_side ON trades(side);
CREATE INDEX idx_trades_good_trader ON trades(good_trader) WHERE good_trader = true;
CREATE INDEX idx_trades_follow_score ON trades(follow_score DESC);
CREATE INDEX idx_trades_take_bet_unresolved ON trades(take_bet, end_date) WHERE take_bet = true AND resolved_status IS NULL;
CREATE INDEX idx_trades_condition_id ON trades(condition_id);

-- Enable Row Level Security
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;

-- Revoke any broad default grants if present (optional but explicit)
REVOKE ALL ON public.trades FROM PUBLIC;
REVOKE ALL ON public.trades FROM authenticated;

-- Grant minimal privileges to authenticated role if you want them to use the table
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trades TO authenticated;

-- Policies: allow authenticated role to do any operation
CREATE POLICY "authenticated_full_access_select" ON public.trades
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated_full_access_insert" ON public.trades
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "authenticated_full_access_update" ON public.trades
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "authenticated_full_access_delete" ON public.trades
  FOR DELETE
  TO authenticated
  USING (true);
