import { getTrades } from '../services/polymarket.js'

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

export async function syncTrades() {
  const trades = await fetchLatestTrades()

  // Log first 3 trades
  console.log(`Fetched ${trades.length} unique trades. First 3:`)
  trades.slice(0, 3).forEach((t, i) => {
    console.log(`${i + 1}. ${t.side} ${t.size} @ ${t.price} - ${t.title}`)
  })

  return { fetched: trades.length }
}
