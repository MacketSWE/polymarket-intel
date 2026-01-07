CREATE OR REPLACE FUNCTION get_top_trader_trades_stats()
RETURNS TABLE (
  total_count BIGINT,
  won_count BIGINT,
  lost_count BIGINT,
  total_profit_per_dollar DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*) AS total_count,
    COUNT(*) FILTER (WHERE resolved_status = 'won') AS won_count,
    COUNT(*) FILTER (WHERE resolved_status = 'lost') AS lost_count,
    COALESCE(
      SUM(total_value * profit_per_dollar) / NULLIF(SUM(total_value), 0),
      0
    ) AS total_profit_per_dollar
  FROM top_trader_trades
  WHERE profit_per_dollar IS NOT NULL;
END;
$$ LANGUAGE plpgsql;
