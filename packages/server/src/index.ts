import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

import express from 'express'
import cookieParser from 'cookie-parser'
import {
  getMarkets,
  getMarket,
  getEvents,
  getTrades,
  getLargeTrades,
  getUserPositions,
  getUserActivity,
  getTraderStats,
  getMarketStats,
  getTags,
  getSports,
  getPopularTags,
  classifyTrader
} from './services/polymarket.js'
import {
  syncTrades,
  detectFreshWallets,
  detectLargeTrades,
  detectVolumeSpikes,
  analyzeWallet,
  getDashboardSummary
} from './services/analysis.js'
import { getAlerts, getStats } from './services/database.js'
import { supabase, supabaseAdmin } from './services/supabase.js'
import { startCronJobs } from './cron/index.js'

const app = express()
const PORT = process.env.PORT || 3000

app.use(express.json())
app.use(cookieParser())

// Auth endpoints
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password required' })
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      return res.status(401).json({ success: false, error: error.message })
    }

    // Set HTTP-only cookies
    res.cookie('access_token', data.session.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 1000 // 1 hour
    })
    res.cookie('refresh_token', data.session.refresh_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    })

    res.json({ success: true, data: { user: data.user } })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

app.post('/api/auth/logout', async (_req, res) => {
  res.clearCookie('access_token')
  res.clearCookie('refresh_token')
  res.json({ success: true })
})

app.get('/api/auth/me', async (req, res) => {
  try {
    const token = req.cookies.access_token
    if (!token) {
      return res.status(401).json({ success: false, error: 'Not authenticated' })
    }

    const { data, error } = await supabase.auth.getUser(token)
    if (error) {
      res.clearCookie('access_token')
      res.clearCookie('refresh_token')
      return res.status(401).json({ success: false, error: 'Invalid session' })
    }

    res.json({ success: true, data: { user: data.user } })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

app.post('/api/auth/refresh', async (req, res) => {
  try {
    const refreshToken = req.cookies.refresh_token
    if (!refreshToken) {
      return res.status(401).json({ success: false, error: 'No refresh token' })
    }

    const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken })
    if (error || !data.session) {
      res.clearCookie('access_token')
      res.clearCookie('refresh_token')
      return res.status(401).json({ success: false, error: 'Session expired' })
    }

    res.cookie('access_token', data.session.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 1000
    })
    res.cookie('refresh_token', data.session.refresh_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    })

    res.json({ success: true, data: { user: data.user } })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

app.get('/api/health', (_req, res) => {
  res.json({ message: 'Server is running!', timestamp: new Date().toISOString() })
})

// Auth middleware for protected routes
const requireAuth: express.RequestHandler = async (req, res, next) => {
  const token = req.cookies.access_token
  if (!token) {
    return res.status(401).json({ success: false, error: 'Not authenticated' })
  }

  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) {
    res.clearCookie('access_token')
    res.clearCookie('refresh_token')
    return res.status(401).json({ success: false, error: 'Invalid session' })
  }

  next()
}

// Protect all API routes except auth and health
app.use('/api/polymarket', requireAuth)
app.use('/api/analysis', requireAuth)

app.get('/api/polymarket/markets', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined
    const order = (req.query.order as string) || 'volume24hr'
    const ascending = req.query.ascending === 'true'
    const closed = req.query.closed === undefined ? undefined : req.query.closed === 'true'
    const markets = await getMarkets({ limit, offset, closed, order, ascending })
    res.json({ success: true, data: markets })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

app.get('/api/polymarket/markets/:slug', async (req, res) => {
  try {
    const market = await getMarket(req.params.slug)
    res.json({ success: true, data: market })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

app.get('/api/polymarket/events', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined
    const order = (req.query.order as string) || 'volume24hr'
    const ascending = req.query.ascending === 'true'
    const closed = req.query.closed === undefined ? undefined : req.query.closed === 'true'
    const tag_id = req.query.tag_id as string | undefined
    const exclude_tag_ids = req.query.exclude_tag_ids
      ? (req.query.exclude_tag_ids as string).split(',')
      : undefined
    const events = await getEvents({ limit, offset, closed, order, ascending, tag_id, exclude_tag_ids })
    res.json({ success: true, data: events })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

app.get('/api/polymarket/trades', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined
    const minSize = req.query.min_size ? parseInt(req.query.min_size as string) : undefined
    const trades = await getTrades({ limit, offset, minSize })
    res.json({ success: true, data: trades })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

app.get('/api/polymarket/trades/large', async (req, res) => {
  try {
    const minSize = req.query.min_size ? parseInt(req.query.min_size as string) : 1000
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50
    const trades = await getLargeTrades(minSize, limit)
    res.json({ success: true, data: trades })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

app.get('/api/polymarket/trader/:wallet', async (req, res) => {
  try {
    const stats = await getTraderStats(req.params.wallet)
    res.json({ success: true, data: stats })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

app.get('/api/polymarket/classify/:wallet', async (req, res) => {
  try {
    const classification = await classifyTrader(req.params.wallet)
    res.json({ success: true, data: classification })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

app.get('/api/polymarket/positions/:wallet', async (req, res) => {
  try {
    const positions = await getUserPositions(req.params.wallet)
    res.json({ success: true, data: positions })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

app.get('/api/polymarket/activity/:wallet', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 500
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0
    const activity = await getUserActivity(req.params.wallet, limit, offset)
    res.json({ success: true, data: activity })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

app.get('/api/polymarket/stats', async (_req, res) => {
  try {
    const stats = await getMarketStats()
    res.json({ success: true, data: stats })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

app.get('/api/polymarket/tags', async (_req, res) => {
  try {
    const tags = await getTags()
    res.json({ success: true, data: tags })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

app.get('/api/polymarket/sports', async (_req, res) => {
  try {
    const sports = await getSports()
    res.json({ success: true, data: sports })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

app.get('/api/polymarket/tags/popular', async (req, res) => {
  try {
    const sample = req.query.sample ? parseInt(req.query.sample as string) : 500
    const tags = await getPopularTags(sample)
    res.json({ success: true, data: tags })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

// Analysis endpoints
app.post('/api/analysis/sync', async (_req, res) => {
  try {
    const result = await syncTrades(500)
    res.json({ success: true, data: result })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

app.get('/api/analysis/dashboard', async (_req, res) => {
  try {
    const summary = await getDashboardSummary()
    res.json({ success: true, data: summary })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

app.get('/api/analysis/fresh-wallets', async (_req, res) => {
  try {
    const wallets = await detectFreshWallets()
    res.json({ success: true, data: wallets })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

app.get('/api/analysis/large-trades', async (req, res) => {
  try {
    const minSize = req.query.min_size ? parseInt(req.query.min_size as string) : 5000
    const trades = await detectLargeTrades(minSize)
    res.json({ success: true, data: trades })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

app.get('/api/analysis/volume-spikes', async (_req, res) => {
  try {
    const spikes = await detectVolumeSpikes()
    res.json({ success: true, data: spikes })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

app.get('/api/analysis/wallet/:address', async (req, res) => {
  try {
    const analysis = await analyzeWallet(req.params.address)
    res.json({ success: true, data: analysis })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

app.get('/api/analysis/alerts', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50
    const alerts = getAlerts(limit)
    res.json({ success: true, data: alerts })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

app.get('/api/analysis/stats', async (_req, res) => {
  try {
    const stats = getStats()
    res.json({ success: true, data: stats })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

// DB trades endpoint
app.get('/api/trades/large', requireAuth, async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0
    const maxPrice = req.query.max_price ? parseFloat(req.query.max_price as string) : 0.9
    const filter = req.query.filter as string | undefined

    let query = supabaseAdmin
      .from('trades')
      .select('*')
      .eq('side', 'BUY') // Only show BUY trades

    // Apply filter
    if (filter === 'take') {
      query = query.eq('take_bet', true)
    } else if (filter === 'resolved') {
      query = query.not('resolved_status', 'is', null)
    }

    // Filter out high probability trades by default (price > 90 cents)
    if (maxPrice < 1) {
      query = query.lte('price', maxPrice)
    }

    const { data, error } = await query
      .order('timestamp', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) throw error
    res.json({ success: true, data })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

// Take bets endpoint - trades with take_bet = true
app.get('/api/trades/take', requireAuth, async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0

    const { data, error } = await supabaseAdmin
      .from('trades')
      .select('*')
      .eq('side', 'BUY') // Only BUY trades
      .eq('take_bet', true)
      .order('timestamp', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) throw error
    res.json({ success: true, data })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

// Backfill resolved status for take bets
app.post('/api/trades/backfill-resolved', requireAuth, async (req, res) => {
  try {
    const limit = req.body.limit || 100
    const { backfillResolved } = await import('./scripts/backfill-resolved.js')
    const result = await backfillResolved(limit)
    res.json({ success: true, data: result })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

// Cleanup duplicate take bets (keep only first per trader/market/outcome)
app.post('/api/trades/cleanup-duplicates', requireAuth, async (req, res) => {
  try {
    const { cleanupDuplicateTakes } = await import('./scripts/cleanup-duplicate-takes.js')
    const result = await cleanupDuplicateTakes()
    res.json({ success: true, data: result })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

// Resolved trades stats (P/L summary)
app.get('/api/trades/resolved-stats', requireAuth, async (_req, res) => {
  try {
    const { getResolvedStats } = await import('./db/functions/get_resolved_stats/index.js')
    const stats = await getResolvedStats()
    res.json({ success: true, data: stats })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

// Top trader trades stats endpoint
app.get('/api/top-trader-trades/stats', requireAuth, async (_req, res) => {
  try {
    const { getTopTraderTradesStats } = await import('./db/functions/get_top_trader_trades_stats/index.js')
    const stats = await getTopTraderTradesStats()
    res.json({ success: true, data: stats })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

// Top trader trades endpoint - fetches from top_trader_trades table
app.get('/api/top-trader-trades', requireAuth, async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0
    const filter = req.query.filter as string | undefined

    let query = supabaseAdmin
      .from('top_trader_trades')
      .select('*')

    if (filter === 'resolved') {
      query = query.not('resolved_status', 'is', null)
    } else if (filter === 'won') {
      query = query.eq('resolved_status', 'won')
    } else if (filter === 'lost') {
      query = query.eq('resolved_status', 'lost')
    } else if (filter === 'pending') {
      query = query.is('resolved_status', null)
    }

    const { data, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) throw error
    res.json({ success: true, data })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

// User trades endpoint - proxies Polymarket Data API
app.get('/api/polymarket/user/:wallet/trades', requireAuth, async (req, res) => {
  try {
    const { wallet } = req.params
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0

    const params = new URLSearchParams({
      user: wallet,
      limit: String(limit),
      offset: String(offset)
    })

    const response = await fetch(`https://data-api.polymarket.com/trades?${params}`)
    if (!response.ok) {
      throw new Error(`Polymarket API error: ${response.status}`)
    }

    const data = await response.json()
    res.json({ success: true, data })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

// Leaderboard endpoint - proxies Polymarket Data API
app.get('/api/polymarket/leaderboard', requireAuth, async (req, res) => {
  try {
    const timePeriod = (req.query.timePeriod as string) || 'WEEK'
    const orderBy = (req.query.orderBy as string) || 'PNL'
    const category = (req.query.category as string) || 'OVERALL'
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 25
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0

    const params = new URLSearchParams({
      timePeriod,
      orderBy,
      category,
      limit: String(limit),
      offset: String(offset)
    })

    const response = await fetch(`https://data-api.polymarket.com/v1/leaderboard?${params}`)
    if (!response.ok) {
      throw new Error(`Polymarket API error: ${response.status}`)
    }

    const data = await response.json()
    res.json({ success: true, data })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

// Market resolution status endpoint - proxies CLOB API
app.get('/api/market/status/:conditionId', requireAuth, async (req, res) => {
  try {
    const { conditionId } = req.params
    const response = await fetch(`https://clob.polymarket.com/markets/${conditionId}`)

    if (!response.ok) {
      if (response.status === 404) {
        return res.json({ success: true, data: { found: false } })
      }
      throw new Error(`CLOB API error: ${response.status}`)
    }

    const market = await response.json() as {
      closed: boolean
      active: boolean
      accepting_orders: boolean
      end_date_iso: string
      question: string
      tokens: Array<{ winner: boolean; outcome: string }>
    }

    // Extract resolution info
    const winningToken = market.tokens?.find(t => t.winner === true)

    res.json({
      success: true,
      data: {
        found: true,
        closed: market.closed,
        active: market.active,
        acceptingOrders: market.accepting_orders,
        resolved: winningToken !== undefined,
        winningOutcome: winningToken?.outcome || null,
        endDate: market.end_date_iso,
        question: market.question
      }
    })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

// === Betting API Endpoints ===

// Check if betting is configured
app.get('/api/betting/status', requireAuth, async (_req, res) => {
  try {
    const { isBettingConfigured, getBalances } = await import('./services/betting.js')

    if (!isBettingConfigured()) {
      return res.json({
        success: true,
        data: {
          configured: false,
          message: 'Betting not configured. Set POLYGON_PRIVATE_KEY in .env'
        }
      })
    }

    const balances = await getBalances()
    res.json({
      success: true,
      data: {
        configured: true,
        balances
      }
    })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

// Place a bet
app.post('/api/betting/bet', requireAuth, async (req, res) => {
  try {
    const { placeBet } = await import('./services/betting.js')
    const { marketSlug, outcome, side, amount, price, orderType } = req.body

    // Validation
    if (!marketSlug || !outcome || !amount || !price) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: marketSlug, outcome, amount, price'
      })
    }

    if (price < 0.01 || price > 0.99) {
      return res.status(400).json({
        success: false,
        error: 'Price must be between 0.01 and 0.99'
      })
    }

    if (amount < 1) {
      return res.status(400).json({
        success: false,
        error: 'Amount must be at least $1'
      })
    }

    const result = await placeBet({
      marketSlug,
      outcome,
      side: side || 'BUY',
      amount,
      price,
      orderType: orderType || 'GTC'
    })

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error })
    }

    res.json({ success: true, data: result })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

// Get open orders
app.get('/api/betting/orders', requireAuth, async (_req, res) => {
  try {
    const { getOpenOrders } = await import('./services/betting.js')
    const orders = await getOpenOrders()
    res.json({ success: true, data: orders })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

// Cancel an order
app.delete('/api/betting/orders/:orderId', requireAuth, async (req, res) => {
  try {
    const { cancelOrder } = await import('./services/betting.js')
    const result = await cancelOrder(req.params.orderId)

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error })
    }

    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

// Cancel all orders
app.delete('/api/betting/orders', requireAuth, async (_req, res) => {
  try {
    const { cancelAllOrders } = await import('./services/betting.js')
    const result = await cancelAllOrders()

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error })
    }

    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

// Get balances
app.get('/api/betting/balances', requireAuth, async (_req, res) => {
  try {
    const { getBalances } = await import('./services/betting.js')
    const balances = await getBalances()
    res.json({ success: true, data: balances })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

// Get market info for betting
app.get('/api/betting/market/:slug', requireAuth, async (req, res) => {
  try {
    const { getMarketInfo } = await import('./services/betting.js')
    const info = await getMarketInfo(req.params.slug)

    if (!info) {
      return res.status(404).json({ success: false, error: 'Market not found' })
    }

    res.json({ success: true, data: info })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

// Get bet log history
app.get('/api/bet-log', requireAuth, async (req, res) => {
  try {
    const { getBetLogs } = await import('./services/betting.js')
    const limit = parseInt(req.query.limit as string) || 50
    const bets = await getBetLogs(limit)
    res.json({ success: true, data: bets })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

if (process.env.NODE_ENV === 'production') {
  const clientDist = path.resolve(__dirname, '../../client/dist')
  app.use(express.static(clientDist))
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'))
  })
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  startCronJobs()
})
