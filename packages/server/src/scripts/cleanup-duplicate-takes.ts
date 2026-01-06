import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') })

import { supabaseAdmin } from '../services/supabase.js'

interface TakeBet {
  transaction_hash: string
  proxy_wallet: string
  condition_id: string
  outcome: string
  timestamp: number
}

export async function cleanupDuplicateTakes(): Promise<{ checked: number; duplicates: number; cleaned: number }> {
  console.log('Fetching all take bets...')

  const { data: takeBets, error } = await supabaseAdmin
    .from('trades')
    .select('transaction_hash, proxy_wallet, condition_id, outcome, timestamp')
    .eq('take_bet', true)
    .order('timestamp', { ascending: true })

  if (error) {
    console.error('Failed to fetch take bets:', error)
    throw error
  }

  const bets = (takeBets || []) as TakeBet[]
  console.log(`Found ${bets.length} total take bets`)

  // Group by (proxy_wallet, condition_id, outcome)
  const groups = new Map<string, TakeBet[]>()
  for (const bet of bets) {
    const key = `${bet.proxy_wallet}:${bet.condition_id}:${bet.outcome}`
    const existing = groups.get(key) || []
    existing.push(bet)
    groups.set(key, existing)
  }

  // Find groups with duplicates
  const duplicateGroups = [...groups.entries()].filter(([, bets]) => bets.length > 1)
  console.log(`Found ${duplicateGroups.length} groups with duplicates\n`)

  let cleaned = 0
  let totalDuplicates = 0

  for (const [key, groupBets] of duplicateGroups) {
    // Sort by timestamp ascending (oldest first)
    groupBets.sort((a, b) => a.timestamp - b.timestamp)

    // Keep the first one, remove take_bet from the rest
    const [keep, ...remove] = groupBets
    totalDuplicates += remove.length

    console.log(`[${key.slice(0, 40)}...] Keeping ${keep.transaction_hash.slice(0, 12)}..., removing ${remove.length} duplicates`)

    for (const bet of remove) {
      const { error: updateError } = await supabaseAdmin
        .from('trades')
        .update({ take_bet: false })
        .eq('transaction_hash', bet.transaction_hash)

      if (updateError) {
        console.error(`  Failed to update ${bet.transaction_hash}:`, updateError)
        continue
      }
      cleaned++
    }
  }

  console.log('\n=== CLEANUP COMPLETE ===')
  console.log(`Checked: ${bets.length} take bets`)
  console.log(`Duplicate groups: ${duplicateGroups.length}`)
  console.log(`Duplicates removed: ${cleaned}`)

  return { checked: bets.length, duplicates: totalDuplicates, cleaned }
}

// Run directly if called as script
if (import.meta.url === `file://${process.argv[1]}`) {
  cleanupDuplicateTakes().catch(console.error)
}
