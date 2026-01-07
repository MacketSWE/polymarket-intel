import { supabaseAdmin } from '../services/supabase.js'

const DATA_API = 'https://data-api.polymarket.com'
const BATCH_SIZE = 5
const DELAY_MS = 200
const TRADES_PER_WALLET = 50

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

export async function syncTopTraderTrades(): Promise<{ fetched: number; inserted: number; skipped: number }> {
  // 1. Get wallets from top_pv_traders
  const wallets = await getTopPVWallets()
  if (wallets.length === 0) {
    console.log(`[TOP-TRADES] No wallets in top_pv_traders table`)
    return { fetched: 0, inserted: 0, skipped: 0 }
  }

  console.log(`[TOP-TRADES] Fetching trades for ${wallets.length} top traders...`)

  // 2. Fetch trades (rate-limited)
  const allTrades = await fetchAllTrades(wallets)

  // Only store BUY trades
  const trades = allTrades.filter(t => t.side === 'BUY')
  console.log(`[TOP-TRADES] Fetched ${allTrades.length} total trades, ${trades.length} BUY trades`)

  if (trades.length === 0) {
    return { fetched: allTrades.length, inserted: 0, skipped: 0 }
  }

  // 3. Prepare rows for insert
  const rows = trades.map(trade => ({
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
    total_value: trade.size * trade.price,
    avg_price: trade.price,
    trade_count: 1,
    first_timestamp: trade.timestamp,
    latest_timestamp: trade.timestamp
  }))

  // 4. Bulk insert, skip duplicates (unique constraint on wallet+slug+side+outcome)
  let inserted = 0
  let skipped = 0
  const INSERT_BATCH = 100

  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const batch = rows.slice(i, i + INSERT_BATCH)

    const { data, error } = await supabaseAdmin
      .from('top_trader_trades')
      .upsert(batch, {
        onConflict: 'proxy_wallet,slug,side,outcome',
        ignoreDuplicates: true
      })
      .select('id')

    if (error) {
      console.error(`[TOP-TRADES] Batch insert error:`, error.message)
      skipped += batch.length
    } else {
      inserted += data?.length || 0
      skipped += batch.length - (data?.length || 0)
    }
  }

  return { fetched: trades.length, inserted, skipped }
}
