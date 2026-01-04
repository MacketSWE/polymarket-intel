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
  liquidity: string
  lastTradePrice: number
  outcomePrices: string
  outcomes: string
  bestBid: number
  bestAsk: number
  spread: number
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
  minSize?: number
  market?: string
}

interface MarketOptions {
  limit?: number
  active?: boolean
  closed?: boolean
}

export async function getTrades(options: TradeOptions = {}): Promise<Trade[]> {
  const params = new URLSearchParams()
  if (options.limit) params.set('limit', options.limit.toString())
  if (options.minSize) params.set('min_size', options.minSize.toString())
  if (options.market) params.set('market', options.market)

  const response = await fetch(`${DATA_API}/trades?${params}`)
  if (!response.ok) throw new Error(`Failed to fetch trades: ${response.status}`)

  return response.json() as Promise<Trade[]>
}

export async function getMarkets(options: MarketOptions = {}): Promise<Market[]> {
  const params = new URLSearchParams()
  if (options.limit) params.set('limit', options.limit.toString())
  if (options.active !== undefined) params.set('active', options.active.toString())
  if (options.closed !== undefined) params.set('closed', options.closed.toString())

  const response = await fetch(`${GAMMA_API}/markets?${params}`)
  if (!response.ok) throw new Error(`Failed to fetch markets: ${response.status}`)

  return response.json() as Promise<Market[]>
}

export async function getMarket(slug: string): Promise<Market> {
  const response = await fetch(`${GAMMA_API}/markets/${slug}`)
  if (!response.ok) throw new Error(`Failed to fetch market: ${response.status}`)

  return response.json() as Promise<Market>
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
