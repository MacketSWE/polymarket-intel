import { getTrades, classifyTrader } from '../services/polymarket.js'
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

interface Classification {
  good_trader: boolean
  follow_score: number
  insider_score: number
  bot_score: number
  whale_score: number
  classification: string
}

function mapToDbRecord(trade: RawTrade, classification?: Classification) {
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
    classification: classification?.classification ?? null
  }
}

export async function syncTrades() {
  const trades = await fetchLatestTrades()

  // Filter trades >= $2500
  const largeTrades = trades.filter(t => t.size * t.price >= MIN_AMOUNT_USD)

  console.log(`Found ${largeTrades.length} trades >= $${MIN_AMOUNT_USD}`)

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
    console.log(`Classifying ${Math.min(newWallets.length, 10)} new wallets...`)

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
        console.log(`  ${wallet.slice(0, 10)}... → ${c.followWorthy ? 'GOOD' : 'skip'} (score: ${c.followScore})`)
      } catch (e) {
        console.error(`  Failed to classify ${wallet.slice(0, 10)}...:`, (e as Error).message)
      }
    }
  }

  // Map trades to DB records WITH classifications
  const records = largeTrades.map(trade => {
    const classification = classificationMap.get(trade.proxyWallet)
    return mapToDbRecord(trade, classification)
  })

  // Upsert to DB
  const { error } = await supabaseAdmin
    .from('trades')
    .upsert(records, { onConflict: 'transaction_hash', ignoreDuplicates: true })

  if (error) throw error

  return { fetched: trades.length, uploaded: largeTrades.length, classified }
}

