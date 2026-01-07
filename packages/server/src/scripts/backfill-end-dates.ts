import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') })

import { supabaseAdmin } from '../services/supabase.js'

const CLOB_API = 'https://clob.polymarket.com'
const DELAY_MS = 200 // Delay between API calls to avoid rate limiting

async function fetchMarketEndDate(conditionId: string): Promise<string | null> {
  try {
    const response = await fetch(`${CLOB_API}/markets/${conditionId}`)
    if (!response.ok) return null
    const market = await response.json() as { end_date_iso?: string }
    return market.end_date_iso || null
  } catch {
    return null
  }
}

export async function backfillEndDates(limit = 100): Promise<{ processed: number; updated: number; errors: number }> {
  console.log('Fetching trades without end_date...')

  // Get unique condition_ids that don't have end_date
  const { data: trades, error } = await supabaseAdmin
    .from('trades')
    .select('condition_id')
    .is('end_date', null)
    .limit(limit * 10) // Get more since we'll dedupe

  if (error) {
    console.error('Failed to fetch trades:', error)
    throw error
  }

  // Get unique condition_ids
  const uniqueConditions = [...new Set((trades || []).map(t => t.condition_id))]
  console.log(`Found ${uniqueConditions.length} unique markets without end_date`)

  if (uniqueConditions.length === 0) {
    return { processed: 0, updated: 0, errors: 0 }
  }

  // Limit to specified amount
  const conditionsToProcess = uniqueConditions.slice(0, limit)
  console.log(`Processing ${conditionsToProcess.length} markets...\n`)

  let processed = 0
  let updated = 0
  let errors = 0

  for (const conditionId of conditionsToProcess) {
    try {
      const endDate = await fetchMarketEndDate(conditionId)
      processed++

      if (endDate) {
        // Update all trades with this condition_id
        const { error: updateError, count } = await supabaseAdmin
          .from('trades')
          .update({ end_date: endDate })
          .eq('condition_id', conditionId)
          .is('end_date', null)

        if (updateError) {
          errors++
          console.error(`[ERROR] Failed to update ${conditionId.slice(0, 16)}...:`, updateError)
        } else {
          updated += count || 0
          console.log(`[OK] ${conditionId.slice(0, 16)}... → ${endDate} (${count} trades)`)
        }
      } else {
        console.log(`[SKIP] ${conditionId.slice(0, 16)}... - no end_date available`)
      }

      // Rate limit
      await new Promise(r => setTimeout(r, DELAY_MS))
    } catch (e) {
      errors++
      console.error(`[ERROR] ${conditionId.slice(0, 16)}...: ${(e as Error).message}`)
    }
  }

  console.log('\n=== BACKFILL COMPLETE ===')
  console.log(`Markets processed: ${processed}`)
  console.log(`Trades updated: ${updated}`)
  console.log(`Errors: ${errors}`)

  return { processed, updated, errors }
}

// Run directly if called as script
if (import.meta.url === `file://${process.argv[1]}`) {
  const limit = parseInt(process.argv[2] || '100')
  backfillEndDates(limit).catch(console.error)
}
