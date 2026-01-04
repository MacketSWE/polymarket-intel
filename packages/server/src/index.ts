import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import express from 'express'
import {
  getMarkets,
  getMarket,
  getTrades,
  getLargeTrades,
  getUserPositions,
  getTraderStats
} from './services/polymarket.js'

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
    const active = req.query.active === 'true'
    const markets = await getMarkets({ limit, active })
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

app.get('/api/polymarket/trades', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50
    const minSize = req.query.min_size ? parseInt(req.query.min_size as string) : undefined
    const trades = await getTrades({ limit, minSize })
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
