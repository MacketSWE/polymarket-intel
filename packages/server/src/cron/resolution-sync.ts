import { supabaseAdmin } from '../services/supabase.js'

const CLOB_API = 'https://clob.polymarket.com'
const DELAY_MS = 200 // Rate limit delay between API calls

interface Trade {
  transaction_hash: string
  condition_id: string
  outcome: string
  side: 'BUY' | 'SELL'
  price: number
  end_date: string | null
  last_resolution_check: string | null
}

function calculateProfitPerDollar(side: string, price: number, won: boolean): number | null {
  // Only calculate for BUY trades
  if (side !== 'BUY') return null
  return won ? (1 - price) / price : -1
}

interface MarketResponse {
  closed: boolean
  active: boolean
  accepting_orders: boolean
  end_date_iso?: string
  tokens: Array<{ winner: boolean; outcome: string }>
}

async function fetchMarketStatus(conditionId: string): Promise<{
  resolved: boolean
  winningOutcome: string | null
  endDate: string | null
} | null> {
  try {
    const response = await fetch(`${CLOB_API}/markets/${conditionId}`)

    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`CLOB API error: ${response.status}`)
    }

    const market = await response.json() as MarketResponse
    const winningToken = market.tokens?.find(t => t.winner === true)

    return {
      resolved: winningToken !== undefined,
      winningOutcome: winningToken?.outcome || null,
      endDate: market.end_date_iso || null
    }
  } catch (e) {
    console.error(`[RESOLUTION] Failed to fetch market ${conditionId}:`, (e as Error).message)
    return null
  }
}

export async function syncResolutions(): Promise<{
  checked: number
  resolved: number
  won: number
  lost: number
  pending: number
  errors: number
}> {
  const now = new Date()
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  // Query unresolved trades with priority logic:
  // Priority 1: end_date <= now + 7 days OR end_date is null
  // Priority 2: last_resolution_check is null OR older than 7 days
  const { data: trades, error } = await supabaseAdmin
    .from('trades')
    .select('transaction_hash, condition_id, outcome, side, price, end_date, last_resolution_check')
    .is('resolved_status', null)
    .or(`end_date.is.null,end_date.lte.${sevenDaysFromNow.toISOString()},last_resolution_check.is.null,last_resolution_check.lte.${sevenDaysAgo.toISOString()}`)
    .limit(500)

  if (error) {
    console.error('[RESOLUTION] Failed to fetch trades:', error)
    throw error
  }

  const tradesList = (trades || []) as Trade[]
  console.log(`[RESOLUTION] Found ${tradesList.length} unresolved trades to check`)

  if (tradesList.length === 0) {
    return { checked: 0, resolved: 0, won: 0, lost: 0, pending: 0, errors: 0 }
  }

  // Group trades by condition_id to minimize API calls
  const tradesByCondition = new Map<string, Trade[]>()
  for (const trade of tradesList) {
    const existing = tradesByCondition.get(trade.condition_id) || []
    existing.push(trade)
    tradesByCondition.set(trade.condition_id, existing)
  }

  console.log(`[RESOLUTION] Checking ${tradesByCondition.size} unique markets...`)

  let checked = 0
  let resolved = 0
  let won = 0
  let lost = 0
  let pending = 0
  let errors = 0

  for (const [conditionId, conditionTrades] of tradesByCondition) {
    try {
      const status = await fetchMarketStatus(conditionId)

      if (!status) {
        errors++
        console.log(`[RESOLUTION] Market not found: ${conditionId.slice(0, 16)}...`)
        continue
      }

      checked += conditionTrades.length

      if (!status.resolved) {
        // Market not resolved yet - update last_resolution_check and end_date if we got it
        pending += conditionTrades.length

        const updateData: Record<string, string> = {
          last_resolution_check: now.toISOString()
        }
        if (status.endDate) {
          updateData.end_date = status.endDate
        }

        await supabaseAdmin
          .from('trades')
          .update(updateData)
          .in('transaction_hash', conditionTrades.map(t => t.transaction_hash))

        console.log(`[RESOLUTION] Pending: ${conditionId.slice(0, 16)}... - ${conditionTrades.length} trades`)
        continue
      }

      // Market is resolved - update all trades
      for (const trade of conditionTrades) {
        const isWon = trade.outcome === status.winningOutcome
        const resolvedStatus = isWon ? 'won' : 'lost'
        const profitPerDollar = calculateProfitPerDollar(trade.side, trade.price, isWon)

        const { error: updateError } = await supabaseAdmin
          .from('trades')
          .update({
            resolved_status: resolvedStatus,
            profit_per_dollar: profitPerDollar,
            last_resolution_check: now.toISOString(),
            end_date: status.endDate || trade.end_date
          })
          .eq('transaction_hash', trade.transaction_hash)

        if (updateError) {
          errors++
          console.error(`[RESOLUTION] Failed to update ${trade.transaction_hash}:`, updateError)
          continue
        }

        resolved++
        if (resolvedStatus === 'won') won++
        else lost++

        console.log(`[RESOLUTION] ${resolvedStatus.toUpperCase()}: ${trade.transaction_hash.slice(0, 16)}... (${trade.outcome} vs ${status.winningOutcome})`)
      }

      // Rate limit
      await new Promise(r => setTimeout(r, DELAY_MS))
    } catch (e) {
      errors++
      console.error(`[RESOLUTION] Error: ${conditionId.slice(0, 16)}...: ${(e as Error).message}`)
    }
  }

  console.log(`[RESOLUTION] Summary: checked=${checked}, resolved=${resolved} (${won}W/${lost}L), pending=${pending}, errors=${errors}`)

  return { checked, resolved, won, lost, pending, errors }
}
