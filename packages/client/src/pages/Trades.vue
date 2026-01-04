<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import PageLayout from '../components/PageLayout.vue'

interface Trade {
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

interface TraderStats {
  tradeCount: number
  totalVolume: number
  avgSize: number
  buyCount: number
  sellCount: number
  firstTrade: number | null
  topMarkets: { title: string; count: number }[]
}

const loading = ref(true)
const rawTrades = ref<Trade[]>([])
const error = ref('')
const selectedTrade = ref<Trade | null>(null)
const traderStats = ref<TraderStats | null>(null)
const loadingTrader = ref(false)
const sortKey = ref<string>('timestamp')
const sortDir = ref<'asc' | 'desc'>('desc')
const minSize = ref(0)
const currentUtc = ref('')
let clockInterval: number | null = null
const seenHashes = new Set<string>()
const MAX_TRADES = 5000 // Cap to prevent memory issues

function updateClock() {
  const now = new Date()
  currentUtc.value = now.toISOString().slice(11, 19) + ' UTC'
}

// Client-side filtered and sorted trades (API doesn't support min_size filter)
const trades = computed(() => {
  // Filter by minimum size client-side
  const filtered = rawTrades.value.filter(t => t.size >= minSize.value)
  const dir = sortDir.value === 'asc' ? 1 : -1

  filtered.sort((a, b) => {
    if (sortKey.value === 'timestamp') {
      return (b.timestamp - a.timestamp) * (sortDir.value === 'asc' ? -1 : 1)
    } else if (sortKey.value === 'size') {
      return (b.size - a.size) * (sortDir.value === 'asc' ? -1 : 1)
    } else if (sortKey.value === 'price') {
      return (b.price - a.price) * (sortDir.value === 'asc' ? -1 : 1)
    } else if (sortKey.value === 'amount') {
      return ((b.size * b.price) - (a.size * a.price)) * (sortDir.value === 'asc' ? -1 : 1)
    } else if (sortKey.value === 'title') {
      return a.title.localeCompare(b.title) * dir
    }
    return 0
  })
  return filtered
})

function toggleSort(key: string) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = key === 'title' ? 'asc' : 'desc'
  }
}

function formatUSD(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}

function formatDate(timestamp: number): string {
  const d = new Date(timestamp * 1000)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor(Date.now() / 1000 - timestamp)
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

async function fetchTraderStats(wallet: string) {
  loadingTrader.value = true
  traderStats.value = null

  try {
    const response = await fetch(`/api/polymarket/trades?maker=${wallet}&limit=500`)
    const data = await response.json()

    if (data.success && data.data.length > 0) {
      const trades = data.data as Trade[]

      // Calculate stats
      const totalVolume = trades.reduce((sum, t) => sum + t.size, 0)
      const buyCount = trades.filter(t => t.side === 'BUY').length
      const sellCount = trades.filter(t => t.side === 'SELL').length

      // Get top markets
      const marketCounts = new Map<string, number>()
      for (const t of trades) {
        marketCounts.set(t.title, (marketCounts.get(t.title) || 0) + 1)
      }
      const topMarkets = Array.from(marketCounts.entries())
        .map(([title, count]) => ({ title, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3)

      // Find oldest trade (first trade)
      const oldestTrade = trades.reduce((oldest, t) =>
        t.timestamp < oldest.timestamp ? t : oldest, trades[0])

      traderStats.value = {
        tradeCount: trades.length,
        totalVolume,
        avgSize: totalVolume / trades.length,
        buyCount,
        sellCount,
        firstTrade: oldestTrade.timestamp,
        topMarkets
      }
    }
  } catch (e) {
    console.error('Failed to fetch trader stats:', e)
  }

  loadingTrader.value = false
}

function selectTrade(trade: Trade) {
  if (selectedTrade.value?.transactionHash === trade.transactionHash) {
    selectedTrade.value = null
    traderStats.value = null
  } else {
    selectedTrade.value = trade
    fetchTraderStats(trade.proxyWallet)
  }
}

function getMarketUrl(slug: string) {
  return `https://polymarket.com/event/${slug}`
}

function getWalletUrl(wallet: string) {
  return `https://polymarket.com/profile/${wallet}`
}

function getTxUrl(hash: string) {
  return `https://polygonscan.com/tx/${hash}`
}

function shortenWallet(wallet: string): string {
  return wallet.slice(0, 6) + '...' + wallet.slice(-4)
}

function shortenHash(hash: string): string {
  return hash.slice(0, 10) + '...'
}

async function fetchTrades() {
  loading.value = true
  error.value = ''

  try {
    // Fetch pages sequentially to avoid overlap from real-time data changes
    const PAGE_SIZE = 500
    const PAGES = 10
    const allFetchedTrades: Trade[] = []

    for (let page = 0; page < PAGES; page++) {
      const offset = page * PAGE_SIZE
      const response = await fetch(`/api/polymarket/trades?limit=${PAGE_SIZE}&offset=${offset}`)
      const data = await response.json()
      if (data.success) {
        allFetchedTrades.push(...data.data)
      }
    }

    // Find new trades we haven't seen before
    const newTrades: Trade[] = []
    let existingCount = 0
    for (const trade of allFetchedTrades) {
      if (seenHashes.has(trade.transactionHash)) {
        existingCount++
      } else {
        newTrades.push(trade)
        seenHashes.add(trade.transactionHash)
      }
    }

    // Merge new trades with existing, sort by timestamp desc
    const merged = [...newTrades, ...rawTrades.value]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, MAX_TRADES) // Cap at max

    console.log(`[Trades] Fetched ${allFetchedTrades.length} | New: ${newTrades.length} | Seen before: ${existingCount} | Total: ${merged.length}`)

    rawTrades.value = merged
  } catch (e) {
    error.value = 'Failed to fetch trades'
    console.error(e)
  }

  loading.value = false
}

function setMinSize(size: number) {
  minSize.value = size
  // No need to re-fetch, filtering is done client-side
}

onMounted(() => {
  fetchTrades()
  updateClock()
  clockInterval = window.setInterval(updateClock, 1000)
})

onUnmounted(() => {
  if (clockInterval) clearInterval(clockInterval)
})
</script>

<template>
  <PageLayout title="Trades">
    <template #subnav>
      <button
        @click="setMinSize(0)"
        :class="['subnav-btn', { active: minSize === 0 }]"
      >
        All
      </button>
      <button
        v-for="size in [10000, 25000, 50000, 100000]"
        :key="size"
        @click="setMinSize(size)"
        :class="['subnav-btn', { active: minSize === size }]"
      >
        ${{ size / 1000 }}k+
      </button>
      <span class="subnav-spacer"></span>
      <span class="utc-clock">{{ currentUtc }}</span>
      <button @click="fetchTrades" :disabled="loading" class="btn btn-sm">
        {{ loading ? 'Loading...' : 'Refresh' }}
      </button>
    </template>

    <div v-if="loading && trades.length === 0" class="loading">Loading trades...</div>
    <div v-else-if="error" class="error">{{ error }}</div>

    <div v-else class="content-layout">
      <!-- Trades Table -->
      <div class="trades-container">
        <div class="table-header">
          <span class="subtitle">{{ trades.length }} {{ minSize > 0 ? `trades over ${formatUSD(minSize)}` : 'trades' }}</span>
        </div>
        <div class="table-scroll">
          <table class="table">
            <thead>
              <tr>
                <th class="th-sortable" :class="{ sorted: sortKey === 'timestamp' }" @click="toggleSort('timestamp')">
                  <span class="th-content">Time <span class="sort-icon">{{ sortKey === 'timestamp' ? (sortDir === 'asc' ? '↑' : '↓') : '⇅' }}</span></span>
                </th>
                <th class="th-static">Side</th>
                <th class="th-sortable" :class="{ sorted: sortKey === 'size' }" @click="toggleSort('size')">
                  <span class="th-content">Size <span class="sort-icon">{{ sortKey === 'size' ? (sortDir === 'asc' ? '↑' : '↓') : '⇅' }}</span></span>
                </th>
                <th class="th-sortable" :class="{ sorted: sortKey === 'price' }" @click="toggleSort('price')">
                  <span class="th-content">Price <span class="sort-icon">{{ sortKey === 'price' ? (sortDir === 'asc' ? '↑' : '↓') : '⇅' }}</span></span>
                </th>
                <th class="th-sortable" :class="{ sorted: sortKey === 'amount' }" @click="toggleSort('amount')">
                  <span class="th-content">Amount <span class="sort-icon">{{ sortKey === 'amount' ? (sortDir === 'asc' ? '↑' : '↓') : '⇅' }}</span></span>
                </th>
                <th class="th-sortable" :class="{ sorted: sortKey === 'title' }" @click="toggleSort('title')">
                  <span class="th-content">Market <span class="sort-icon">{{ sortKey === 'title' ? (sortDir === 'asc' ? '↑' : '↓') : '⇅' }}</span></span>
                </th>
                <th class="th-static">Outcome</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="trade in trades"
                :key="trade.transactionHash"
                :class="['trade-row', { selected: selectedTrade?.transactionHash === trade.transactionHash }]"
                @click="selectTrade(trade)"
              >
                <td class="time">{{ timeAgo(trade.timestamp) }}</td>
                <td>
                  <span :class="['side', trade.side.toLowerCase()]">{{ trade.side }}</span>
                </td>
                <td class="size">{{ formatUSD(trade.size) }}</td>
                <td class="price">{{ (trade.price * 100).toFixed(1) }}¢</td>
                <td class="amount">{{ formatUSD(trade.size * trade.price) }}</td>
                <td class="title-cell">{{ trade.title }}</td>
                <td class="outcome">{{ trade.outcome }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Detail Panel -->
      <div class="detail-panel" :class="{ open: selectedTrade }">
        <template v-if="selectedTrade">
          <div class="panel-header">
            <h3 class="panel-title">Trade Details</h3>
            <button class="close-btn" @click="selectedTrade = null">×</button>
          </div>

          <div class="panel-content">
            <div class="detail-row">
              <span class="detail-label">Time</span>
              <span class="detail-value">{{ formatDate(selectedTrade.timestamp) }} UTC</span>
            </div>

            <div class="detail-row">
              <span class="detail-label">Side</span>
              <span :class="['side', selectedTrade.side.toLowerCase()]">{{ selectedTrade.side }}</span>
            </div>

            <div class="detail-row">
              <span class="detail-label">Size</span>
              <span class="detail-value size-large">{{ formatUSD(selectedTrade.size) }}</span>
            </div>

            <div class="detail-row">
              <span class="detail-label">Price</span>
              <span class="detail-value">{{ (selectedTrade.price * 100).toFixed(2) }}¢</span>
            </div>

            <div class="detail-row">
              <span class="detail-label">Outcome</span>
              <span class="detail-value">{{ selectedTrade.outcome }}</span>
            </div>

            <div class="detail-section">
              <span class="detail-label">Market</span>
              <p class="market-title">{{ selectedTrade.title }}</p>
              <a :href="getMarketUrl(selectedTrade.slug)" target="_blank" class="detail-link">View on Polymarket ↗</a>
            </div>

            <div class="detail-section">
              <span class="detail-label">Trader</span>
              <p class="trader-info">
                <span v-if="selectedTrade.name || selectedTrade.pseudonym" class="trader-name">
                  {{ selectedTrade.name || selectedTrade.pseudonym }}
                </span>
                <code class="wallet">{{ shortenWallet(selectedTrade.proxyWallet) }}</code>
              </p>
              <a :href="getWalletUrl(selectedTrade.proxyWallet)" target="_blank" class="detail-link">View Profile ↗</a>
            </div>

            <!-- Trader Stats -->
            <div class="detail-section trader-stats">
              <span class="detail-label">Trader Stats (last 500)</span>
              <div v-if="loadingTrader" class="stats-loading">Loading...</div>
              <div v-else-if="traderStats" class="stats-grid">
                <div class="stat-item">
                  <span class="stat-value">{{ traderStats.tradeCount }}</span>
                  <span class="stat-label">Trades</span>
                </div>
                <div class="stat-item">
                  <span class="stat-value">{{ formatUSD(traderStats.totalVolume) }}</span>
                  <span class="stat-label">Volume</span>
                </div>
                <div class="stat-item">
                  <span class="stat-value">{{ formatUSD(traderStats.avgSize) }}</span>
                  <span class="stat-label">Avg Size</span>
                </div>
                <div class="stat-item">
                  <span class="stat-value ratio">
                    <span class="buy">{{ traderStats.buyCount }}</span>
                    <span class="sep">/</span>
                    <span class="sell">{{ traderStats.sellCount }}</span>
                  </span>
                  <span class="stat-label">Buy/Sell</span>
                </div>
              </div>
              <div v-if="traderStats && traderStats.topMarkets.length > 0" class="top-markets">
                <span class="stat-label">Top Markets</span>
                <ul class="market-list">
                  <li v-for="market in traderStats.topMarkets" :key="market.title">
                    {{ market.title.slice(0, 40) }}{{ market.title.length > 40 ? '...' : '' }}
                    <span class="market-count">({{ market.count }})</span>
                  </li>
                </ul>
              </div>
            </div>

            <div class="detail-section">
              <span class="detail-label">Transaction</span>
              <code class="tx-hash">{{ shortenHash(selectedTrade.transactionHash) }}</code>
              <a :href="getTxUrl(selectedTrade.transactionHash)" target="_blank" class="detail-link">View on Polygonscan ↗</a>
            </div>
          </div>
        </template>
        <div v-else class="panel-empty">
          Select a trade to view details
        </div>
      </div>
    </div>
  </PageLayout>
</template>

<style scoped>
/* Subnav */
.subnav-btn {
  background: transparent;
  color: var(--text-muted);
  border: none;
  padding: var(--spacing-xs) var(--spacing-md);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: var(--font-base);
  font-weight: 500;
  transition: all 0.15s;
}

.subnav-btn:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.subnav-btn.active {
  background: var(--accent-primary);
  color: var(--accent-primary-text);
}

.subnav-spacer {
  flex: 1;
}

.utc-clock {
  font-family: monospace;
  font-size: var(--font-sm);
  color: var(--text-muted);
  padding: var(--spacing-xs) var(--spacing-sm);
  background: var(--bg-tertiary);
  border-radius: var(--radius-md);
}

.btn {
  background: var(--accent-primary);
  color: var(--accent-primary-text);
  border: none;
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: var(--font-base);
  font-weight: 500;
}

.btn:hover {
  background: var(--accent-primary-hover);
}

.btn:disabled {
  background: #444;
  cursor: not-allowed;
}

.btn-sm {
  padding: var(--spacing-xs) var(--spacing-sm);
  font-size: var(--font-sm);
}

/* Loading/Error */
.loading,
.error {
  padding: var(--spacing-xl);
  text-align: center;
}

.error {
  color: var(--accent-red);
}

/* Master-Detail Layout */
.content-layout {
  display: flex;
  gap: var(--spacing-md);
  height: calc(100vh - 120px);
}

.trades-container {
  flex: 1;
  min-width: 0;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-xl);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.table-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-sm) var(--spacing-md);
  border-bottom: 1px solid var(--border-primary);
  background: var(--bg-elevated);
}

.subtitle {
  color: var(--text-muted);
  font-size: var(--font-sm);
}

.table-scroll {
  flex: 1;
  overflow-y: auto;
}

/* Table */
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-md);
}

.table th,
.table td {
  padding: 0.5rem 0.75rem;
  text-align: left;
  border-bottom: 1px solid var(--border-primary);
}

.table th {
  font-weight: 600;
  color: var(--text-muted);
  font-size: var(--font-sm);
  text-transform: uppercase;
  background: var(--bg-elevated);
  user-select: none;
  position: sticky;
  top: 0;
  z-index: 1;
}

.th-sortable {
  cursor: pointer;
  transition: color 0.15s;
}

.th-sortable:hover {
  color: var(--text-primary);
}

.th-sortable.sorted {
  color: var(--text-primary);
}

.th-content {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
}

.sort-icon {
  font-size: var(--font-xs);
  opacity: 0.5;
}

.th-sortable.sorted .sort-icon {
  opacity: 1;
}

.time {
  color: var(--text-muted);
  font-size: var(--font-sm);
  white-space: nowrap;
  width: 80px;
}

.side {
  font-size: var(--font-sm);
  font-weight: 600;
  padding: 0.1rem 0.4rem;
  border-radius: var(--radius-sm);
}

.side.buy {
  background: var(--status-open-bg);
  color: var(--status-open-text);
}

.side.sell {
  background: rgba(239, 68, 68, 0.15);
  color: var(--accent-red);
}

.size {
  color: var(--accent-green);
  font-family: monospace;
  font-weight: 600;
  width: 100px;
}

.price {
  color: var(--text-muted);
  font-family: monospace;
  width: 70px;
}

.amount {
  color: var(--text-secondary);
  font-family: monospace;
  width: 100px;
}

.title-cell {
  font-weight: 500;
  color: var(--text-secondary);
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.outcome {
  color: var(--text-muted);
  font-size: var(--font-sm);
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trade-row {
  cursor: pointer;
  transition: background 0.15s;
}

.trade-row:hover {
  background: var(--bg-tertiary);
}

.trade-row.selected {
  background: var(--bg-active);
}

/* Detail Panel */
.detail-panel {
  width: 350px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-xl);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: opacity 0.15s;
}

.detail-panel:not(.open) {
  opacity: 0.5;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-md);
  border-bottom: 1px solid var(--border-primary);
  background: var(--bg-elevated);
}

.panel-title {
  font-size: var(--font-base);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.close-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: var(--font-lg);
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.close-btn:hover {
  color: var(--text-primary);
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: var(--spacing-md);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.detail-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-xs) 0;
}

.detail-label {
  font-size: var(--font-sm);
  color: var(--text-muted);
  text-transform: uppercase;
}

.detail-value {
  font-size: var(--font-sm);
  color: var(--text-secondary);
}

.size-large {
  font-size: var(--font-base);
  font-weight: 600;
  color: var(--accent-green);
}

.detail-section {
  padding: var(--spacing-sm) 0;
  border-top: 1px solid var(--border-primary);
}

.market-title {
  font-size: var(--font-sm);
  color: var(--text-secondary);
  margin: var(--spacing-xs) 0;
  line-height: 1.4;
}

.trader-info {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin: var(--spacing-xs) 0;
}

.trader-name {
  font-size: var(--font-sm);
  color: var(--text-secondary);
  font-weight: 500;
}

.wallet,
.tx-hash {
  font-size: var(--font-xs);
  color: var(--text-muted);
  background: var(--bg-tertiary);
  padding: 0.125rem 0.375rem;
  border-radius: var(--radius-sm);
}

.detail-link {
  display: inline-block;
  font-size: var(--font-sm);
  color: var(--accent-blue);
  text-decoration: none;
  margin-top: var(--spacing-xs);
}

.detail-link:hover {
  color: var(--accent-blue-hover);
  text-decoration: underline;
}

.panel-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: var(--font-sm);
}

/* Trader Stats */
.trader-stats {
  background: var(--bg-tertiary);
  border-radius: var(--radius-md);
  padding: var(--spacing-sm) !important;
  margin-top: var(--spacing-xs);
}

.stats-loading {
  color: var(--text-muted);
  font-size: var(--font-sm);
  padding: var(--spacing-sm) 0;
}

.stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-xs);
}

.stat-item {
  display: flex;
  flex-direction: column;
  padding: var(--spacing-xs);
  background: var(--bg-secondary);
  border-radius: var(--radius-sm);
}

.stat-value {
  font-size: var(--font-base);
  font-weight: 600;
  color: var(--text-primary);
}

.stat-value.ratio {
  display: flex;
  gap: 2px;
}

.stat-value .buy {
  color: var(--accent-green);
}

.stat-value .sell {
  color: var(--accent-red);
}

.stat-value .sep {
  color: var(--text-muted);
}

.stat-label {
  font-size: var(--font-xs);
  color: var(--text-muted);
  text-transform: uppercase;
}

.top-markets {
  margin-top: var(--spacing-sm);
  padding-top: var(--spacing-sm);
  border-top: 1px solid var(--border-primary);
}

.market-list {
  list-style: none;
  padding: 0;
  margin: var(--spacing-xs) 0 0 0;
}

.market-list li {
  font-size: var(--font-xs);
  color: var(--text-secondary);
  padding: 2px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.market-count {
  color: var(--text-muted);
}
</style>
