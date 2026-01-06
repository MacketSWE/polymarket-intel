import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') })

import { supabaseAdmin } from '../services/supabase.js'
import { classifyTrader } from '../services/polymarket.js'

const DELAY_MS = 500 // Delay between API calls to avoid rate limiting

async function backfillTraders() {
  console.log('Fetching unique wallets from trades table...')

  // Get all unique wallets from trades table that don't have classification yet
  const { data: trades, error } = await supabaseAdmin
    .from('trades')
    .select('proxy_wallet')
    .is('good_trader', null)

  if (error) {
    console.error('Failed to fetch trades:', error)
    process.exit(1)
  }

  const uniqueWallets = [...new Set(trades?.map(t => t.proxy_wallet) || [])]
  console.log(`Found ${uniqueWallets.length} unique wallets needing classification`)

  if (uniqueWallets.length === 0) {
    console.log('All wallets already classified!')
    process.exit(0)
  }

  const estimatedTime = (uniqueWallets.length * (DELAY_MS + 1500)) / 1000 / 60
  console.log(`Estimated time: ${estimatedTime.toFixed(1)} minutes\n`)

  let processed = 0
  let goodTraders = 0
  let errors = 0

  for (const wallet of uniqueWallets) {
    try {
      const c = await classifyTrader(wallet)

      // Update all trades for this wallet with classification
      await supabaseAdmin
        .from('trades')
        .update({
          good_trader: c.followWorthy,
          follow_score: c.followScore,
          insider_score: c.insiderScore,
          bot_score: c.botScore,
          whale_score: c.whaleScore,
          classification: c.type
        })
        .eq('proxy_wallet', wallet)

      processed++
      if (c.followWorthy) goodTraders++

      const status = c.followWorthy ? 'GOOD' : 'skip'
      const pct = ((processed / uniqueWallets.length) * 100).toFixed(1)
      console.log(`[${processed}/${uniqueWallets.length}] (${pct}%) ${wallet.slice(0, 12)}... → ${status} (score: ${c.followScore}, type: ${c.type})`)

      // Rate limit
      await new Promise(r => setTimeout(r, DELAY_MS))
    } catch (e) {
      errors++
      console.error(`[ERROR] ${wallet.slice(0, 12)}...: ${(e as Error).message}`)
    }
  }

  console.log('\n=== BACKFILL COMPLETE ===')
  console.log(`Processed: ${processed}`)
  console.log(`Good traders: ${goodTraders}`)
  console.log(`Errors: ${errors}`)
}

backfillTraders().catch(console.error)
