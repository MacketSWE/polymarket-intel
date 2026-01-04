import {
  saveTrades,
  updateWalletProfile,
  getFreshWallets,
  getWalletProfile,
  getTradesByWallet,
  createAlert,
  getAlerts,
  getStats,
  type TradeRecord,
  type WalletProfile,
  type Alert
} from './database.js'
import { getTrades, getMarkets, type Trade } from './polymarket.js'

// Convert API trade to DB record
function toTradeRecord(trade: Trade): TradeRecord {

  return {
    tx_hash: trade.transactionHash,
    wallet: trade.proxyWallet,
    market_slug: trade.slug,
    title: trade.title,
    side: trade.side,
    outcome: trade.outcome,
    size: trade.size,
    price: trade.price,
    timestamp: trade.timestamp
  }
}

// Sync recent trades from API to database
export async function syncTrades(limit = 500): Promise<{
  fetched: number
  saved: number
  wallets: string[]
}> {
  const trades = await getTrades({ limit })
  const records = trades.map(toTradeRecord)
  const saved = saveTrades(records)

  // Update wallet profiles for all wallets in this batch
  const wallets = [...new Set(trades.map(t => t.proxyWallet))]
  for (const wallet of wallets) {
    updateWalletProfile(wallet)
  }

  return { fetched: trades.length, saved, wallets }
}

// Detection thresholds
const THRESHOLDS = {
  FRESH_WALLET_MAX_AGE_DAYS: 7,
  FRESH_WALLET_MIN_VOLUME: 1000,
  LARGE_TRADE_SIZE: 5000,
  WHALE_TRADE_SIZE: 50000,
  VOLUME_SPIKE_RATIO: 5,
}

// Analyze fresh wallets
export interface FreshWalletAlert {
  wallet: string
  firstTradeAt: Date
  ageInDays: number
  totalVolume: number
  tradeCount: number
  volumePerDay: number
  recentTrades: TradeRecord[]
}

export async function detectFreshWallets(): Promise<FreshWalletAlert[]> {
  const freshWallets = getFreshWallets(
    THRESHOLDS.FRESH_WALLET_MAX_AGE_DAYS,
    THRESHOLDS.FRESH_WALLET_MIN_VOLUME
  )

  const alerts: FreshWalletAlert[] = []
  const now = Math.floor(Date.now() / 1000)

  for (const wallet of freshWallets) {
    const ageInSeconds = now - wallet.first_trade_at
    const ageInDays = ageInSeconds / (24 * 60 * 60)
    const volumePerDay = wallet.total_volume / Math.max(ageInDays, 1)
    const recentTrades = getTradesByWallet(wallet.address, 10)

    alerts.push({
      wallet: wallet.address,
      firstTradeAt: new Date(wallet.first_trade_at * 1000),
      ageInDays: Math.round(ageInDays * 10) / 10,
      totalVolume: wallet.total_volume,
      tradeCount: wallet.trade_count,
      volumePerDay: Math.round(volumePerDay),
      recentTrades
    })

    // Create DB alert for high-volume fresh wallets
    if (volumePerDay > 2000 || wallet.total_volume > 10000) {
      createAlert({
        type: 'fresh_wallet',
        severity: wallet.total_volume > 50000 ? 'critical' : 'high',
        wallet: wallet.address,
        details: JSON.stringify({
          ageInDays,
          totalVolume: wallet.total_volume,
          volumePerDay,
          tradeCount: wallet.trade_count
        })
      })
    }
  }

  return alerts
}

// Detect large trades from recent sync
export interface LargeTradeAlert {
  wallet: string
  market: string
  title: string
  size: number
  price: number
  side: string
  outcome: string
  timestamp: Date
  walletProfile: WalletProfile | null
}

export async function detectLargeTrades(minSize = THRESHOLDS.LARGE_TRADE_SIZE): Promise<LargeTradeAlert[]> {
  const trades = await getTrades({ limit: 200 })
  const largeTrades = trades.filter(t => t.size >= minSize)

  const alerts: LargeTradeAlert[] = []

  for (const trade of largeTrades) {
    const walletProfile = getWalletProfile(trade.proxyWallet)

    alerts.push({
      wallet: trade.proxyWallet,
      market: trade.slug,
      title: trade.title,
      size: trade.size,
      price: trade.price,
      side: trade.side,
      outcome: trade.outcome,
      timestamp: new Date(trade.timestamp * 1000),
      walletProfile
    })

    // Create DB alert for whale trades
    if (trade.size >= THRESHOLDS.WHALE_TRADE_SIZE) {
      createAlert({
        type: 'whale_trade',
        severity: 'critical',
        wallet: trade.proxyWallet,
        market_slug: trade.slug,
        details: JSON.stringify({
          size: trade.size,
          price: trade.price,
          side: trade.side,
          outcome: trade.outcome,
          title: trade.title
        })
      })
    }
  }

  return alerts
}

// Detect volume spikes in markets
export interface VolumeSpikeAlert {
  market: string
  question: string
  volume24h: number
  volumeTotal: number
  ratio: number
}

export async function detectVolumeSpikes(): Promise<VolumeSpikeAlert[]> {
  const markets = await getMarkets({ limit: 100, closed: false, order: 'volume24hr', ascending: false })

  const alerts: VolumeSpikeAlert[] = []

  for (const market of markets) {
    const volume24h = market.volumeNum || 0
    // Estimate average by assuming 24h is representative
    // In reality, we'd track this over time
    const volumeTotal = parseFloat(market.volume) || 0

    // Simple heuristic: if 24h volume is significant portion of total
    if (volumeTotal > 0 && volume24h > 10000) {
      const ratio = volume24h / (volumeTotal / 30) // vs 30-day average estimate

      if (ratio > THRESHOLDS.VOLUME_SPIKE_RATIO) {
        alerts.push({
          market: market.slug,
          question: market.question,
          volume24h,
          volumeTotal,
          ratio: Math.round(ratio * 10) / 10
        })

        createAlert({
          type: 'volume_spike',
          severity: ratio > 10 ? 'high' : 'medium',
          market_slug: market.slug,
          details: JSON.stringify({
            question: market.question,
            volume24h,
            ratio
          })
        })
      }
    }
  }

  return alerts
}

// Get wallet analysis
export async function analyzeWallet(address: string): Promise<{
  profile: WalletProfile | null
  trades: TradeRecord[]
  isFresh: boolean
  isWhale: boolean
  riskLevel: string
}> {
  const profile = getWalletProfile(address)
  const trades = getTradesByWallet(address, 50)

  if (!profile) {
    return {
      profile: null,
      trades: [],
      isFresh: true,
      isWhale: false,
      riskLevel: 'unknown'
    }
  }

  const now = Math.floor(Date.now() / 1000)
  const ageInDays = (now - profile.first_trade_at) / (24 * 60 * 60)

  const isFresh = ageInDays < THRESHOLDS.FRESH_WALLET_MAX_AGE_DAYS
  const isWhale = profile.total_volume > 100000

  let riskLevel = 'low'
  if (isFresh && profile.total_volume > 10000) riskLevel = 'high'
  else if (isFresh && profile.total_volume > 1000) riskLevel = 'medium'
  else if (isWhale) riskLevel = 'notable'

  return { profile, trades, isFresh, isWhale, riskLevel }
}

// Get dashboard summary
export async function getDashboardSummary() {
  const stats = getStats()
  const freshWallets = await detectFreshWallets()
  const largeTrades = await detectLargeTrades()
  const alerts = getAlerts(20)

  return {
    stats,
    freshWalletCount: freshWallets.length,
    largeTradeCount: largeTrades.length,
    recentAlerts: alerts,
    topFreshWallets: freshWallets.slice(0, 5),
    topLargeTrades: largeTrades.slice(0, 5)
  }
}
