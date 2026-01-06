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

export async function getUserPositions(wallet: string, limit = 500): Promise<Position[]> {
  const response = await fetch(`${DATA_API}/positions?user=${wallet}&limit=${limit}`)
  if (!response.ok) throw new Error(`Failed to fetch positions: ${response.status}`)

  return response.json() as Promise<Position[]>
}

export async function getUserActivity(wallet: string, limit = 500, offset = 0): Promise<unknown[]> {
  const response = await fetch(`${DATA_API}/activity?user=${wallet}&limit=${limit}&offset=${offset}`)
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

// === Trader Profile & Classification ===

export interface TraderProfile {
  createdAt: string | null
  proxyWallet: string | null
  profileImage: string | null
  bio: string | null
  pseudonym: string | null
  name: string | null
  xUsername: string | null
  verifiedBadge: boolean | null
}

export interface LeaderboardEntry {
  rank: string
  proxyWallet: string
  userName: string
  vol: number
  pnl: number
  profileImage: string
  xUsername: string
  verifiedBadge: boolean
}

export interface ClosedPosition {
  proxyWallet: string
  asset: string
  conditionId: string
  avgPrice: number
  totalBought: number
  realizedPnl: number
  curPrice: number
  timestamp: number
  title: string
  slug: string
  outcome: string
}

export interface TraderClassification {
  type: 'insider' | 'bot' | 'whale' | 'normal'
  confidence: number
  insiderScore: number
  botScore: number
  whaleScore: number
  followScore: number
  followWorthy: boolean
  reasons: string[]
  followReasons: string[]
  profile: TraderProfile | null
  leaderboardRank: number | null
  totalVolume: number
  totalPnl: number
  realizedPnl: number
  unrealizedPnl: number
  accountAgeDays: number | null
  marketsTraded: number
  winRate: number | null
  avgTradeSize: number
  tradesPerDay: number
}

export async function getTraderProfile(wallet: string): Promise<TraderProfile | null> {
  try {
    const response = await fetch(`${GAMMA_API}/public-profile?address=${wallet}`)
    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`Failed to fetch profile: ${response.status}`)
    }
    return response.json() as Promise<TraderProfile>
  } catch {
    return null
  }
}

export async function getTraderLeaderboardRank(wallet: string): Promise<LeaderboardEntry | null> {
  try {
    const response = await fetch(`${DATA_API}/v1/leaderboard?user=${wallet}&timePeriod=ALL`)
    if (!response.ok) return null
    const data = await response.json() as LeaderboardEntry[]
    return data.length > 0 ? data[0] : null
  } catch {
    return null
  }
}

export async function getClosedPositions(wallet: string, limit = 100): Promise<ClosedPosition[]> {
  try {
    const response = await fetch(`${DATA_API}/closed-positions?user=${wallet}&limit=${limit}`)
    if (!response.ok) return []
    return response.json() as Promise<ClosedPosition[]>
  } catch {
    return []
  }
}

interface ActivityItem {
  timestamp: number
  type: string
  usdcSize: number
  price: number
  title: string
}

export async function classifyTrader(wallet: string): Promise<TraderClassification> {
  // Fetch all data in parallel
  const [profile, leaderboard, activity, positions, closedPositions] = await Promise.all([
    getTraderProfile(wallet),
    getTraderLeaderboardRank(wallet),
    getUserActivity(wallet, 500, 0) as Promise<ActivityItem[]>,
    getUserPositions(wallet),
    getClosedPositions(wallet, 100)
  ])

  const trades = activity.filter(a => a.type === 'TRADE')
  const reasons: string[] = []

  // Calculate basic metrics
  const totalVolume = trades.reduce((sum, t) => sum + (t.usdcSize || 0), 0)
  const marketsTraded = new Set(trades.map(t => t.title)).size
  const avgTradeSize = trades.length > 0 ? totalVolume / trades.length : 0

  // Calculate trades per day
  let tradesPerDay = 0
  if (trades.length >= 2) {
    const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp)
    const firstTrade = sortedTrades[0].timestamp
    const lastTrade = sortedTrades[sortedTrades.length - 1].timestamp
    const daySpan = (lastTrade - firstTrade) / 86400
    tradesPerDay = daySpan > 0 ? trades.length / daySpan : trades.length
  }

  // Calculate win rate from closed positions
  let winRate: number | null = null
  if (closedPositions.length > 0) {
    const wins = closedPositions.filter(p => p.realizedPnl > 0).length
    winRate = (wins / closedPositions.length) * 100
  }

  // Calculate account age
  let accountAgeDays: number | null = null
  if (profile?.createdAt) {
    const created = new Date(profile.createdAt)
    accountAgeDays = Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24))
  }

  // Calculate total PnL
  const unrealizedPnl = positions.reduce((sum, p) => sum + p.cashPnl, 0)
  const realizedPnl = closedPositions.reduce((sum, p) => sum + p.realizedPnl, 0)
  const totalPnl = unrealizedPnl + realizedPnl

  // === INSIDER SCORE (0-100) ===
  let insiderScore = 0

  // New account (< 7 days)
  if (accountAgeDays !== null && accountAgeDays < 7) {
    insiderScore += 30
    reasons.push(`New account: ${accountAgeDays} days old`)
  } else if (accountAgeDays !== null && accountAgeDays < 30) {
    insiderScore += 15
  }

  // Few markets traded
  if (marketsTraded < 3) {
    insiderScore += 25
    reasons.push(`Only ${marketsTraded} markets traded`)
  } else if (marketsTraded < 5) {
    insiderScore += 15
  }

  // Large single trade relative to total volume
  const maxTrade = Math.max(...trades.map(t => t.usdcSize || 0), 0)
  if (totalVolume > 0 && maxTrade / totalVolume > 0.5) {
    insiderScore += 20
    reasons.push(`Single trade is ${((maxTrade / totalVolume) * 100).toFixed(0)}% of volume`)
  }

  // Betting on low probability with large amounts
  const lowProbLargeBets = trades.filter(t =>
    (t.price < 0.1 || t.price > 0.9) && (t.usdcSize || 0) > 1000
  )
  if (lowProbLargeBets.length > 0) {
    insiderScore += 15
    reasons.push(`${lowProbLargeBets.length} large bets on extreme odds`)
  }

  // No profile info
  if (!profile?.bio && !profile?.xUsername && !profile?.profileImage) {
    insiderScore += 10
    reasons.push('No profile info')
  }

  // High win rate with low volume (suspicious accuracy)
  if (winRate !== null && winRate > 80 && closedPositions.length >= 3 && closedPositions.length < 20) {
    insiderScore += 15
    reasons.push(`${winRate.toFixed(0)}% win rate on ${closedPositions.length} markets`)
  }

  // === BOT SCORE (0-100) ===
  let botScore = 0

  // High trade frequency
  if (tradesPerDay > 50) {
    botScore += 35
    reasons.push(`High frequency: ${tradesPerDay.toFixed(1)} trades/day`)
  } else if (tradesPerDay > 20) {
    botScore += 20
  }

  // Rapid trades (avg time between trades)
  if (trades.length >= 10) {
    const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp)
    let totalTimeDiff = 0
    for (let i = 1; i < sortedTrades.length; i++) {
      totalTimeDiff += sortedTrades[i].timestamp - sortedTrades[i - 1].timestamp
    }
    const avgTimeBetween = totalTimeDiff / (sortedTrades.length - 1)
    if (avgTimeBetween < 60) {
      botScore += 25
      reasons.push(`Avg ${avgTimeBetween.toFixed(0)}s between trades`)
    } else if (avgTimeBetween < 300) {
      botScore += 10
    }
  }

  // Many small trades
  const smallTrades = trades.filter(t => (t.usdcSize || 0) < 10)
  if (trades.length > 20 && smallTrades.length / trades.length > 0.8) {
    botScore += 20
    reasons.push(`${((smallTrades.length / trades.length) * 100).toFixed(0)}% trades under $10`)
  }

  // Trading at extreme prices (market making behavior)
  const extremePriceTrades = trades.filter(t => t.price < 0.01 || t.price > 0.99)
  if (trades.length > 10 && extremePriceTrades.length / trades.length > 0.3) {
    botScore += 15
    reasons.push('Frequent extreme price trades')
  }

  // === WHALE SCORE (0-100) ===
  // Whales are BIG money - millions in volume, $10k+ trades
  let whaleScore = 0

  // High total volume (whale = $500k+)
  if (totalVolume > 1000000) {
    whaleScore += 40
    reasons.push(`$${(totalVolume / 1000000).toFixed(1)}M total volume`)
  } else if (totalVolume > 500000) {
    whaleScore += 25
    reasons.push(`$${(totalVolume / 1000).toFixed(0)}k total volume`)
  }

  // Large average trade size (whale = $10k+ avg)
  if (avgTradeSize > 25000) {
    whaleScore += 35
    reasons.push(`Avg trade: $${(avgTradeSize / 1000).toFixed(1)}k`)
  } else if (avgTradeSize > 10000) {
    whaleScore += 20
    reasons.push(`Avg trade: $${(avgTradeSize / 1000).toFixed(1)}k`)
  }

  // Top leaderboard rank (top 500)
  if (leaderboard) {
    const rank = parseInt(leaderboard.rank)
    if (rank <= 100) {
      whaleScore += 25
      reasons.push(`Leaderboard rank #${rank}`)
    } else if (rank <= 500) {
      whaleScore += 15
    }
  }

  // Verified badge
  if (profile?.verifiedBadge) {
    whaleScore += 10
    // Verified users are less likely to be insiders
    insiderScore = Math.max(0, insiderScore - 20)
  }

  // Diverse market participation reduces insider score
  if (marketsTraded > 20) {
    insiderScore = Math.max(0, insiderScore - 15)
  }

  // === FOLLOW SCORE (0-100) ===
  // Is this trader worth copying/following?
  let followScore = 0
  const followReasons: string[] = []

  // Profitability is key
  if (totalPnl > 50000) {
    followScore += 30
    followReasons.push(`+$${(totalPnl / 1000).toFixed(0)}k profit`)
  } else if (totalPnl > 10000) {
    followScore += 20
    followReasons.push(`+$${(totalPnl / 1000).toFixed(0)}k profit`)
  } else if (totalPnl > 1000) {
    followScore += 10
  } else if (totalPnl < -5000) {
    followScore -= 20
    followReasons.push(`Losing: $${(totalPnl / 1000).toFixed(0)}k`)
  } else if (totalPnl < 0) {
    followScore -= 10
  }

  // Win rate matters
  if (winRate !== null && closedPositions.length >= 5) {
    if (winRate >= 70) {
      followScore += 25
      followReasons.push(`${winRate.toFixed(0)}% win rate`)
    } else if (winRate >= 60) {
      followScore += 15
      followReasons.push(`${winRate.toFixed(0)}% win rate`)
    } else if (winRate >= 55) {
      followScore += 10
    } else if (winRate < 40) {
      followScore -= 15
      followReasons.push(`Poor ${winRate.toFixed(0)}% win rate`)
    }
  }

  // Need enough closed positions to judge
  if (closedPositions.length >= 20) {
    followScore += 15
    followReasons.push(`${closedPositions.length} resolved bets`)
  } else if (closedPositions.length >= 10) {
    followScore += 10
  } else if (closedPositions.length < 3) {
    followScore -= 10
    followReasons.push('Too few resolved bets')
  }

  // Market diversity shows skill across topics
  if (marketsTraded >= 20) {
    followScore += 10
  } else if (marketsTraded >= 10) {
    followScore += 5
  }

  // Account age = track record
  if (accountAgeDays !== null) {
    if (accountAgeDays >= 180) {
      followScore += 10
      followReasons.push(`${Math.floor(accountAgeDays / 30)}mo track record`)
    } else if (accountAgeDays >= 90) {
      followScore += 5
    } else if (accountAgeDays < 14) {
      followScore -= 10
      followReasons.push('New account')
    }
  }

  // Leaderboard presence
  if (leaderboard) {
    const rank = parseInt(leaderboard.rank)
    if (rank <= 100) {
      followScore += 15
      followReasons.push(`Top 100 (#${rank})`)
    } else if (rank <= 500) {
      followScore += 10
      followReasons.push(`Top 500 (#${rank})`)
    } else if (rank <= 1000) {
      followScore += 5
    }
  }

  // Bots are hard to follow (too fast)
  if (botScore >= 50) {
    followScore -= 20
    followReasons.push('Bot behavior (hard to copy)')
  } else if (botScore >= 30) {
    followScore -= 10
  }

  // Reasonable trade sizes (can actually copy)
  if (avgTradeSize >= 500 && avgTradeSize <= 50000) {
    followScore += 5
  } else if (avgTradeSize < 50) {
    followScore -= 5
    followReasons.push('Micro trades')
  }

  // Cap the score
  followScore = Math.max(0, Math.min(100, followScore))
  const followWorthy = followScore >= 50

  // Determine primary type
  let type: 'insider' | 'bot' | 'whale' | 'normal' = 'normal'
  let confidence = 0

  const maxScore = Math.max(insiderScore, botScore, whaleScore)

  if (maxScore >= 40) {
    if (insiderScore === maxScore) {
      type = 'insider'
      confidence = Math.min(100, insiderScore)
    } else if (botScore === maxScore) {
      type = 'bot'
      confidence = Math.min(100, botScore)
    } else {
      type = 'whale'
      confidence = Math.min(100, whaleScore)
    }
  }

  return {
    type,
    confidence,
    insiderScore,
    botScore,
    whaleScore,
    followScore,
    followWorthy,
    reasons,
    followReasons,
    profile,
    leaderboardRank: leaderboard ? parseInt(leaderboard.rank) : null,
    totalVolume,
    totalPnl,
    realizedPnl,
    unrealizedPnl,
    accountAgeDays,
    marketsTraded,
    winRate,
    avgTradeSize,
    tradesPerDay
  }
}
