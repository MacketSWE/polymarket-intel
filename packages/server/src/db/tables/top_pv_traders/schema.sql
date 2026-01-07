-- Step 1: Create table
CREATE TABLE top_pv_traders (
  id SERIAL PRIMARY KEY,
  proxy_wallet TEXT NOT NULL UNIQUE,
  user_name TEXT,
  x_username TEXT,
  verified_badge BOOLEAN DEFAULT FALSE,
  profile_image TEXT,
  pnl DECIMAL(20, 2) NOT NULL,
  vol DECIMAL(20, 2) NOT NULL,
  pv DECIMAL(10, 6) NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('7d', '30d', 'both')),
  rank INTEGER NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_top_pv_traders_pv ON top_pv_traders(pv DESC);
CREATE INDEX idx_top_pv_traders_rank ON top_pv_traders(rank);
