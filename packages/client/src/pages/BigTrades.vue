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
  // Classification
  good_trader: boolean | null
  follow_score: number | null
  insider_score: number | null
  bot_score: number | null
  whale_score: number | null
  classification: string | null
  take_bet: boolean | null
  // Resolution
  resolved_status: 'won' | 'lost' | null
  end_date: string | null
  last_resolution_check: string | null
  profit_per_dollar: number | null
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

interface TraderClassification {
  type: 'insider' | 'bot' | 'whale' | 'normal'
  confidence: number
  insiderScore: number
  botScore: number
  whaleScore: number
  followScore: number
  followWorthy: boolean
  reasons: string[]
  followReasons: string[]
  profile: {
    createdAt: string | null
    xUsername: string | null
    verifiedBadge: boolean | null
  } | null
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

const loading = ref(true)
const loadingMore = ref(false)
const trades = ref<DbTrade[]>([])
const error = ref('')
const selectedTrade = ref<DbTrade | null>(null)
const sortKey = ref<string>('timestamp')
const sortDir = ref<'asc' | 'desc'>('desc')
const hasMore = ref(true)
const PAGE_SIZE = 500
const activeFilter = ref<'all' | 'take' | 'resolved'>('all')

// Trader analysis state
const traderLoading = ref(false)
const traderActivity = ref<Activity[]>([])
const traderPositions = ref<Position[]>([])
const traderName = ref<string | null>(null)
const traderJoinDate = ref<Date | null>(null)
const traderFirstSeen = ref<Date | null>(null)
const traderClassification = ref<TraderClassification | null>(null)

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
    } else if (sortKey.value === 'follow_score') {
      const aScore = a.follow_score ?? -1
      const bScore = b.follow_score ?? -1
      return (bScore - aScore) * (sortDir.value === 'asc' ? -1 : 1)
    } else if (sortKey.value === 'resolved_status') {
      // Sort order: won > lost > null
      const statusOrder = { won: 2, lost: 1, null: 0 }
      const aOrder = statusOrder[a.resolved_status ?? 'null']
      const bOrder = statusOrder[b.resolved_status ?? 'null']
      return (bOrder - aOrder) * (sortDir.value === 'asc' ? -1 : 1)
    } else if (sortKey.value === 'end_date') {
      const aDate = a.end_date ? new Date(a.end_date).getTime() : Infinity
      const bDate = b.end_date ? new Date(b.end_date).getTime() : Infinity
      return (aDate - bDate) * (sortDir.value === 'asc' ? 1 : -1)
    } else if (sortKey.value === 'profit_per_dollar') {
      const aProfit = a.profit_per_dollar ?? -Infinity
      const bProfit = b.profit_per_dollar ?? -Infinity
      return (bProfit - aProfit) * (sortDir.value === 'asc' ? -1 : 1)
    } else if (sortKey.value === 'title') {
      return a.title.localeCompare(b.title) * dir
    }
    return 0
  })
  return sorted
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

function formatEndDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays < 0) return 'Ended'
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays <= 7) return `${diffDays}d`

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function isEndingSoon(dateStr: string): boolean {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  const diffDays = diffMs / (1000 * 60 * 60 * 24)
  return diffDays >= 0 && diffDays <= 7
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
  traderClassification.value = null

  try {
    const [activityRes, positionsRes, classifyRes] = await Promise.all([
      fetch(`/api/polymarket/activity/${address}?limit=500`).then(r => r.json()),
      fetch(`/api/polymarket/positions/${address}`).then(r => r.json()),
      fetch(`/api/polymarket/classify/${address}`).then(r => r.json())
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

    if (classifyRes.success) {
      traderClassification.value = classifyRes.data
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
    const filterParam = activeFilter.value !== 'all' ? `&filter=${activeFilter.value}` : ''
    const response = await fetch(`/api/trades/large?limit=${PAGE_SIZE}&offset=${offset}${filterParam}`)
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

function setFilter(filter: 'all' | 'take' | 'resolved') {
  if (activeFilter.value !== filter) {
    activeFilter.value = filter
    fetchTrades(false)
  }
}

onMounted(() => {
  fetchTrades()
})
</script>

<template>
  <PageLayout title="Trades">
    <template #subnav>
      <span class="big-badge">BIG</span>
      <div class="filter-group">
        <button
          @click="setFilter('all')"
          :class="['filter-btn', { active: activeFilter === 'all' }]"
          :disabled="loading"
        >All</button>
        <button
          @click="setFilter('take')"
          :class="['filter-btn', { active: activeFilter === 'take' }]"
          :disabled="loading"
        >Takes</button>
        <button
          @click="setFilter('resolved')"
          :class="['filter-btn', { active: activeFilter === 'resolved' }]"
          :disabled="loading"
        >Resolved</button>
      </div>
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
                <th class="th-sortable" :class="{ sorted: sortKey === 'follow_score' }" @click="toggleSort('follow_score')">
                  <span class="th-content">Follow <span class="sort-icon">{{ sortKey === 'follow_score' ? (sortDir === 'asc' ? '↑' : '↓') : '⇅' }}</span></span>
                </th>
                <th class="th-static">Take</th>
                <th class="th-sortable" :class="{ sorted: sortKey === 'resolved_status' }" @click="toggleSort('resolved_status')">
                  <span class="th-content">Result <span class="sort-icon">{{ sortKey === 'resolved_status' ? (sortDir === 'asc' ? '↑' : '↓') : '⇅' }}</span></span>
                </th>
                <th class="th-sortable" :class="{ sorted: sortKey === 'profit_per_dollar' }" @click="toggleSort('profit_per_dollar')">
                  <span class="th-content">P/L <span class="sort-icon">{{ sortKey === 'profit_per_dollar' ? (sortDir === 'asc' ? '↑' : '↓') : '⇅' }}</span></span>
                </th>
                <th class="th-sortable" :class="{ sorted: sortKey === 'end_date' }" @click="toggleSort('end_date')">
                  <span class="th-content">Ends <span class="sort-icon">{{ sortKey === 'end_date' ? (sortDir === 'asc' ? '↑' : '↓') : '⇅' }}</span></span>
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
                :class="['trade-row', { selected: selectedTrade?.id === trade.id, 'take-bet': trade.take_bet }]"
                @click="selectTrade(trade)"
              >
                <td class="time">{{ timeAgo(trade.timestamp) }}</td>
                <td>
                  <span :class="['side', trade.side.toLowerCase()]">{{ trade.side }}</span>
                </td>
                <td class="size">{{ formatUSD(trade.size) }}</td>
                <td class="price">{{ (trade.price * 100).toFixed(1) }}¢</td>
                <td class="amount">{{ formatUSD(trade.amount) }}</td>
                <td class="follow-score">
                  <span v-if="trade.follow_score !== null" :class="['follow-value', { high: trade.follow_score >= 75, medium: trade.follow_score >= 50 && trade.follow_score < 75 }]">
                    {{ trade.follow_score }}
                  </span>
                  <span v-else class="no-data">-</span>
                </td>
                <td class="take-cell">
                  <span v-if="trade.take_bet" class="take-badge">TAKE</span>
                </td>
                <td class="result-cell">
                  <span v-if="trade.resolved_status === 'won'" class="result-badge won">WON</span>
                  <span v-else-if="trade.resolved_status === 'lost'" class="result-badge lost">LOST</span>
                  <span v-else class="no-data">-</span>
                </td>
                <td class="pnl-cell">
                  <span v-if="trade.profit_per_dollar !== null" :class="['pnl-value', trade.profit_per_dollar >= 0 ? 'positive' : 'negative']">
                    {{ trade.profit_per_dollar >= 0 ? '+' : '' }}${{ trade.profit_per_dollar.toFixed(2) }}
                  </span>
                  <span v-else class="no-data">-</span>
                </td>
                <td class="end-date">
                  <span v-if="trade.end_date" :class="{ 'ending-soon': isEndingSoon(trade.end_date) }">{{ formatEndDate(trade.end_date) }}</span>
                  <span v-else class="no-data">-</span>
                </td>
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

            <div class="detail-row">
              <span class="detail-label">Result</span>
              <span v-if="selectedTrade.resolved_status === 'won'" class="result-badge won">WON</span>
              <span v-else-if="selectedTrade.resolved_status === 'lost'" class="result-badge lost">LOST</span>
              <span v-else class="detail-value">Pending</span>
            </div>

            <div class="detail-row" v-if="selectedTrade.end_date">
              <span class="detail-label">Ends</span>
              <span class="detail-value" :class="{ 'ending-soon': isEndingSoon(selectedTrade.end_date) }">
                {{ new Date(selectedTrade.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }}
              </span>
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

              <!-- Classification Badge -->
              <div v-if="traderClassification" class="classification-banner" :class="traderClassification.type">
                <span class="classification-badge" :class="traderClassification.type">
                  {{ traderClassification.type === 'normal' ? 'NORMAL USER' : traderClassification.type.toUpperCase() }}
                </span>
                <span v-if="traderClassification.type !== 'normal'" class="classification-confidence">{{ traderClassification.confidence }}% confidence</span>
              </div>

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
                <!-- Follow Score -->
                <div v-if="traderClassification" class="analysis-block follow-block" :class="{ 'follow-worthy': traderClassification.followWorthy }">
                  <div class="follow-header">
                    <span class="analysis-title">Worth Following?</span>
                    <span class="follow-badge" :class="traderClassification.followWorthy ? 'yes' : 'no'">
                      {{ traderClassification.followWorthy ? 'YES' : 'NO' }}
                    </span>
                  </div>
                  <div class="score-row follow-score-row">
                    <span class="score-label">Score</span>
                    <div class="score-bar-container">
                      <div class="score-bar follow" :style="{ width: traderClassification.followScore + '%' }"></div>
                    </div>
                    <span class="score-value">{{ traderClassification.followScore }}</span>
                  </div>
                  <div v-if="traderClassification.followReasons.length > 0" class="classification-reasons">
                    <div v-for="reason in traderClassification.followReasons" :key="reason" class="reason-item">
                      {{ reason }}
                    </div>
                  </div>
                </div>

                <!-- Classification Scores -->
                <div v-if="traderClassification" class="analysis-block classification-block">
                  <span class="analysis-title">Classification Scores</span>
                  <div class="score-bars">
                    <div class="score-row">
                      <span class="score-label">Insider</span>
                      <div class="score-bar-container">
                        <div class="score-bar insider" :style="{ width: traderClassification.insiderScore + '%' }"></div>
                      </div>
                      <span class="score-value">{{ traderClassification.insiderScore }}</span>
                    </div>
                    <div class="score-row">
                      <span class="score-label">Bot</span>
                      <div class="score-bar-container">
                        <div class="score-bar bot" :style="{ width: traderClassification.botScore + '%' }"></div>
                      </div>
                      <span class="score-value">{{ traderClassification.botScore }}</span>
                    </div>
                    <div class="score-row">
                      <span class="score-label">Whale</span>
                      <div class="score-bar-container">
                        <div class="score-bar whale" :style="{ width: traderClassification.whaleScore + '%' }"></div>
                      </div>
                      <span class="score-value">{{ traderClassification.whaleScore }}</span>
                    </div>
                  </div>
                  <div v-if="traderClassification.reasons.length > 0" class="classification-reasons">
                    <div v-for="reason in traderClassification.reasons" :key="reason" class="reason-item">
                      {{ reason }}
                    </div>
                  </div>
                </div>

                <!-- Trader Stats from Classification -->
                <div v-if="traderClassification" class="analysis-block">
                  <span class="analysis-title">Trader Stats</span>
                  <div class="analysis-grid">
                    <div class="analysis-item">
                      <span class="analysis-value">{{ formatUSD(traderClassification.totalVolume) }}</span>
                      <span class="analysis-label">Volume</span>
                    </div>
                    <div class="analysis-item">
                      <span class="analysis-value" :class="traderClassification.realizedPnl >= 0 ? 'positive' : 'negative'">
                        {{ formatUSD(traderClassification.realizedPnl) }}
                      </span>
                      <span class="analysis-label">Realized</span>
                    </div>
                    <div class="analysis-item">
                      <span class="analysis-value" :class="traderClassification.unrealizedPnl >= 0 ? 'positive' : 'negative'">
                        {{ formatUSD(traderClassification.unrealizedPnl) }}
                      </span>
                      <span class="analysis-label">Unrealized</span>
                    </div>
                    <div class="analysis-item">
                      <span class="analysis-value">{{ traderClassification.marketsTraded }}</span>
                      <span class="analysis-label">Markets</span>
                    </div>
                    <div class="analysis-item">
                      <span class="analysis-value">{{ formatUSD(traderClassification.avgTradeSize) }}</span>
                      <span class="analysis-label">Avg Trade</span>
                    </div>
                    <div class="analysis-item">
                      <span class="analysis-value">{{ traderClassification.tradesPerDay.toFixed(1) }}</span>
                      <span class="analysis-label">Trades/day</span>
                    </div>
                    <div v-if="traderClassification.winRate !== null" class="analysis-item">
                      <span class="analysis-value">{{ traderClassification.winRate.toFixed(0) }}%</span>
                      <span class="analysis-label">Resolved W/R</span>
                    </div>
                    <div v-if="traderClassification.accountAgeDays !== null" class="analysis-item">
                      <span class="analysis-value">{{ traderClassification.accountAgeDays }}d</span>
                      <span class="analysis-label">Account Age</span>
                    </div>
                    <div v-if="traderClassification.leaderboardRank" class="analysis-item">
                      <span class="analysis-value">#{{ traderClassification.leaderboardRank }}</span>
                      <span class="analysis-label">Rank</span>
                    </div>
                    <div v-if="traderClassification.profile?.verifiedBadge" class="analysis-item">
                      <span class="analysis-value verified">Verified</span>
                      <span class="analysis-label">Status</span>
                    </div>
                  </div>
                </div>

                <!-- Position Stats -->
                <div v-if="positionStats" class="analysis-block">
                  <span class="analysis-title">Current Positions</span>
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
                      <span class="analysis-label">Unrealized</span>
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
.big-badge {
  background: linear-gradient(135deg, #ff6b35, #f7931a);
  color: white;
  font-size: var(--font-xs);
  font-weight: 700;
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  letter-spacing: 1px;
}

.filter-group {
  display: flex;
  gap: 2px;
  background: var(--bg-tertiary);
  padding: 2px;
  border-radius: var(--radius-md);
}

.filter-btn {
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-size: var(--font-sm);
  font-weight: 500;
  padding: 4px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s;
}

.filter-btn:hover:not(:disabled) {
  color: var(--text-primary);
  background: var(--bg-secondary);
}

.filter-btn.active {
  background: var(--accent-primary);
  color: var(--accent-primary-text);
}

.filter-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

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

.follow-score {
  width: 60px;
  text-align: center;
}

.follow-value {
  font-family: monospace;
  font-weight: 600;
  font-size: var(--font-sm);
  color: var(--text-muted);
}

.follow-value.high {
  color: #4caf50;
}

.follow-value.medium {
  color: #ffc107;
}

.no-data {
  color: var(--text-muted);
  opacity: 0.5;
}

.take-cell {
  width: 60px;
  text-align: center;
}

.take-badge {
  background: linear-gradient(135deg, #4caf50, #2e7d32);
  color: white;
  font-size: var(--font-xs);
  font-weight: 700;
  padding: 3px 8px;
  border-radius: var(--radius-sm);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.result-cell {
  width: 60px;
  text-align: center;
}

.result-badge {
  font-size: var(--font-xs);
  font-weight: 700;
  padding: 3px 8px;
  border-radius: var(--radius-sm);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.result-badge.won {
  background: linear-gradient(135deg, #4caf50, #2e7d32);
  color: white;
}

.result-badge.lost {
  background: linear-gradient(135deg, #e53935, #c62828);
  color: white;
}

.pnl-cell {
  width: 70px;
  text-align: right;
}

.pnl-value {
  font-family: monospace;
  font-size: var(--font-sm);
  font-weight: 600;
}

.pnl-value.positive {
  color: var(--accent-green);
}

.pnl-value.negative {
  color: var(--accent-red);
}

.end-date {
  color: var(--text-muted);
  font-size: var(--font-sm);
  white-space: nowrap;
  width: 80px;
}

.ending-soon {
  color: #ff9800 !important;
  font-weight: 600;
}

.trade-row.take-bet {
  background: rgba(76, 175, 80, 0.08);
}

.trade-row.take-bet:hover {
  background: rgba(76, 175, 80, 0.15);
}

.trade-row.take-bet.selected {
  background: rgba(76, 175, 80, 0.2);
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

/* Classification Styles */
.classification-banner {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm);
  border-radius: var(--radius-md);
  margin: var(--spacing-sm) 0;
}

.classification-banner.insider {
  background: rgba(255, 152, 0, 0.15);
  border: 1px solid #ff9800;
}

.classification-banner.bot {
  background: rgba(229, 57, 53, 0.15);
  border: 1px solid #e53935;
}

.classification-banner.whale {
  background: rgba(33, 150, 243, 0.15);
  border: 1px solid #2196f3;
}

.classification-banner.normal {
  background: rgba(158, 158, 158, 0.15);
  border: 1px solid #9e9e9e;
}

.classification-badge {
  font-size: var(--font-xs);
  font-weight: 700;
  padding: 3px 8px;
  border-radius: var(--radius-sm);
  color: white;
}

.classification-badge.insider {
  background: #ff9800;
}

.classification-badge.bot {
  background: #e53935;
}

.classification-badge.whale {
  background: #2196f3;
}

.classification-badge.normal {
  background: #9e9e9e;
}

.classification-confidence {
  font-size: var(--font-xs);
  color: var(--text-muted);
}

.classification-block {
  border: 1px solid var(--border-primary);
}

.score-bars {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: var(--spacing-xs);
}

.score-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.score-label {
  font-size: var(--font-xs);
  color: var(--text-muted);
  width: 50px;
  flex-shrink: 0;
}

.score-bar-container {
  flex: 1;
  height: 8px;
  background: var(--bg-tertiary);
  border-radius: 4px;
  overflow: hidden;
}

.score-bar {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease;
}

.score-bar.insider {
  background: linear-gradient(90deg, #ff9800, #ffc107);
}

.score-bar.bot {
  background: linear-gradient(90deg, #e53935, #f44336);
}

.score-bar.whale {
  background: linear-gradient(90deg, #2196f3, #03a9f4);
}

.score-value {
  font-size: var(--font-xs);
  font-weight: 600;
  color: var(--text-secondary);
  width: 24px;
  text-align: right;
}

.classification-reasons {
  margin-top: var(--spacing-sm);
  padding-top: var(--spacing-sm);
  border-top: 1px solid var(--border-primary);
}

.reason-item {
  font-size: var(--font-xs);
  color: var(--text-muted);
  padding: 2px 0;
}

.reason-item::before {
  content: '• ';
  color: var(--text-muted);
}

.verified {
  color: #2196f3;
}

/* Follow Score Styles */
.follow-block {
  border: 1px solid var(--border-primary);
}

.follow-block.follow-worthy {
  border-color: #4caf50;
  background: rgba(76, 175, 80, 0.1);
}

.follow-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-xs);
}

.follow-badge {
  font-size: var(--font-xs);
  font-weight: 700;
  padding: 3px 10px;
  border-radius: var(--radius-sm);
  color: white;
}

.follow-badge.yes {
  background: #4caf50;
}

.follow-badge.no {
  background: #757575;
}

.follow-score-row {
  margin-bottom: var(--spacing-xs);
}

.score-bar.follow {
  background: linear-gradient(90deg, #4caf50, #8bc34a);
}
</style>
