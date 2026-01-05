<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageLayout from '../components/PageLayout.vue'

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

const route = useRoute()
const router = useRouter()

const loading = ref(false)
const error = ref('')
const addressInput = ref('')
const positions = ref<Position[]>([])
const selectedPosition = ref<Position | null>(null)
const sortKey = ref<string>('size')
const sortDir = ref<'asc' | 'desc'>('desc')
const joinDate = ref<Date | null>(null)
const firstBetDate = ref<Date | null>(null)
const traderName = ref<string | null>(null)
const allActivity = ref<Activity[]>([])

interface BotAnalysis {
  totalTrades: number
  totalVolume: number
  tradesPerDay: number
  avgTimeBetweenTrades: number // seconds
  uniqueMarkets: number
  mostActiveDay: { date: string; count: number }
  tradingDays: number
  likelyBot: boolean
  botReasons: string[]
}

const botAnalysis = computed<BotAnalysis | null>(() => {
  const trades = allActivity.value.filter(a => a.type === 'TRADE')
  if (trades.length < 2) return null

  // Group by day
  const dayMap = new Map<string, Activity[]>()
  for (const trade of trades) {
    const day = new Date(trade.timestamp * 1000).toISOString().split('T')[0]
    if (!dayMap.has(day)) dayMap.set(day, [])
    dayMap.get(day)!.push(trade)
  }

  // Find most active day
  let mostActiveDay = { date: '', count: 0 }
  for (const [date, dayTrades] of dayMap) {
    if (dayTrades.length > mostActiveDay.count) {
      mostActiveDay = { date, count: dayTrades.length }
    }
  }

  // Calculate time between trades
  const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp)
  let totalTimeDiff = 0
  for (let i = 1; i < sortedTrades.length; i++) {
    totalTimeDiff += sortedTrades[i].timestamp - sortedTrades[i - 1].timestamp
  }
  const avgTimeBetweenTrades = sortedTrades.length > 1 ? totalTimeDiff / (sortedTrades.length - 1) : 0

  // Unique markets
  const uniqueMarkets = new Set(trades.map(t => t.title)).size

  // Total volume
  const totalVolume = trades.reduce((sum, t) => sum + t.usdcSize, 0)

  // Trading days span
  const firstTrade = sortedTrades[0]
  const lastTrade = sortedTrades[sortedTrades.length - 1]
  const daySpan = (lastTrade.timestamp - firstTrade.timestamp) / 86400
  const tradesPerDay = daySpan > 0 ? trades.length / daySpan : trades.length

  // Bot detection
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

const sortedPositions = computed(() => {
  const sorted = [...positions.value]
  const dir = sortDir.value === 'asc' ? 1 : -1

  sorted.sort((a, b) => {
    if (sortKey.value === 'size') {
      return (b.size - a.size) * (sortDir.value === 'asc' ? -1 : 1)
    } else if (sortKey.value === 'cashPnl') {
      return (b.cashPnl - a.cashPnl) * (sortDir.value === 'asc' ? -1 : 1)
    } else if (sortKey.value === 'percentPnl') {
      return (b.percentPnl - a.percentPnl) * (sortDir.value === 'asc' ? -1 : 1)
    } else if (sortKey.value === 'title') {
      return a.title.localeCompare(b.title) * dir
    }
    return 0
  })
  return sorted
})

const stats = computed(() => {
  if (positions.value.length === 0) return null

  const totalInvested = positions.value.reduce((sum, p) => sum + p.initialValue, 0)
  const currentValue = positions.value.reduce((sum, p) => sum + p.currentValue, 0)
  const unrealizedPnl = positions.value.reduce((sum, p) => sum + p.cashPnl, 0)
  const wins = positions.value.filter(p => p.cashPnl > 0).length
  const losses = positions.value.filter(p => p.cashPnl < 0).length
  const resolved = positions.value.filter(p => p.redeemable).length

  return {
    totalPositions: positions.value.length,
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
  return `${sign}${value.toFixed(2)}%`
}

function formatPrice(value: number): string {
  return `${(value * 100).toFixed(1)}¢`
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

function selectPosition(position: Position) {
  if (selectedPosition.value?.slug === position.slug) {
    selectedPosition.value = null
  } else {
    selectedPosition.value = position
  }
}

function getMarketUrl(eventSlug: string) {
  return `https://polymarket.com/event/${eventSlug}`
}

async function fetchActivity(address: string): Promise<Activity[]> {
  const res = await fetch(`/api/polymarket/activity/${address}?limit=500`)
  const json = await res.json()
  return json.success ? json.data : []
}

async function lookupTrader() {
  const address = addressInput.value.trim()
  if (!address) return

  // Update URL
  router.push({ query: { address } })

  loading.value = true
  error.value = ''
  positions.value = []
  selectedPosition.value = null
  joinDate.value = null
  firstBetDate.value = null
  traderName.value = null
  allActivity.value = []

  try {
    // Fetch positions and activity in parallel
    const [positionsRes, activityData] = await Promise.all([
      fetch(`/api/polymarket/positions/${address}`).then(r => r.json()),
      fetchActivity(address)
    ])

    // Process positions
    if (positionsRes.success) {
      positions.value = positionsRes.data
    } else {
      error.value = positionsRes.error || 'Failed to fetch positions'
    }

    // Process activity
    allActivity.value = activityData
    if (activityData.length > 0) {
      // Get trader name/pseudonym
      const first = activityData[0]
      traderName.value = first.name || first.pseudonym || null

      // Extract join date from name field (format: 0x...-1766317541188)
      // Only works for wallets without custom usernames
      if (first.name) {
        const timestampMatch = first.name.match(/-(\d{13})$/)
        if (timestampMatch) {
          joinDate.value = new Date(parseInt(timestampMatch[1]))
        }
      }

      // Find oldest activity (first bet / first seen)
      const oldestActivity = activityData.reduce((oldest, a) =>
        a.timestamp < oldest.timestamp ? a : oldest, activityData[0])
      firstBetDate.value = new Date(oldestActivity.timestamp * 1000)
    }
  } catch (e) {
    error.value = 'Failed to fetch trader data'
    console.error(e)
  }

  loading.value = false
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    lookupTrader()
  }
}

// Load from URL on mount
onMounted(() => {
  const address = route.query.address as string
  if (address) {
    addressInput.value = address
    lookupTrader()
  }
})

// Watch for URL changes
watch(() => route.query.address, (newAddress) => {
  if (newAddress && newAddress !== addressInput.value) {
    addressInput.value = newAddress as string
    lookupTrader()
  }
})
</script>

<template>
  <PageLayout title="Trader">
    <template #header-actions>
      <div class="search-bar">
        <input
          v-model="addressInput"
          type="text"
          placeholder="Enter wallet address (0x...)"
          class="address-input"
          @keydown="handleKeydown"
        />
        <button @click="lookupTrader" :disabled="loading" class="btn">
          {{ loading ? 'Loading...' : 'Lookup' }}
        </button>
      </div>
    </template>

    <!-- Trader Info -->
    <div v-if="traderName || joinDate || firstBetDate" class="trader-info">
      <div v-if="traderName" class="info-item">
        <span class="info-label">Name</span>
        <span class="info-value name">{{ traderName }}</span>
      </div>
      <div v-if="joinDate" class="info-item">
        <span class="info-label">Joined</span>
        <span class="info-value">{{ formatDate(joinDate) }}</span>
        <span class="info-sub">({{ timeAgo(joinDate) }})</span>
      </div>
      <div v-if="firstBetDate" class="info-item">
        <span class="info-label">First Seen</span>
        <span class="info-value">{{ formatDate(firstBetDate) }}</span>
        <span class="info-sub">({{ timeAgo(firstBetDate) }})</span>
      </div>
      <div v-if="allActivity.length > 0" class="info-item">
        <span class="info-label">Activity</span>
        <span class="info-value">{{ allActivity.length }} trades</span>
      </div>
    </div>

    <!-- Bot Analysis -->
    <div v-if="botAnalysis" class="bot-analysis" :class="{ 'is-bot': botAnalysis.likelyBot }">
      <div class="bot-header">
        <span class="bot-label">{{ botAnalysis.likelyBot ? 'Likely Bot' : 'Trading Analysis' }}</span>
        <span v-if="botAnalysis.likelyBot" class="bot-badge">BOT</span>
      </div>
      <div class="bot-stats">
        <div class="bot-stat">
          <span class="bot-stat-value">{{ botAnalysis.totalTrades }}</span>
          <span class="bot-stat-label">trades</span>
        </div>
        <div class="bot-stat">
          <span class="bot-stat-value">{{ formatUSD(botAnalysis.totalVolume) }}</span>
          <span class="bot-stat-label">volume</span>
        </div>
        <div class="bot-stat">
          <span class="bot-stat-value">{{ botAnalysis.tradesPerDay.toFixed(1) }}</span>
          <span class="bot-stat-label">trades/day</span>
        </div>
        <div class="bot-stat">
          <span class="bot-stat-value">{{ botAnalysis.uniqueMarkets }}</span>
          <span class="bot-stat-label">markets</span>
        </div>
        <div class="bot-stat">
          <span class="bot-stat-value">{{ botAnalysis.tradingDays }}</span>
          <span class="bot-stat-label">active days</span>
        </div>
        <div class="bot-stat">
          <span class="bot-stat-value">{{ botAnalysis.mostActiveDay.count }}</span>
          <span class="bot-stat-label">max/day</span>
        </div>
      </div>
      <div v-if="botAnalysis.botReasons.length > 0" class="bot-reasons">
        <div v-for="reason in botAnalysis.botReasons" :key="reason" class="bot-reason">
          {{ reason }}
        </div>
      </div>
    </div>

    <!-- Stats Cards -->
    <div v-if="stats" class="stats-grid">
      <div class="stat-card">
        <span class="stat-label">Positions</span>
        <span class="stat-value">{{ stats.totalPositions }}</span>
        <span class="stat-sub">{{ stats.resolved }} resolved</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Total Invested</span>
        <span class="stat-value">{{ formatUSD(stats.totalInvested) }}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Current Value</span>
        <span class="stat-value">{{ formatUSD(stats.currentValue) }}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Unrealized P&L</span>
        <span class="stat-value" :class="stats.unrealizedPnl >= 0 ? 'positive' : 'negative'">
          {{ formatUSD(stats.unrealizedPnl) }}
        </span>
        <span class="stat-sub" :class="stats.percentPnl >= 0 ? 'positive' : 'negative'">
          {{ formatPercent(stats.percentPnl) }}
        </span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Win / Loss</span>
        <span class="stat-value ratio">
          <span class="positive">{{ stats.wins }}</span>
          <span class="sep">/</span>
          <span class="negative">{{ stats.losses }}</span>
        </span>
      </div>
    </div>

    <!-- Loading / Error -->
    <div v-if="loading && positions.length === 0" class="loading">Loading positions...</div>
    <div v-else-if="error" class="error">{{ error }}</div>
    <div v-else-if="!stats && !loading" class="empty-state">
      Enter a wallet address to view trader positions
    </div>

    <!-- Positions Table -->
    <div v-if="positions.length > 0" class="content-layout">
      <div class="positions-container">
        <div class="table-scroll">
          <table class="table">
            <thead>
              <tr>
                <th class="th-sortable" :class="{ sorted: sortKey === 'title' }" @click="toggleSort('title')">
                  <span class="th-content">Market <span class="sort-icon">{{ sortKey === 'title' ? (sortDir === 'asc' ? '↑' : '↓') : '⇅' }}</span></span>
                </th>
                <th class="th-static">Outcome</th>
                <th class="th-sortable" :class="{ sorted: sortKey === 'size' }" @click="toggleSort('size')">
                  <span class="th-content">Size <span class="sort-icon">{{ sortKey === 'size' ? (sortDir === 'asc' ? '↑' : '↓') : '⇅' }}</span></span>
                </th>
                <th class="th-static">Entry</th>
                <th class="th-static">Current</th>
                <th class="th-sortable" :class="{ sorted: sortKey === 'cashPnl' }" @click="toggleSort('cashPnl')">
                  <span class="th-content">P&L <span class="sort-icon">{{ sortKey === 'cashPnl' ? (sortDir === 'asc' ? '↑' : '↓') : '⇅' }}</span></span>
                </th>
                <th class="th-sortable" :class="{ sorted: sortKey === 'percentPnl' }" @click="toggleSort('percentPnl')">
                  <span class="th-content">% <span class="sort-icon">{{ sortKey === 'percentPnl' ? (sortDir === 'asc' ? '↑' : '↓') : '⇅' }}</span></span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="position in sortedPositions"
                :key="position.slug"
                :class="['position-row', { selected: selectedPosition?.slug === position.slug, resolved: position.redeemable }]"
                @click="selectPosition(position)"
              >
                <td class="title-cell">{{ position.title }}</td>
                <td class="outcome">{{ position.outcome }}</td>
                <td class="size">{{ formatUSD(position.size) }}</td>
                <td class="price">{{ formatPrice(position.avgPrice) }}</td>
                <td class="price">{{ formatPrice(position.curPrice) }}</td>
                <td class="pnl" :class="position.cashPnl >= 0 ? 'positive' : 'negative'">
                  {{ formatUSD(position.cashPnl) }}
                </td>
                <td class="pnl-percent" :class="position.percentPnl >= 0 ? 'positive' : 'negative'">
                  {{ formatPercent(position.percentPnl) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Detail Panel -->
      <div class="detail-panel" :class="{ open: selectedPosition }">
        <template v-if="selectedPosition">
          <div class="panel-header">
            <h3 class="panel-title">Position Details</h3>
            <button class="close-btn" @click="selectedPosition = null">×</button>
          </div>

          <div class="panel-content">
            <div class="detail-section">
              <span class="detail-label">Market</span>
              <p class="market-title">{{ selectedPosition.title }}</p>
              <a :href="getMarketUrl(selectedPosition.eventSlug)" target="_blank" class="detail-link">View on Polymarket ↗</a>
            </div>

            <div class="detail-row">
              <span class="detail-label">Outcome</span>
              <span class="detail-value">{{ selectedPosition.outcome }}</span>
            </div>

            <div class="detail-row">
              <span class="detail-label">Status</span>
              <span :class="['status-badge', selectedPosition.redeemable ? 'resolved' : 'active']">
                {{ selectedPosition.redeemable ? 'Resolved' : 'Active' }}
              </span>
            </div>

            <div class="detail-section">
              <span class="detail-label">Position</span>
              <div class="position-details">
                <div class="detail-row">
                  <span>Size</span>
                  <span class="detail-value size-large">{{ formatUSD(selectedPosition.size) }}</span>
                </div>
                <div class="detail-row">
                  <span>Avg Entry</span>
                  <span class="detail-value">{{ formatPrice(selectedPosition.avgPrice) }}</span>
                </div>
                <div class="detail-row">
                  <span>Current Price</span>
                  <span class="detail-value">{{ formatPrice(selectedPosition.curPrice) }}</span>
                </div>
              </div>
            </div>

            <div class="detail-section">
              <span class="detail-label">P&L Breakdown</span>
              <div class="pnl-details">
                <div class="detail-row">
                  <span>Initial Value</span>
                  <span class="detail-value">{{ formatUSD(selectedPosition.initialValue) }}</span>
                </div>
                <div class="detail-row">
                  <span>Current Value</span>
                  <span class="detail-value">{{ formatUSD(selectedPosition.currentValue) }}</span>
                </div>
                <div class="detail-row">
                  <span>Unrealized P&L</span>
                  <span class="detail-value" :class="selectedPosition.cashPnl >= 0 ? 'positive' : 'negative'">
                    {{ formatUSD(selectedPosition.cashPnl) }} ({{ formatPercent(selectedPosition.percentPnl) }})
                  </span>
                </div>
              </div>
            </div>
          </div>
        </template>
        <div v-else class="panel-empty">
          Select a position to view details
        </div>
      </div>
    </div>
  </PageLayout>
</template>

<style scoped>
/* Search Bar */
.search-bar {
  display: flex;
  gap: var(--spacing-sm);
  align-items: center;
}

.address-input {
  width: 360px;
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--bg-tertiary);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: var(--font-sm);
  font-family: monospace;
}

.address-input::placeholder {
  color: var(--text-muted);
}

.address-input:focus {
  outline: none;
  border-color: var(--accent-primary);
}

.btn {
  background: var(--accent-primary);
  color: var(--accent-primary-text);
  border: none;
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: var(--font-sm);
  font-weight: 500;
}

.btn:hover {
  background: var(--accent-primary-hover);
}

.btn:disabled {
  background: #444;
  cursor: not-allowed;
}

/* Trader Info */
.trader-info {
  display: flex;
  gap: var(--spacing-lg);
  margin-bottom: var(--spacing-md);
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-lg);
}

.info-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.info-label {
  font-size: var(--font-sm);
  color: var(--text-muted);
  text-transform: uppercase;
}

.info-value {
  font-size: var(--font-sm);
  color: var(--text-primary);
  font-weight: 500;
}

.info-sub {
  font-size: var(--font-sm);
  color: var(--text-muted);
}

.info-value.name {
  font-weight: 600;
  color: var(--accent-primary);
}

/* Bot Analysis */
.bot-analysis {
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-lg);
  padding: var(--spacing-md);
  margin-bottom: var(--spacing-md);
}

.bot-analysis.is-bot {
  border-color: #e53935;
  background: rgba(229, 57, 53, 0.1);
}

.bot-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-sm);
}

.bot-label {
  font-size: var(--font-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.bot-badge {
  background: #e53935;
  color: white;
  font-size: var(--font-xs);
  font-weight: 700;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}

.bot-stats {
  display: flex;
  gap: var(--spacing-lg);
  flex-wrap: wrap;
}

.bot-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.bot-stat-value {
  font-size: var(--font-base);
  font-weight: 600;
  color: var(--text-primary);
}

.bot-stat-label {
  font-size: var(--font-xs);
  color: var(--text-muted);
  text-transform: uppercase;
}

.bot-reasons {
  margin-top: var(--spacing-sm);
  padding-top: var(--spacing-sm);
  border-top: 1px solid var(--border-primary);
}

.bot-reason {
  font-size: var(--font-sm);
  color: #e53935;
  margin-bottom: 4px;
}

/* Stats Grid */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-lg);
}

.stat-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-lg);
  padding: var(--spacing-md);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.stat-label {
  font-size: var(--font-xs);
  color: var(--text-muted);
  text-transform: uppercase;
}

.stat-value {
  font-size: var(--font-lg);
  font-weight: 600;
  color: var(--text-primary);
}

.stat-value.ratio {
  display: flex;
  gap: 4px;
}

.stat-sub {
  font-size: var(--font-sm);
  color: var(--text-muted);
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

/* Loading/Error/Empty */
.loading,
.error,
.empty-state {
  padding: var(--spacing-xl);
  text-align: center;
  color: var(--text-muted);
}

.error {
  color: var(--accent-red);
}

/* Content Layout */
.content-layout {
  display: flex;
  gap: var(--spacing-md);
  height: calc(100vh - 280px);
}

.positions-container {
  flex: 1;
  min-width: 0;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-xl);
  display: flex;
  flex-direction: column;
  overflow: hidden;
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

.title-cell {
  font-weight: 500;
  color: var(--text-secondary);
  max-width: 250px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.outcome {
  color: var(--text-muted);
  font-size: var(--font-sm);
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.size {
  color: var(--text-primary);
  font-family: monospace;
  font-weight: 600;
}

.price {
  color: var(--text-muted);
  font-family: monospace;
}

.pnl,
.pnl-percent {
  font-family: monospace;
  font-weight: 500;
}

.position-row {
  cursor: pointer;
  transition: background 0.15s;
}

.position-row:hover {
  background: var(--bg-tertiary);
}

.position-row.selected {
  background: var(--bg-active);
}

.position-row.resolved {
  opacity: 0.7;
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
  color: var(--text-primary);
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

.status-badge {
  font-size: var(--font-xs);
  font-weight: 600;
  padding: 0.125rem 0.5rem;
  border-radius: var(--radius-sm);
}

.status-badge.active {
  background: var(--status-open-bg);
  color: var(--status-open-text);
}

.status-badge.resolved {
  background: var(--bg-tertiary);
  color: var(--text-muted);
}

.position-details,
.pnl-details {
  margin-top: var(--spacing-xs);
}

.panel-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: var(--font-sm);
}
</style>
