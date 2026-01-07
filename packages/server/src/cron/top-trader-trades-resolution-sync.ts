import { supabaseAdmin } from '../services/supabase.js'

const CLOB_API = 'https://clob.polymarket.com'
const DELAY_MS = 200

interface Position {
  id: string
  condition_id: string
  outcome: string
  side: 'BUY' | 'SELL'
  avg_price: number
  end_date: string | null
  last_resolution_check: string | null
}

interface MarketResponse {
  closed: boolean
  active: boolean
  accepting_orders: boolean
  end_date_iso?: string
  tokens: Array<{ winner: boolean; outcome: string }>
}

function calculateProfitPerDollar(side: string, avgPrice: number, won: boolean): number | null {
  if (side !== 'BUY') return null
  return won ? (1 - avgPrice) / avgPrice : -1
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
    console.error(`Failed to fetch market ${conditionId}:`, (e as Error).message)
    return null
  }
}

export async function syncTopTraderTradesResolutions(): Promise<{
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

  // Query unresolved positions with priority logic
  const { data: positions, error } = await supabaseAdmin
    .from('top_trader_trades')
    .select('id, condition_id, outcome, side, avg_price, end_date, last_resolution_check')
    .is('resolved_status', null)
    .or(`end_date.is.null,end_date.lte.${sevenDaysFromNow.toISOString()},last_resolution_check.is.null,last_resolution_check.lte.${sevenDaysAgo.toISOString()}`)
    .limit(500)

  if (error) {
    console.error('Failed to fetch positions:', error)
    throw error
  }

  const positionsList = (positions || []) as Position[]
  console.log(`  Found ${positionsList.length} unresolved positions to check`)

  if (positionsList.length === 0) {
    return { checked: 0, resolved: 0, won: 0, lost: 0, pending: 0, errors: 0 }
  }

  // Group positions by condition_id to minimize API calls
  const positionsByCondition = new Map<string, Position[]>()
  for (const position of positionsList) {
    const existing = positionsByCondition.get(position.condition_id) || []
    existing.push(position)
    positionsByCondition.set(position.condition_id, existing)
  }

  console.log(`  Checking ${positionsByCondition.size} unique markets...`)

  let checked = 0
  let resolved = 0
  let won = 0
  let lost = 0
  let pending = 0
  let errors = 0

  for (const [conditionId, conditionPositions] of positionsByCondition) {
    try {
      const status = await fetchMarketStatus(conditionId)

      if (!status) {
        errors++
        continue
      }

      checked += conditionPositions.length

      if (!status.resolved) {
        // Market not resolved yet - update last_resolution_check and end_date if available
        pending += conditionPositions.length

        const updateData: Record<string, string> = {
          last_resolution_check: now.toISOString()
        }
        if (status.endDate) {
          updateData.end_date = status.endDate
        }

        await supabaseAdmin
          .from('top_trader_trades')
          .update(updateData)
          .in('id', conditionPositions.map(p => p.id))

        continue
      }

      // Market is resolved - update all positions
      for (const position of conditionPositions) {
        const isWon = position.outcome === status.winningOutcome
        const resolvedStatus = isWon ? 'won' : 'lost'
        const profitPerDollar = calculateProfitPerDollar(position.side, position.avg_price, isWon)

        const { error: updateError } = await supabaseAdmin
          .from('top_trader_trades')
          .update({
            resolved_status: resolvedStatus,
            profit_per_dollar: profitPerDollar,
            last_resolution_check: now.toISOString(),
            end_date: status.endDate || position.end_date
          })
          .eq('id', position.id)

        if (updateError) {
          errors++
          console.error(`  Failed to update position ${position.id}:`, updateError)
          continue
        }

        resolved++
        if (resolvedStatus === 'won') won++
        else lost++
      }

      // Rate limit
      await new Promise(r => setTimeout(r, DELAY_MS))
    } catch (e) {
      errors++
      console.error(`  Error checking ${conditionId.slice(0, 16)}...: ${(e as Error).message}`)
    }
  }

  return { checked, resolved, won, lost, pending, errors }
}
