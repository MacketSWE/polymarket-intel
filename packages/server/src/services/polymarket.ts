const GAMMA_API = 'https://gamma-api.polymarket.com'
const DATA_API = 'https://data-api.polymarket.com'

export interface Trade {
  proxyWallet: string
  side: 'BUY' | 'SELL'
  size: number
  price: number
  timestamp: number
  title: string
  slug: string
  outcome: string
  name: string
  pseudonym: string
  transactionHash: string
}

export interface Market {
  id: string
  question: string
  slug: string
  volume: string
  volumeNum: number
  volume24hr: number
  volume1wk: number
  liquidity: string
  lastTradePrice: number
  outcomePrices: string
  outcomes: string
  bestBid: number
  bestAsk: number
  spread: number
  closed: boolean
  active: boolean
  endDate: string
}

export interface Position {
  proxyWallet: string
  title: string
  slug: string
  outcome: string
  size: number
  avgPrice: number
  curPrice: number
  currentValue: number
  cashPnl: number
  percentPnl: number
}

interface TradeOptions {
  limit?: number
  offset?: number
  minSize?: number
  market?: string
}

interface MarketOptions {
  limit?: number
  offset?: number
  active?: boolean
  closed?: boolean
  order?: string
  ascending?: boolean
}

interface EventOptions {
  limit?: number
  offset?: number
  closed?: boolean
  order?: string
  ascending?: boolean
  tag_id?: string
  exclude_tag_ids?: string[]
}

export async function getTrades(options: TradeOptions = {}): Promise<Trade[]> {
  const params = new URLSearchParams()
  if (options.limit) params.set('limit', options.limit.toString())
  if (options.offset !== undefined) params.set('offset', options.offset.toString())
  if (options.minSize) params.set('min_size', options.minSize.toString())
  if (options.market) params.set('market', options.market)

  const response = await fetch(`${DATA_API}/trades?${params}`)
  if (!response.ok) throw new Error(`Failed to fetch trades: ${response.status}`)

  return response.json() as Promise<Trade[]>
}

export async function getMarkets(options: MarketOptions = {}): Promise<Market[]> {
  const params = new URLSearchParams()
  if (options.limit) params.set('limit', options.limit.toString())
  if (options.offset !== undefined) params.set('offset', options.offset.toString())
  if (options.active !== undefined) params.set('active', options.active.toString())
  if (options.closed !== undefined) params.set('closed', options.closed.toString())
  if (options.order) params.set('order', options.order)
  if (options.ascending !== undefined) params.set('ascending', options.ascending.toString())

  const response = await fetch(`${GAMMA_API}/markets?${params}`)
  if (!response.ok) throw new Error(`Failed to fetch markets: ${response.status}`)

  return response.json() as Promise<Market[]>
}

export async function getMarket(slug: string): Promise<Market> {
  const response = await fetch(`${GAMMA_API}/markets/${slug}`)
  if (!response.ok) throw new Error(`Failed to fetch market: ${response.status}`)

  return response.json() as Promise<Market>
}

export async function getEvents(options: EventOptions = {}): Promise<unknown[]> {
  const params = new URLSearchParams()
  if (options.limit) params.set('limit', options.limit.toString())
  if (options.offset !== undefined) params.set('offset', options.offset.toString())
  if (options.closed !== undefined) params.set('closed', options.closed.toString())
  if (options.order) params.set('order', options.order)
  if (options.ascending !== undefined) params.set('ascending', options.ascending.toString())
  if (options.tag_id) params.set('tag_id', options.tag_id)

  // Add multiple exclude_tag_id params (API requires separate params for each)
  if (options.exclude_tag_ids) {
    for (const id of options.exclude_tag_ids) {
      params.append('exclude_tag_id', id)
    }
  }

  const response = await fetch(`${GAMMA_API}/events?${params}`)
  if (!response.ok) throw new Error(`Failed to fetch events: ${response.status}`)

  return response.json() as Promise<unknown[]>
}

export async function getUserPositions(wallet: string): Promise<Position[]> {
  const response = await fetch(`${DATA_API}/positions?user=${wallet}`)
  if (!response.ok) throw new Error(`Failed to fetch positions: ${response.status}`)

  return response.json() as Promise<Position[]>
}

export async function getUserActivity(wallet: string): Promise<unknown[]> {
  const response = await fetch(`${DATA_API}/activity?user=${wallet}`)
  if (!response.ok) throw new Error(`Failed to fetch activity: ${response.status}`)

  return response.json() as Promise<unknown[]>
}

export async function getLargeTrades(minSize = 1000, limit = 50): Promise<Trade[]> {

  return getTrades({ minSize, limit })
}

export async function getTraderStats(wallet: string): Promise<{
  positions: Position[]
  totalValue: number
  totalPnl: number
}> {
  const positions = await getUserPositions(wallet)
  const totalValue = positions.reduce((sum, p) => sum + p.currentValue, 0)
  const totalPnl = positions.reduce((sum, p) => sum + p.cashPnl, 0)

  return { positions, totalValue, totalPnl }
}

export interface MarketStats {
  totalMarkets: number
  openMarkets: number
  closedMarkets: number
}

export interface Tag {
  id: string
  slug: string
  label: string
}

export interface Sport {
  id: number
  sport: string
  tags: string
  image?: string
}

let marketStatsCache: { data: MarketStats; timestamp: number } | null = null
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

async function countMarkets(closed: boolean): Promise<number> {
  let count = 0
  let offset = 0
  const limit = 500

  while (true) {
    const response = await fetch(
      `${GAMMA_API}/markets?closed=${closed}&limit=${limit}&offset=${offset}`
    )

    if (!response.ok) {
      throw new Error('Failed to fetch markets for counting')
    }

    const markets = await response.json() as Market[]
    count += markets.length

    if (markets.length < limit) {
      break
    }

    offset += limit
  }

  return count
}

export async function getMarketStats(): Promise<MarketStats> {
  // Return cached data if still valid
  if (marketStatsCache && Date.now() - marketStatsCache.timestamp < CACHE_TTL_MS) {

    return marketStatsCache.data
  }

  const [openMarkets, closedMarkets] = await Promise.all([
    countMarkets(false),
    countMarkets(true)
  ])

  const stats = {
    totalMarkets: openMarkets + closedMarkets,
    openMarkets,
    closedMarkets
  }

  marketStatsCache = { data: stats, timestamp: Date.now() }

  return stats
}

export function prefetchMarketStats(): void {
  console.log('Prefetching market stats...')
  getMarketStats()
    .then(stats => {
      console.log(`Market stats cached: ${stats.totalMarkets} total (${stats.openMarkets} open, ${stats.closedMarkets} closed)`)
    })
    .catch(err => {
      console.error('Failed to prefetch market stats:', err.message)
    })
}

export async function getTags(): Promise<Tag[]> {
  const allTags: Tag[] = []
  let offset = 0
  const limit = 300 // API max per request

  while (true) {
    const response = await fetch(`${GAMMA_API}/tags?limit=${limit}&offset=${offset}`)
    if (!response.ok) throw new Error(`Failed to fetch tags: ${response.status}`)

    const tags = await response.json() as Tag[]
    allTags.push(...tags)

    if (tags.length < limit) break
    offset += limit
  }

  return allTags
}

export async function getSports(): Promise<Sport[]> {
  const response = await fetch(`${GAMMA_API}/sports`)
  if (!response.ok) throw new Error(`Failed to fetch sports: ${response.status}`)

  return response.json() as Promise<Sport[]>
}

export interface PopularTag {
  id: string
  label: string
  slug: string
  count: number
}

interface EventTag {
  id: string
  label: string
  slug: string
}

interface EventWithTags {
  tags?: EventTag[]
}

export async function getPopularTags(eventsToSample = 500): Promise<PopularTag[]> {
  // Fetch high-volume events to derive popular tags
  const response = await fetch(
    `${GAMMA_API}/events?limit=${eventsToSample}&order=volume24hr&ascending=false`
  )
  if (!response.ok) throw new Error(`Failed to fetch events: ${response.status}`)

  const events = await response.json() as EventWithTags[]

  // Count tag occurrences
  const tagCounts = new Map<string, { tag: EventTag; count: number }>()

  for (const event of events) {
    if (!event.tags) continue
    for (const tag of event.tags) {
      const existing = tagCounts.get(tag.id)
      if (existing) {
        existing.count++
      } else {
        tagCounts.set(tag.id, { tag, count: 1 })
      }
    }
  }

  // Sort by count descending
  return Array.from(tagCounts.values())
    .sort((a, b) => b.count - a.count)
    .map(({ tag, count }) => ({
      id: tag.id,
      label: tag.label,
      slug: tag.slug,
      count
    }))
}
