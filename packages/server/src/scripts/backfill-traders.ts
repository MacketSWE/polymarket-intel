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

  // Fetch existing take bets to avoid duplicates per (wallet, market, outcome)
  console.log('Fetching existing take bets...')
  const { data: existingTakes } = await supabaseAdmin
    .from('trades')
    .select('proxy_wallet, condition_id, outcome')
    .eq('take_bet', true)

  const existingTakeBetKeys = new Set<string>()
  for (const t of existingTakes || []) {
    existingTakeBetKeys.add(`${t.proxy_wallet}:${t.condition_id}:${t.outcome}`)
  }
  console.log(`Found ${existingTakeBetKeys.size} existing take bets\n`)

  const estimatedTime = (uniqueWallets.length * (DELAY_MS + 1500)) / 1000 / 60
  console.log(`Estimated time: ${estimatedTime.toFixed(1)} minutes\n`)

  let processed = 0
  let goodTraders = 0
  let errors = 0

  for (const wallet of uniqueWallets) {
    try {
      const c = await classifyTrader(wallet)

      // Fetch all trades for this wallet to calculate take_bet per trade
      const { data: walletTrades } = await supabaseAdmin
        .from('trades')
        .select('transaction_hash, condition_id, outcome, side, size, price, timestamp')
        .eq('proxy_wallet', wallet)
        .order('timestamp', { ascending: true }) // Process oldest first

      // Track take bets for this wallet within this batch
      const walletTakeBetKeys = new Set<string>()

      // Update each trade with classification and take_bet
      for (const trade of walletTrades || []) {
        const amount = trade.size * trade.price
        const key = `${wallet}:${trade.condition_id}:${trade.outcome}`

        // take_bet = true if: qualifies AND no existing take bet for this (wallet, market, outcome)
        const qualifies = c.followScore >= 75 &&
          trade.side === 'BUY' &&
          amount >= 3000 &&
          trade.price <= 0.65

        let takeBet = false
        if (qualifies && !existingTakeBetKeys.has(key) && !walletTakeBetKeys.has(key)) {
          takeBet = true
          walletTakeBetKeys.add(key)
          existingTakeBetKeys.add(key) // Add to global set to prevent future duplicates
        }

        await supabaseAdmin
          .from('trades')
          .update({
            good_trader: c.followWorthy,
            follow_score: c.followScore,
            insider_score: c.insiderScore,
            bot_score: c.botScore,
            whale_score: c.whaleScore,
            classification: c.type,
            take_bet: takeBet
          })
          .eq('transaction_hash', trade.transaction_hash)
      }

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
