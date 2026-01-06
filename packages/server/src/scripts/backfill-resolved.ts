import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') })

import { supabaseAdmin } from '../services/supabase.js'

const DELAY_MS = 200 // Delay between API calls to avoid rate limiting

interface Trade {
  transaction_hash: string
  condition_id: string
  outcome: string
}

interface MarketResponse {
  closed: boolean
  active: boolean
  accepting_orders: boolean
  tokens: Array<{ winner: boolean; outcome: string }>
}

async function fetchMarketStatus(conditionId: string): Promise<{ resolved: boolean; winningOutcome: string | null } | null> {
  try {
    const response = await fetch(`https://clob.polymarket.com/markets/${conditionId}`)

    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`CLOB API error: ${response.status}`)
    }

    const market = await response.json() as MarketResponse
    const winningToken = market.tokens?.find(t => t.winner === true)

    return {
      resolved: winningToken !== undefined,
      winningOutcome: winningToken?.outcome || null
    }
  } catch (e) {
    console.error(`Failed to fetch market ${conditionId}:`, (e as Error).message)
    return null
  }
}

export async function backfillResolved(limit = 100): Promise<{ processed: number; won: number; lost: number; pending: number; errors: number }> {
  console.log('Fetching unresolved take bets...')

  // Get take bets that don't have resolved_status yet
  const { data: trades, error } = await supabaseAdmin
    .from('trades')
    .select('transaction_hash, condition_id, outcome')
    .eq('take_bet', true)
    .is('resolved_status', null)
    .limit(limit)

  if (error) {
    console.error('Failed to fetch trades:', error)
    throw error
  }

  const tradesList = (trades || []) as Trade[]
  console.log(`Found ${tradesList.length} unresolved take bets to check`)

  if (tradesList.length === 0) {
    return { processed: 0, won: 0, lost: 0, pending: 0, errors: 0 }
  }

  // Group trades by condition_id to minimize API calls
  const tradesByCondition = new Map<string, Trade[]>()
  for (const trade of tradesList) {
    const existing = tradesByCondition.get(trade.condition_id) || []
    existing.push(trade)
    tradesByCondition.set(trade.condition_id, existing)
  }

  console.log(`Checking ${tradesByCondition.size} unique markets...\n`)

  let processed = 0
  let won = 0
  let lost = 0
  let pending = 0
  let errors = 0

  for (const [conditionId, conditionTrades] of tradesByCondition) {
    try {
      const status = await fetchMarketStatus(conditionId)

      if (!status) {
        errors++
        console.log(`[ERROR] Market not found: ${conditionId.slice(0, 16)}...`)
        continue
      }

      if (!status.resolved) {
        // Market not resolved yet, skip
        pending += conditionTrades.length
        console.log(`[PENDING] ${conditionId.slice(0, 16)}... - ${conditionTrades.length} trades`)
        continue
      }

      // Update all trades for this condition
      for (const trade of conditionTrades) {
        const resolvedStatus = trade.outcome === status.winningOutcome ? 'won' : 'lost'

        const { error: updateError } = await supabaseAdmin
          .from('trades')
          .update({ resolved_status: resolvedStatus })
          .eq('transaction_hash', trade.transaction_hash)

        if (updateError) {
          errors++
          console.error(`[ERROR] Failed to update ${trade.transaction_hash}:`, updateError)
          continue
        }

        processed++
        if (resolvedStatus === 'won') won++
        else lost++

        console.log(`[${resolvedStatus.toUpperCase()}] ${trade.transaction_hash.slice(0, 16)}... (${trade.outcome} vs ${status.winningOutcome})`)
      }

      // Rate limit
      await new Promise(r => setTimeout(r, DELAY_MS))
    } catch (e) {
      errors++
      console.error(`[ERROR] ${conditionId.slice(0, 16)}...: ${(e as Error).message}`)
    }
  }

  console.log('\n=== BACKFILL COMPLETE ===')
  console.log(`Processed: ${processed}`)
  console.log(`Won: ${won}`)
  console.log(`Lost: ${lost}`)
  console.log(`Pending: ${pending}`)
  console.log(`Errors: ${errors}`)

  return { processed, won, lost, pending, errors }
}

// Run directly if called as script
if (import.meta.url === `file://${process.argv[1]}`) {
  const limit = parseInt(process.argv[2] || '100')
  backfillResolved(limit).catch(console.error)
}
