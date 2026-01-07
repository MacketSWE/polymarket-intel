import { supabaseAdmin } from '../../../services/supabase.js'

export interface ResolvedStats {
  allCount: number
  allWon: number
  allLost: number
  allProfitPerDollar: number
  takeCount: number
  takeWon: number
  takeLost: number
  takeProfitPerDollar: number
}

export async function getResolvedStats(): Promise<ResolvedStats | null> {
  const { data, error } = await supabaseAdmin.rpc('get_resolved_stats')
  if (error) throw error
  if (!data?.[0]) return null

  const row = data[0]
  return {
    allCount: Number(row.all_count),
    allWon: Number(row.all_won),
    allLost: Number(row.all_lost),
    allProfitPerDollar: Number(row.all_profit_per_dollar),
    takeCount: Number(row.take_count),
    takeWon: Number(row.take_won),
    takeLost: Number(row.take_lost),
    takeProfitPerDollar: Number(row.take_profit_per_dollar),
  }
}
