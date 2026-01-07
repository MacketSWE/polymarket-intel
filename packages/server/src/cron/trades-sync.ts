import { getTrades, classifyTrader } from '../services/polymarket.js'
import { supabaseAdmin } from '../services/supabase.js'

const MIN_AMOUNT_USD = 2500
const CLOB_API = 'https://clob.polymarket.com'

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

interface Classification {
  good_trader: boolean
  follow_score: number
  insider_score: number
  bot_score: number
  whale_score: number
  classification: string
}

interface MarketInfo {
  endDate: string | null
}

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

function qualifiesForTakeBet(trade: RawTrade, classification?: Classification): boolean {
  const amount = trade.size * trade.price
  const followScore = classification?.follow_score ?? 0

  return followScore >= 75 &&
    trade.side === 'BUY' &&
    amount >= 3000 &&
    trade.price <= 0.65
}

function mapToDbRecord(trade: RawTrade, classification?: Classification, takeBet?: boolean, endDate?: string | null) {
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
    profile_image_optimized: trade.profileImageOptimized,
    // Classification columns
    good_trader: classification?.good_trader ?? null,
    follow_score: classification?.follow_score ?? null,
    insider_score: classification?.insider_score ?? null,
    bot_score: classification?.bot_score ?? null,
    whale_score: classification?.whale_score ?? null,
    classification: classification?.classification ?? null,
    take_bet: takeBet ?? null,
    end_date: endDate ?? null
  }
}

export async function syncTrades() {
  const trades = await fetchLatestTrades()

  // Filter trades >= $2500
  const largeTrades = trades.filter(t => t.size * t.price >= MIN_AMOUNT_USD)

  console.log(`[TRADES] Found ${largeTrades.length} trades >= $${MIN_AMOUNT_USD}`)

  if (largeTrades.length === 0) {
    return { fetched: trades.length, uploaded: 0, classified: 0 }
  }

  // Get unique wallets from this batch
  const uniqueWallets = [...new Set(largeTrades.map(t => t.proxyWallet))]

  // Check which wallets already have classification in trades table
  const { data: existingClassified } = await supabaseAdmin
    .from('trades')
    .select('proxy_wallet, good_trader, follow_score, insider_score, bot_score, whale_score, classification')
    .in('proxy_wallet', uniqueWallets)
    .not('good_trader', 'is', null)
    .limit(1000)

  // Build wallet -> classification map from existing trades
  const classificationMap = new Map<string, Classification>()
  for (const trade of existingClassified || []) {
    if (!classificationMap.has(trade.proxy_wallet)) {
      classificationMap.set(trade.proxy_wallet, {
        good_trader: trade.good_trader,
        follow_score: trade.follow_score,
        insider_score: trade.insider_score,
        bot_score: trade.bot_score,
        whale_score: trade.whale_score,
        classification: trade.classification
      })
    }
  }

  // Find wallets that need classification
  const newWallets = uniqueWallets.filter(w => !classificationMap.has(w))
  let classified = 0

  // Classify new wallets (limit to 10 per sync to avoid API overload)
  if (newWallets.length > 0) {
    console.log(`[TRADES] Classifying ${Math.min(newWallets.length, 10)} new wallets...`)

    for (const wallet of newWallets.slice(0, 10)) {
      try {
        const c = await classifyTrader(wallet)

        // Add to map for trade records
        const classification: Classification = {
          good_trader: c.followWorthy,
          follow_score: c.followScore,
          insider_score: c.insiderScore,
          bot_score: c.botScore,
          whale_score: c.whaleScore,
          classification: c.type
        }
        classificationMap.set(wallet, classification)

        classified++
        console.log(`[TRADES]   ${wallet.slice(0, 10)}... → ${c.followWorthy ? 'GOOD' : 'skip'} (score: ${c.followScore})`)
      } catch (e) {
        console.error(`[TRADES] Failed to classify ${wallet.slice(0, 10)}...:`, (e as Error).message)
      }
    }
  }

  // Fetch end dates for unique condition_ids
  const uniqueConditions = [...new Set(largeTrades.map(t => t.conditionId))]

  // Check which conditions already have end_date in DB
  const { data: existingEndDates } = await supabaseAdmin
    .from('trades')
    .select('condition_id, end_date')
    .in('condition_id', uniqueConditions)
    .not('end_date', 'is', null)
    .limit(1000)

  const endDateMap = new Map<string, string | null>()
  for (const t of existingEndDates || []) {
    if (!endDateMap.has(t.condition_id)) {
      endDateMap.set(t.condition_id, t.end_date)
    }
  }

  // Fetch end dates for new conditions (limit to 20 per sync)
  const newConditions = uniqueConditions.filter(c => !endDateMap.has(c))
  if (newConditions.length > 0) {
    console.log(`[TRADES] Fetching end dates for ${Math.min(newConditions.length, 20)} markets...`)
    for (const conditionId of newConditions.slice(0, 20)) {
      const endDate = await fetchMarketEndDate(conditionId)
      endDateMap.set(conditionId, endDate)
    }
  }

  // Get existing take bets to avoid duplicates per (wallet, market, outcome)
  const potentialTakeBets = largeTrades.filter(t => {
    const classification = classificationMap.get(t.proxyWallet)
    return qualifiesForTakeBet(t, classification)
  })

  // Build set of existing take bet keys
  const existingTakeBetKeys = new Set<string>()
  if (potentialTakeBets.length > 0) {
    const { data: existingTakes } = await supabaseAdmin
      .from('trades')
      .select('proxy_wallet, condition_id, outcome')
      .eq('take_bet', true)

    for (const t of existingTakes || []) {
      existingTakeBetKeys.add(`${t.proxy_wallet}:${t.condition_id}:${t.outcome}`)
    }
  }

  // Track new take bets in this batch to avoid duplicates within batch
  const newTakeBetKeys = new Set<string>()

  // Map trades to DB records WITH classifications, checking for existing take bets
  const records = largeTrades.map(trade => {
    const classification = classificationMap.get(trade.proxyWallet)
    const key = `${trade.proxyWallet}:${trade.conditionId}:${trade.outcome}`

    let takeBet = false
    if (classification && qualifiesForTakeBet(trade, classification)) {
      // Only mark as take_bet if no existing take bet for this (wallet, market, outcome)
      if (!existingTakeBetKeys.has(key) && !newTakeBetKeys.has(key)) {
        takeBet = true
        newTakeBetKeys.add(key)
      }
    }

    const endDate = endDateMap.get(trade.conditionId)
    return mapToDbRecord(trade, classification, takeBet, endDate)
  })

  // Upsert to DB
  const { error } = await supabaseAdmin
    .from('trades')
    .upsert(records, { onConflict: 'transaction_hash', ignoreDuplicates: true })

  if (error) throw error

  return { fetched: trades.length, uploaded: largeTrades.length, classified }
}

