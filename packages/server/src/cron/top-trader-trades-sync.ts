import { supabaseAdmin } from '../services/supabase.js'

const DATA_API = 'https://data-api.polymarket.com'
const BATCH_SIZE = 5
const DELAY_MS = 200
const TRADES_PER_WALLET = 100

interface RawTrade {
  transactionHash: string
  proxyWallet: string
  side: 'BUY' | 'SELL'
  conditionId: string
  size: number
  price: number
  timestamp: number
  title: string
  slug: string
  icon: string
  eventSlug: string
  outcome: string
  outcomeIndex: number
  name: string
  pseudonym: string
  profileImage: string
}

async function getTopPVWallets(): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('top_pv_traders')
    .select('proxy_wallet')

  if (error) throw error
  return (data || []).map(r => r.proxy_wallet)
}

async function fetchTradesForWallet(wallet: string, limit = TRADES_PER_WALLET): Promise<RawTrade[]> {
  try {
    const response = await fetch(`${DATA_API}/trades?user=${wallet}&limit=${limit}`)
    if (!response.ok) return []
    return response.json() as Promise<RawTrade[]>
  } catch {
    return []
  }
}

async function fetchAllTrades(wallets: string[]): Promise<RawTrade[]> {
  const allTrades: RawTrade[] = []

  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batch = wallets.slice(i, i + BATCH_SIZE)

    const results = await Promise.all(
      batch.map(w => fetchTradesForWallet(w))
    )

    for (const trades of results) {
      allTrades.push(...trades)
    }

    // Delay between batches (except for last batch)
    if (i + BATCH_SIZE < wallets.length) {
      await new Promise(r => setTimeout(r, DELAY_MS))
    }
  }

  return allTrades
}

export async function syncTopTraderTrades(): Promise<{ fetched: number; upserted: number; skipped: number }> {
  // 1. Get wallets from top_pv_traders
  const wallets = await getTopPVWallets()
  if (wallets.length === 0) {
    return { fetched: 0, upserted: 0, skipped: 0 }
  }

  console.log(`  Fetching trades for ${wallets.length} wallets...`)

  // 2. Fetch trades (rate-limited)
  const allTrades = await fetchAllTrades(wallets)

  // Only store BUY trades
  const trades = allTrades.filter(t => t.side === 'BUY')

  if (trades.length === 0) {
    return { fetched: allTrades.length, upserted: 0, skipped: 0 }
  }

  // 3. Filter out already-processed transaction hashes
  const txHashes = trades.map(t => t.transactionHash)

  // Query in batches of 500 to avoid query size limits
  const existingSet = new Set<string>()
  for (let i = 0; i < txHashes.length; i += 500) {
    const batch = txHashes.slice(i, i + 500)
    const { data: existing } = await supabaseAdmin
      .from('top_trader_trades')
      .select('transaction_hash')
      .in('transaction_hash', batch)

    for (const r of existing || []) {
      existingSet.add(r.transaction_hash)
    }
  }

  const newTrades = trades.filter(t => !existingSet.has(t.transactionHash))
  const skipped = trades.length - newTrades.length

  if (newTrades.length === 0) {
    return { fetched: trades.length, upserted: 0, skipped }
  }

  console.log(`  Processing ${newTrades.length} new trades (${skipped} already exist)...`)

  // 4. Upsert each trade
  let upserted = 0

  for (const trade of newTrades) {
    try {
      const positionKey = {
        proxy_wallet: trade.proxyWallet,
        slug: trade.slug,
        side: trade.side,
        outcome: trade.outcome
      }

      // Check if position exists
      const { data: existingPos } = await supabaseAdmin
        .from('top_trader_trades')
        .select('id, total_size, total_value, trade_count, first_timestamp, latest_timestamp')
        .match(positionKey)
        .single()

      const tradeValue = trade.size * trade.price

      if (existingPos) {
        // Update existing position with new aggregates
        const newTotalSize = Number(existingPos.total_size) + trade.size
        const newTotalValue = Number(existingPos.total_value) + tradeValue
        const newFirstTimestamp = Math.min(existingPos.first_timestamp, trade.timestamp)
        const newLatestTimestamp = Math.max(existingPos.latest_timestamp, trade.timestamp)

        const { error } = await supabaseAdmin
          .from('top_trader_trades')
          .update({
            transaction_hash: trade.transactionHash,
            total_size: newTotalSize,
            total_value: newTotalValue,
            avg_price: newTotalValue / newTotalSize,
            trade_count: existingPos.trade_count + 1,
            first_timestamp: newFirstTimestamp,
            latest_timestamp: newLatestTimestamp,
            updated_at: new Date().toISOString()
          })
          .eq('id', existingPos.id)

        if (error) throw error
      } else {
        // Insert new position
        const { error } = await supabaseAdmin
          .from('top_trader_trades')
          .insert({
            transaction_hash: trade.transactionHash,
            proxy_wallet: trade.proxyWallet,
            name: trade.name || null,
            pseudonym: trade.pseudonym || null,
            profile_image: trade.profileImage || null,
            slug: trade.slug,
            event_slug: trade.eventSlug,
            title: trade.title,
            icon: trade.icon || null,
            condition_id: trade.conditionId,
            outcome: trade.outcome,
            outcome_index: trade.outcomeIndex,
            side: trade.side,
            total_size: trade.size,
            total_value: tradeValue,
            avg_price: trade.price,
            trade_count: 1,
            first_timestamp: trade.timestamp,
            latest_timestamp: trade.timestamp
          })

        if (error) throw error
      }

      upserted++
    } catch (err) {
      // Log but continue with other trades
      console.error(`  Failed to upsert trade ${trade.transactionHash.slice(0, 10)}...:`, (err as Error).message)
    }
  }

  return { fetched: trades.length, upserted, skipped }
}
