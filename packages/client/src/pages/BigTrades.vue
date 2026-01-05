<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import PageLayout from '../components/PageLayout.vue'

interface DbTrade {
  id: string
  transaction_hash: string
  proxy_wallet: string
  side: 'BUY' | 'SELL'
  size: number
  price: number
  amount: number
  timestamp: number
  title: string
  slug: string
  event_slug: string
  outcome: string
  name: string
  pseudonym: string
}

interface Activity {
  name: string
  pseudonym: string
  timestamp: number
  type: string
  title: string
  side: string
  size: number
  usdcSize: number
  price: number
  outcome: string
}

interface Position {
  proxyWallet: string
  title: string
  slug: string
  eventSlug: string
  outcome: string
  size: number
  avgPrice: number
  curPrice: number
  initialValue: number
  currentValue: number
  cashPnl: number
  percentPnl: number
  realizedPnl: number
  redeemable: boolean
}

interface BotAnalysis {
  totalTrades: number
  totalVolume: number
  tradesPerDay: number
  avgTimeBetweenTrades: number
  uniqueMarkets: number
  mostActiveDay: { date: string; count: number }
  tradingDays: number
  likelyBot: boolean
  botReasons: string[]
}

const loading = ref(true)
const loadingMore = ref(false)
const trades = ref<DbTrade[]>([])
const error = ref('')
const selectedTrade = ref<DbTrade | null>(null)
const sortKey = ref<string>('timestamp')
const sortDir = ref<'asc' | 'desc'>('desc')
const hasMore = ref(true)
const PAGE_SIZE = 100

// Trader analysis state
const traderLoading = ref(false)
const traderActivity = ref<Activity[]>([])
const traderPositions = ref<Position[]>([])
const traderName = ref<string | null>(null)
const traderJoinDate = ref<Date | null>(null)
const traderFirstSeen = ref<Date | null>(null)

const sortedTrades = computed(() => {
  const sorted = [...trades.value]
  const dir = sortDir.value === 'asc' ? 1 : -1

  sorted.sort((a, b) => {
    if (sortKey.value === 'timestamp') {
      return (b.timestamp - a.timestamp) * (sortDir.value === 'asc' ? -1 : 1)
    } else if (sortKey.value === 'size') {
      return (b.size - a.size) * (sortDir.value === 'asc' ? -1 : 1)
    } else if (sortKey.value === 'price') {
      return (b.price - a.price) * (sortDir.value === 'asc' ? -1 : 1)
    } else if (sortKey.value === 'amount') {
      return (b.amount - a.amount) * (sortDir.value === 'asc' ? -1 : 1)
    } else if (sortKey.value === 'title') {
      return a.title.localeCompare(b.title) * dir
    }
    return 0
  })
  return sorted
})

const botAnalysis = computed<BotAnalysis | null>(() => {
  const trades = traderActivity.value.filter(a => a.type === 'TRADE')
  if (trades.length < 2) return null

  const dayMap = new Map<string, Activity[]>()
  for (const trade of trades) {
    const day = new Date(trade.timestamp * 1000).toISOString().split('T')[0]
    if (!dayMap.has(day)) dayMap.set(day, [])
    dayMap.get(day)!.push(trade)
  }

  let mostActiveDay = { date: '', count: 0 }
  for (const [date, dayTrades] of dayMap) {
    if (dayTrades.length > mostActiveDay.count) {
      mostActiveDay = { date, count: dayTrades.length }
    }
  }

  const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp)
  let totalTimeDiff = 0
  for (let i = 1; i < sortedTrades.length; i++) {
    totalTimeDiff += sortedTrades[i].timestamp - sortedTrades[i - 1].timestamp
  }
  const avgTimeBetweenTrades = sortedTrades.length > 1 ? totalTimeDiff / (sortedTrades.length - 1) : 0

  const uniqueMarkets = new Set(trades.map(t => t.title)).size
  const totalVolume = trades.reduce((sum, t) => sum + t.usdcSize, 0)

  const firstTrade = sortedTrades[0]
  const lastTrade = sortedTrades[sortedTrades.length - 1]
  const daySpan = (lastTrade.timestamp - firstTrade.timestamp) / 86400
  const tradesPerDay = daySpan > 0 ? trades.length / daySpan : trades.length

  const botReasons: string[] = []
  if (tradesPerDay > 50) botReasons.push(`High frequency: ${tradesPerDay.toFixed(1)} trades/day`)
  if (avgTimeBetweenTrades < 60 && trades.length > 20) botReasons.push(`Rapid trades: avg ${avgTimeBetweenTrades.toFixed(0)}s between trades`)
  if (mostActiveDay.count > 100) botReasons.push(`${mostActiveDay.count} trades on ${mostActiveDay.date}`)
  if (totalVolume > 100000 && tradesPerDay > 20) botReasons.push(`High volume bot: $${(totalVolume / 1000).toFixed(0)}k traded`)

  return {
    totalTrades: trades.length,
    totalVolume,
    tradesPerDay,
    avgTimeBetweenTrades,
    uniqueMarkets,
    mostActiveDay,
    tradingDays: dayMap.size,
    likelyBot: botReasons.length > 0,
    botReasons
  }
})

const positionStats = computed(() => {
  if (traderPositions.value.length === 0) return null

  const totalInvested = traderPositions.value.reduce((sum, p) => sum + p.initialValue, 0)
  const currentValue = traderPositions.value.reduce((sum, p) => sum + p.currentValue, 0)
  const unrealizedPnl = traderPositions.value.reduce((sum, p) => sum + p.cashPnl, 0)
  const wins = traderPositions.value.filter(p => p.cashPnl > 0).length
  const losses = traderPositions.value.filter(p => p.cashPnl < 0).length
  const resolved = traderPositions.value.filter(p => p.redeemable).length

  return {
    totalPositions: traderPositions.value.length,
    totalInvested,
    currentValue,
    unrealizedPnl,
    percentPnl: totalInvested > 0 ? ((currentValue - totalInvested) / totalInvested) * 100 : 0,
    wins,
    losses,
    resolved
  }
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

function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
}

function formatDateShort(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function dateAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
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

async function fetchTraderData(address: string) {
  traderLoading.value = true
  traderActivity.value = []
  traderPositions.value = []
  traderName.value = null
  traderJoinDate.value = null
  traderFirstSeen.value = null

  try {
    const [activityRes, positionsRes] = await Promise.all([
      fetch(`/api/polymarket/activity/${address}?limit=500`).then(r => r.json()),
      fetch(`/api/polymarket/positions/${address}`).then(r => r.json())
    ])

    if (activityRes.success && activityRes.data.length > 0) {
      traderActivity.value = activityRes.data
      const first = activityRes.data[0]
      traderName.value = first.name || first.pseudonym || null

      if (first.name) {
        const timestampMatch = first.name.match(/-(\d{13})$/)
        if (timestampMatch) {
          traderJoinDate.value = new Date(parseInt(timestampMatch[1]))
        }
      }

      const oldestActivity = activityRes.data.reduce((oldest: Activity, a: Activity) =>
        a.timestamp < oldest.timestamp ? a : oldest, activityRes.data[0])
      traderFirstSeen.value = new Date(oldestActivity.timestamp * 1000)
    }

    if (positionsRes.success) {
      traderPositions.value = positionsRes.data
    }
  } catch (e) {
    console.error('Failed to fetch trader data:', e)
  }

  traderLoading.value = false
}

function selectTrade(trade: DbTrade) {
  if (selectedTrade.value?.id === trade.id) {
    selectedTrade.value = null
  } else {
    selectedTrade.value = trade
    fetchTraderData(trade.proxy_wallet)
  }
}

async function fetchTrades(append = false) {
  if (append) {
    loadingMore.value = true
  } else {
    loading.value = true
  }
  error.value = ''

  try {
    const offset = append ? trades.value.length : 0
    const response = await fetch(`/api/trades/large?limit=${PAGE_SIZE}&offset=${offset}`)
    const data = await response.json()

    if (data.success) {
      if (append) {
        trades.value = [...trades.value, ...data.data]
      } else {
        trades.value = data.data
      }
      hasMore.value = data.data.length === PAGE_SIZE
    } else {
      error.value = data.error || 'Failed to fetch trades'
    }
  } catch (e) {
    error.value = 'Failed to fetch trades'
    console.error(e)
  }

  loading.value = false
  loadingMore.value = false
}

function loadMore() {
  if (!loadingMore.value && hasMore.value) {
    fetchTrades(true)
  }
}

onMounted(() => {
  fetchTrades()
})
</script>

<template>
  <PageLayout title="Big Trades">
    <template #subnav>
      <span class="info-text">Trades >= $2,500 from our database</span>
      <span class="subnav-spacer"></span>
      <button @click="fetchTrades(false)" :disabled="loading" class="btn btn-sm">
        {{ loading ? 'Loading...' : 'Refresh' }}
      </button>
    </template>

    <div v-if="loading && trades.length === 0" class="loading">Loading trades...</div>
    <div v-else-if="error" class="error">{{ error }}</div>

    <div v-else class="content-layout">
      <!-- Trades Table -->
      <div class="trades-container">
        <div class="table-header">
          <span class="subtitle">{{ trades.length }} large trades</span>
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
                v-for="trade in sortedTrades"
                :key="trade.id"
                :class="['trade-row', { selected: selectedTrade?.id === trade.id }]"
                @click="selectTrade(trade)"
              >
                <td class="time">{{ timeAgo(trade.timestamp) }}</td>
                <td>
                  <span :class="['side', trade.side.toLowerCase()]">{{ trade.side }}</span>
                </td>
                <td class="size">{{ formatUSD(trade.size) }}</td>
                <td class="price">{{ (trade.price * 100).toFixed(1) }}¢</td>
                <td class="amount">{{ formatUSD(trade.amount) }}</td>
                <td class="title-cell">{{ trade.title }}</td>
                <td class="outcome">{{ trade.outcome }}</td>
              </tr>
            </tbody>
          </table>
          <div v-if="hasMore" class="load-more">
            <button @click="loadMore" :disabled="loadingMore" class="btn">
              {{ loadingMore ? 'Loading...' : 'Load More' }}
            </button>
          </div>
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
              <span class="detail-label">Amount</span>
              <span class="detail-value amount-large">{{ formatUSD(selectedTrade.amount) }}</span>
            </div>

            <div class="detail-row">
              <span class="detail-label">Outcome</span>
              <span class="detail-value">{{ selectedTrade.outcome }}</span>
            </div>

            <div class="detail-section">
              <span class="detail-label">Market</span>
              <p class="market-title">{{ selectedTrade.title }}</p>
              <a :href="getMarketUrl(selectedTrade.event_slug)" target="_blank" class="detail-link">View on Polymarket ↗</a>
            </div>

            <div class="detail-section">
              <span class="detail-label">Trader</span>
              <p class="trader-info-row">
                <span v-if="selectedTrade.name || selectedTrade.pseudonym" class="trader-name">
                  {{ selectedTrade.name || selectedTrade.pseudonym }}
                </span>
                <code class="wallet">{{ shortenWallet(selectedTrade.proxy_wallet) }}</code>
              </p>
              <div class="trader-links">
                <a :href="getWalletUrl(selectedTrade.proxy_wallet)" target="_blank" class="detail-link">Profile ↗</a>
                <router-link
                  :to="{ path: '/trader', query: { address: selectedTrade.proxy_wallet } }"
                  class="detail-link"
                >
                  Full Analysis →
                </router-link>
              </div>
            </div>

            <!-- Trader Analysis -->
            <div class="analysis-section">
              <div v-if="traderLoading" class="analysis-loading">
                Loading trader data...
              </div>

              <template v-else>
                <!-- Trader Info -->
                <div v-if="traderFirstSeen || traderActivity.length > 0" class="analysis-block">
                  <span class="analysis-title">Trader Info</span>
                  <div class="analysis-grid">
                    <div v-if="traderFirstSeen" class="analysis-item">
                      <span class="analysis-value">{{ formatDateShort(traderFirstSeen) }}</span>
                      <span class="analysis-label">First seen</span>
                    </div>
                    <div v-if="traderJoinDate" class="analysis-item">
                      <span class="analysis-value">{{ dateAgo(traderJoinDate) }}</span>
                      <span class="analysis-label">Joined</span>
                    </div>
                    <div v-if="traderActivity.length > 0" class="analysis-item">
                      <span class="analysis-value">{{ traderActivity.length }}</span>
                      <span class="analysis-label">Activities</span>
                    </div>
                  </div>
                </div>

                <!-- Bot Analysis -->
                <div v-if="botAnalysis" class="analysis-block" :class="{ 'is-bot': botAnalysis.likelyBot }">
                  <div class="analysis-header">
                    <span class="analysis-title">{{ botAnalysis.likelyBot ? 'Likely Bot' : 'Trading Stats' }}</span>
                    <span v-if="botAnalysis.likelyBot" class="bot-badge">BOT</span>
                  </div>
                  <div class="analysis-grid">
                    <div class="analysis-item">
                      <span class="analysis-value">{{ botAnalysis.totalTrades }}</span>
                      <span class="analysis-label">Trades</span>
                    </div>
                    <div class="analysis-item">
                      <span class="analysis-value">{{ formatUSD(botAnalysis.totalVolume) }}</span>
                      <span class="analysis-label">Volume</span>
                    </div>
                    <div class="analysis-item">
                      <span class="analysis-value">{{ botAnalysis.tradesPerDay.toFixed(1) }}</span>
                      <span class="analysis-label">Trades/day</span>
                    </div>
                    <div class="analysis-item">
                      <span class="analysis-value">{{ botAnalysis.uniqueMarkets }}</span>
                      <span class="analysis-label">Markets</span>
                    </div>
                    <div class="analysis-item">
                      <span class="analysis-value">{{ botAnalysis.tradingDays }}</span>
                      <span class="analysis-label">Active days</span>
                    </div>
                    <div class="analysis-item">
                      <span class="analysis-value">{{ botAnalysis.mostActiveDay.count }}</span>
                      <span class="analysis-label">Max/day</span>
                    </div>
                  </div>
                  <div v-if="botAnalysis.botReasons.length > 0" class="bot-reasons">
                    <div v-for="reason in botAnalysis.botReasons" :key="reason" class="bot-reason">
                      {{ reason }}
                    </div>
                  </div>
                </div>

                <!-- Position Stats -->
                <div v-if="positionStats" class="analysis-block">
                  <span class="analysis-title">Portfolio</span>
                  <div class="analysis-grid">
                    <div class="analysis-item">
                      <span class="analysis-value">{{ positionStats.totalPositions }}</span>
                      <span class="analysis-label">Positions</span>
                    </div>
                    <div class="analysis-item">
                      <span class="analysis-value">{{ formatUSD(positionStats.totalInvested) }}</span>
                      <span class="analysis-label">Invested</span>
                    </div>
                    <div class="analysis-item">
                      <span class="analysis-value">{{ formatUSD(positionStats.currentValue) }}</span>
                      <span class="analysis-label">Current</span>
                    </div>
                    <div class="analysis-item">
                      <span class="analysis-value" :class="positionStats.unrealizedPnl >= 0 ? 'positive' : 'negative'">
                        {{ formatUSD(positionStats.unrealizedPnl) }}
                      </span>
                      <span class="analysis-label">P&L</span>
                    </div>
                    <div class="analysis-item">
                      <span class="analysis-value" :class="positionStats.percentPnl >= 0 ? 'positive' : 'negative'">
                        {{ formatPercent(positionStats.percentPnl) }}
                      </span>
                      <span class="analysis-label">Return</span>
                    </div>
                    <div class="analysis-item">
                      <span class="analysis-value">
                        <span class="positive">{{ positionStats.wins }}</span>
                        <span class="sep">/</span>
                        <span class="negative">{{ positionStats.losses }}</span>
                      </span>
                      <span class="analysis-label">W/L</span>
                    </div>
                  </div>
                </div>
              </template>
            </div>

            <div class="detail-section">
              <span class="detail-label">Transaction</span>
              <code class="tx-hash">{{ shortenHash(selectedTrade.transaction_hash) }}</code>
              <a :href="getTxUrl(selectedTrade.transaction_hash)" target="_blank" class="detail-link">View on Polygonscan ↗</a>
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
.info-text {
  color: var(--text-muted);
  font-size: var(--font-sm);
}

.subnav-spacer {
  flex: 1;
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

.loading,
.error {
  padding: var(--spacing-xl);
  text-align: center;
}

.error {
  color: var(--accent-red);
}

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

.load-more {
  padding: var(--spacing-md);
  text-align: center;
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

.amount-large {
  font-size: var(--font-base);
  font-weight: 600;
  color: var(--accent-blue);
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

.trader-info-row {
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

.trader-links {
  display: flex;
  gap: var(--spacing-md);
  margin-top: var(--spacing-xs);
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

/* Analysis Section */
.analysis-section {
  border-top: 1px solid var(--border-primary);
  padding-top: var(--spacing-sm);
}

.analysis-loading {
  color: var(--text-muted);
  font-size: var(--font-sm);
  text-align: center;
  padding: var(--spacing-md);
}

.analysis-block {
  background: var(--bg-tertiary);
  border-radius: var(--radius-md);
  padding: var(--spacing-sm);
  margin-bottom: var(--spacing-sm);
}

.analysis-block.is-bot {
  border: 1px solid #e53935;
  background: rgba(229, 57, 53, 0.1);
}

.analysis-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-xs);
}

.analysis-title {
  font-size: var(--font-xs);
  font-weight: 600;
  color: var(--text-primary);
  text-transform: uppercase;
}

.analysis-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--spacing-xs);
}

.analysis-item {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.analysis-value {
  font-size: var(--font-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.analysis-label {
  font-size: var(--font-xs);
  color: var(--text-muted);
}

.bot-badge {
  background: #e53935;
  color: white;
  font-size: var(--font-xs);
  font-weight: 700;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}

.bot-reasons {
  margin-top: var(--spacing-xs);
  padding-top: var(--spacing-xs);
  border-top: 1px solid var(--border-primary);
}

.bot-reason {
  font-size: var(--font-xs);
  color: #e53935;
  margin-bottom: 2px;
}

.positive {
  color: var(--accent-green);
}

.negative {
  color: var(--accent-red);
}

.sep {
  color: var(--text-muted);
}
</style>
