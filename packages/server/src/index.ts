import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import express from 'express'
import {
  getMarkets,
  getMarket,
  getEvents,
  getTrades,
  getLargeTrades,
  getUserPositions,
  getTraderStats,
  getMarketStats,
  getTags,
  getSports,
  getPopularTags
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

const __dirname = path.dirname(fileURLToPath(import.meta.url))

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

const app = express()
const PORT = process.env.PORT || 3000

app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ message: 'Server is running!', timestamp: new Date().toISOString() })
})

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

app.get('/api/polymarket/positions/:wallet', async (req, res) => {
  try {
    const positions = await getUserPositions(req.params.wallet)
    res.json({ success: true, data: positions })
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

if (process.env.NODE_ENV === 'production') {
  const clientDist = path.resolve(__dirname, '../../client/dist')
  app.use(express.static(clientDist))
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'))
  })
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
