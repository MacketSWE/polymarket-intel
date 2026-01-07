CREATE TABLE bet_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id TEXT UNIQUE,
  market_slug TEXT NOT NULL,
  condition_id TEXT,
  token_id TEXT,
  outcome TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  amount DECIMAL(20, 8) NOT NULL,
  price DECIMAL(10, 8) NOT NULL,
  size DECIMAL(20, 8),
  order_type TEXT CHECK (order_type IN ('GTC', 'GTD', 'FOK')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'placed', 'filled', 'partial', 'cancelled', 'failed')) DEFAULT 'pending',
  error_message TEXT,
  source TEXT CHECK (source IN ('manual', 'auto')) DEFAULT 'manual',
  -- Trigger info (if auto-bet)
  trigger_trade_id UUID REFERENCES trades(id),
  trigger_wallet TEXT,
  trigger_follow_score INTEGER,
  -- Resolution tracking
  resolved_status TEXT CHECK (resolved_status IN ('won', 'lost')),
  pnl DECIMAL(20, 8),
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  placed_at TIMESTAMPTZ,
  filled_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

CREATE INDEX idx_bet_log_status ON bet_log(status);
CREATE INDEX idx_bet_log_market_slug ON bet_log(market_slug);
CREATE INDEX idx_bet_log_created_at ON bet_log(created_at DESC);
CREATE INDEX idx_bet_log_source ON bet_log(source);
CREATE INDEX idx_bet_log_resolved ON bet_log(resolved_status) WHERE resolved_status IS NOT NULL;

-- Enable Row Level Security
ALTER TABLE public.bet_log ENABLE ROW LEVEL SECURITY;

-- Revoke any broad default grants
REVOKE ALL ON public.bet_log FROM PUBLIC;
REVOKE ALL ON public.bet_log FROM authenticated;

-- Grant privileges to authenticated role
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bet_log TO authenticated;

-- Policies: allow authenticated role to do any operation
CREATE POLICY "authenticated_full_access_select" ON public.bet_log
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated_full_access_insert" ON public.bet_log
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "authenticated_full_access_update" ON public.bet_log
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "authenticated_full_access_delete" ON public.bet_log
  FOR DELETE
  TO authenticated
  USING (true);
