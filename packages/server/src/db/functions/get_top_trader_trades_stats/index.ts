import { supabaseAdmin } from '../../../services/supabase.js'

export interface TopTraderTradesStats {
  totalCount: number
  wonCount: number
  lostCount: number
  totalProfitPerDollar: number
}

export async function getTopTraderTradesStats(): Promise<TopTraderTradesStats | null> {
  const { data, error } = await supabaseAdmin.rpc('get_top_trader_trades_stats')
  if (error) throw error
  if (!data?.[0]) return null

  const row = data[0]
  return {
    totalCount: Number(row.total_count),
    wonCount: Number(row.won_count),
    lostCount: Number(row.lost_count),
    totalProfitPerDollar: Number(row.total_profit_per_dollar),
  }
}
