import { getTrades } from '../services/polymarket.js'
import { supabaseAdmin } from '../services/supabase.js'

const MIN_AMOUNT_USD = 2500

interface RawTrade {
  transactionHash: string
  proxyWallet: string
  side: 'BUY' | 'SELL'
  asset: string
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
  bio: string
  profileImage: string
  profileImageOptimized: string
}

export async function fetchLatestTrades(): Promise<RawTrade[]> {
  // Fetch 3 batches of 500 in parallel
  const [batch1, batch2, batch3] = await Promise.all([
    getTrades({ limit: 500, offset: 0 }),
    getTrades({ limit: 500, offset: 500 }),
    getTrades({ limit: 500, offset: 1000 })
  ])

  const all = [...batch1, ...batch2, ...batch3] as RawTrade[]

  // Deduplicate by transactionHash
  const unique = [...new Map(all.map(t => [t.transactionHash, t])).values()]

  return unique
}

function mapToDbRecord(trade: RawTrade) {
  return {
    transaction_hash: trade.transactionHash,
    proxy_wallet: trade.proxyWallet,
    side: trade.side,
    asset: trade.asset,
    condition_id: trade.conditionId,
    size: trade.size,
    price: trade.price,
    timestamp: trade.timestamp,
    title: trade.title,
    slug: trade.slug,
    icon: trade.icon,
    event_slug: trade.eventSlug,
    outcome: trade.outcome,
    outcome_index: trade.outcomeIndex,
    name: trade.name,
    pseudonym: trade.pseudonym,
    bio: trade.bio,
    profile_image: trade.profileImage,
    profile_image_optimized: trade.profileImageOptimized
  }
}

export async function syncTrades() {
  const trades = await fetchLatestTrades()

  // Filter trades >= $2500
  const largeTrades = trades.filter(t => t.size * t.price >= MIN_AMOUNT_USD)

  console.log(`Found ${largeTrades.length} trades >= $${MIN_AMOUNT_USD}`)

  if (largeTrades.length === 0) {
    return { fetched: trades.length, uploaded: 0 }
  }

  // Upsert to DB
  const records = largeTrades.map(mapToDbRecord)
  const { error } = await supabaseAdmin
    .from('trades')
    .upsert(records, { onConflict: 'transaction_hash', ignoreDuplicates: true })

  if (error) throw error

  return { fetched: trades.length, uploaded: largeTrades.length }
}
