CREATE OR REPLACE FUNCTION get_resolved_stats()
RETURNS TABLE (
  all_count BIGINT,
  all_won BIGINT,
  all_lost BIGINT,
  all_profit DECIMAL,
  take_count BIGINT,
  take_won BIGINT,
  take_lost BIGINT,
  take_profit DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*) FILTER (WHERE resolved_status IS NOT NULL) AS all_count,
    COUNT(*) FILTER (WHERE resolved_status = 'won') AS all_won,
    COUNT(*) FILTER (WHERE resolved_status = 'lost') AS all_lost,
    COALESCE(SUM(amount * profit_per_dollar) FILTER (WHERE resolved_status IS NOT NULL), 0) AS all_profit,
    COUNT(*) FILTER (WHERE resolved_status IS NOT NULL AND take_bet = true) AS take_count,
    COUNT(*) FILTER (WHERE resolved_status = 'won' AND take_bet = true) AS take_won,
    COUNT(*) FILTER (WHERE resolved_status = 'lost' AND take_bet = true) AS take_lost,
    COALESCE(SUM(amount * profit_per_dollar) FILTER (WHERE resolved_status IS NOT NULL AND take_bet = true), 0) AS take_profit
  FROM trades
  WHERE side = 'BUY';
END;
$$ LANGUAGE plpgsql;
