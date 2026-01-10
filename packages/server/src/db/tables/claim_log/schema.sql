-- Claim log table
-- Tracks all claim attempts for winning positions

CREATE TABLE IF NOT EXISTS claim_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  condition_id TEXT NOT NULL,
  market_slug TEXT NOT NULL,
  outcome TEXT NOT NULL,
  value DECIMAL(20, 6) NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('claimed', 'failed', 'skipped')),
  tx_hash TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_claim_log_condition_id ON claim_log(condition_id);
CREATE INDEX IF NOT EXISTS idx_claim_log_status ON claim_log(status);
CREATE INDEX IF NOT EXISTS idx_claim_log_created_at ON claim_log(created_at DESC);

-- Unique constraint to prevent duplicate successful claims
CREATE UNIQUE INDEX IF NOT EXISTS idx_claim_log_unique_claimed
  ON claim_log(condition_id)
  WHERE status = 'claimed';

-- RLS policies
ALTER TABLE claim_log ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role can manage claim_log" ON claim_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
