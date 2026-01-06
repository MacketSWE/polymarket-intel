<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import PageLayout from '../components/PageLayout.vue'

interface DbTrade {
  id: string
  transaction_hash: string
  proxy_wallet: string
  condition_id: string
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
  follow_score: number | null
  take_bet: boolean | null
  resolved_status: 'won' | 'lost' | null
}

interface MarketStatus {
  found: boolean
  closed: boolean
  active: boolean
  acceptingOrders: boolean
  resolved: boolean
  winningOutcome: string | null
  endDate: string | null
  question: string | null
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
const PAGE_SIZE = 1000

// Trader analysis state
const traderLoading = ref(false)
const traderActivity = ref<Activity[]>([])
const traderPositions = ref<Position[]>([])
const traderName = ref<string | null>(null)
const traderJoinDate = ref<Date | null>(null)
const traderFirstSeen = ref<Date | null>(null)
const traderClassification = ref<TraderClassification | null>(null)

// Market status state
const marketStatus = ref<MarketStatus | null>(null)
const marketStatusLoading = ref(false)

// Backfill state
const backfillLoading = ref(false)
const backfillResult = ref<{ processed: number; won: number; lost: number; pending: number; errors: number } | null>(null)

// Cleanup state
const cleanupLoading = ref(false)
const cleanupResult = ref<{ checked: number; duplicates: number; cleaned: number } | null>(null)

const winLossStats = computed(() => {
  const won = trades.value.filter(t => t.resolved_status === 'won')
  const lost = trades.value.filter(t => t.resolved_status === 'lost')
  const pending = trades.value.filter(t => t.resolved_status === null)

  const totalResolved = won.length + lost.length
  const winRate = totalResolved > 0 ? (won.length / totalResolved) * 100 : 0

  // Calculate profit: won trades pay out (1/price - 1) * amount, lost trades lose amount
  const wonProfit = won.reduce((sum, t) => sum + (t.size * (1 - t.price)), 0)
  const lostAmount = lost.reduce((sum, t) => sum + (t.size * t.price), 0)
  const netProfit = wonProfit - lostAmount

  return {
    won: won.length,
    lost: lost.length,
    pending: pending.length,
    total: trades.value.length,
    winRate,
    netProfit
  }
})

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

async function fetchMarketStatus(conditionId: string) {
  marketStatusLoading.value = true
  marketStatus.value = null

  try {
    const response = await fetch(`/api/market/status/${conditionId}`)
    const data = await response.json()

    if (data.success) {
      marketStatus.value = data.data
    }
  } catch (e) {
    console.error('Failed to fetch market status:', e)
  }

  marketStatusLoading.value = false
}

function selectTrade(trade: DbTrade) {
  if (selectedTrade.value?.id === trade.id) {
    selectedTrade.value = null
  } else {
    selectedTrade.value = trade
    fetchTraderData(trade.proxy_wallet)
    fetchMarketStatus(trade.condition_id)
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
    const response = await fetch(`/api/trades/take?limit=${PAGE_SIZE}&offset=${offset}`)
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

async function runBackfill() {
  backfillLoading.value = true
  backfillResult.value = null

  try {
    const response = await fetch('/api/trades/backfill-resolved', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 500 })
    })
    const data = await response.json()

    if (data.success) {
      backfillResult.value = data.data
      // Refresh trades to show updated statuses
      await fetchTrades(false)
    }
  } catch (e) {
    console.error('Backfill failed:', e)
  }

  backfillLoading.value = false
}

async function runCleanup() {
  cleanupLoading.value = true
  cleanupResult.value = null

  try {
    const response = await fetch('/api/trades/cleanup-duplicates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
    const data = await response.json()

    if (data.success) {
      cleanupResult.value = data.data
      // Refresh trades to show cleaned list
      await fetchTrades(false)
    }
  } catch (e) {
    console.error('Cleanup failed:', e)
  }

  cleanupLoading.value = false
}

onMounted(() => {
  fetchTrades()
})
</script>

<template>
  <PageLayout title="Take Bets">
    <template #subnav>
      <span class="info-text">High-conviction trades from good traders (follow >= 75, BUY, >= $3k, price <= 65c)</span>
      <span class="subnav-spacer"></span>
      <div v-if="cleanupResult" class="cleanup-result">
        <span class="result-cleaned">-{{ cleanupResult.cleaned }} dupes</span>
      </div>
      <div v-if="backfillResult" class="backfill-result">
        <span class="result-won">{{ backfillResult.won }}W</span>
        <span class="result-lost">{{ backfillResult.lost }}L</span>
        <span class="result-pending">{{ backfillResult.pending }}P</span>
      </div>
      <button @click="runCleanup" :disabled="cleanupLoading" class="btn btn-sm btn-cleanup">
        {{ cleanupLoading ? 'Cleaning...' : 'Dedup' }}
      </button>
      <button @click="runBackfill" :disabled="backfillLoading" class="btn btn-sm btn-backfill">
        {{ backfillLoading ? 'Checking...' : 'Check Resolved' }}
      </button>
      <button @click="fetchTrades(false)" :disabled="loading" class="btn btn-sm">
        {{ loading ? 'Loading...' : 'Refresh' }}
      </button>
    </template>

    <div v-if="loading && trades.length === 0" class="loading">Loading take bets...</div>
    <div v-else-if="error" class="error">{{ error }}</div>

    <div v-else class="content-layout">
      <!-- Trades Table -->
      <div class="trades-container">
        <div class="table-header">
          <span class="subtitle">{{ trades.length }} take bets</span>
          <div class="stats-row">
            <span class="stat-item won">{{ winLossStats.won }}W</span>
            <span class="stat-item lost">{{ winLossStats.lost }}L</span>
            <span class="stat-item pending">{{ winLossStats.pending }}P</span>
            <span class="stat-divider">|</span>
            <span class="stat-item win-rate" :class="{ good: winLossStats.winRate >= 50 }">
              {{ winLossStats.winRate.toFixed(0) }}%
            </span>
            <span class="stat-divider">|</span>
            <span class="stat-item profit" :class="{ positive: winLossStats.netProfit >= 0, negative: winLossStats.netProfit < 0 }">
              {{ winLossStats.netProfit >= 0 ? '+' : '' }}{{ formatUSD(winLossStats.netProfit) }}
            </span>
          </div>
        </div>
        <div class="table-scroll">
          <table class="table">
            <thead>
              <tr>
                <th class="th-sortable" :class="{ sorted: sortKey === 'timestamp' }" @click="toggleSort('timestamp')">
                  <span class="th-content">Time <span class="sort-icon">{{ sortKey === 'timestamp' ? (sortDir === 'asc' ? '↑' : '↓') : '⇅' }}</span></span>
                </th>
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
                <th class="th-static">Status</th>
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
                <td class="size">{{ formatUSD(trade.size) }}</td>
                <td class="price">{{ (trade.price * 100).toFixed(1) }}c</td>
                <td class="amount">{{ formatUSD(trade.amount) }}</td>
                <td class="follow-score">
                  <span class="follow-value high">{{ trade.follow_score }}</span>
                </td>
                <td class="resolved-status">
                  <span v-if="trade.resolved_status === 'won'" class="status-chip won">WON</span>
                  <span v-else-if="trade.resolved_status === 'lost'" class="status-chip lost">LOST</span>
                  <span v-else class="status-chip pending">-</span>
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
            <button class="close-btn" @click="selectedTrade = null">x</button>
          </div>

          <div class="panel-content">
            <div class="detail-row">
              <span class="detail-label">Time</span>
              <span class="detail-value">{{ formatDate(selectedTrade.timestamp) }} UTC</span>
            </div>

            <div class="detail-row">
              <span class="detail-label">Size</span>
              <span class="detail-value size-large">{{ formatUSD(selectedTrade.size) }}</span>
            </div>

            <div class="detail-row">
              <span class="detail-label">Price</span>
              <span class="detail-value">{{ (selectedTrade.price * 100).toFixed(2) }}c</span>
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
              <a :href="getMarketUrl(selectedTrade.event_slug)" target="_blank" class="detail-link">View on Polymarket</a>

              <!-- Market Status -->
              <div class="market-status-section">
                <div v-if="marketStatusLoading" class="status-loading">
                  Checking market status...
                </div>
                <div v-else-if="marketStatus" class="status-result">
                  <div v-if="marketStatus.resolved" class="status-badge resolved" :class="{ won: marketStatus.winningOutcome === selectedTrade.outcome, lost: marketStatus.winningOutcome !== selectedTrade.outcome }">
                    <span class="status-icon">{{ marketStatus.winningOutcome === selectedTrade.outcome ? '✓' : '✗' }}</span>
                    <span class="status-text">
                      {{ marketStatus.winningOutcome === selectedTrade.outcome ? 'WON' : 'LOST' }}
                    </span>
                    <span class="winning-outcome">Winner: {{ marketStatus.winningOutcome }}</span>
                  </div>
                  <div v-else-if="marketStatus.closed && !marketStatus.acceptingOrders" class="status-badge pending">
                    <span class="status-text">PENDING RESOLUTION</span>
                  </div>
                  <div v-else class="status-badge open">
                    <span class="status-text">OPEN</span>
                    <span v-if="marketStatus.acceptingOrders" class="status-detail">Accepting orders</span>
                  </div>
                </div>
              </div>
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
                <a :href="getWalletUrl(selectedTrade.proxy_wallet)" target="_blank" class="detail-link">Profile</a>
                <router-link
                  :to="{ path: '/trader', query: { address: selectedTrade.proxy_wallet } }"
                  class="detail-link"
                >
                  Full Analysis
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
                <div v-if="traderClassification" class="analysis-block follow-block follow-worthy">
                  <div class="follow-header">
                    <span class="analysis-title">Worth Following?</span>
                    <span class="follow-badge yes">YES</span>
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
                    <div v-if="traderClassification.winRate !== null" class="analysis-item">
                      <span class="analysis-value">{{ traderClassification.winRate.toFixed(0) }}%</span>
                      <span class="analysis-label">Win Rate</span>
                    </div>
                    <div class="analysis-item">
                      <span class="analysis-value">{{ traderClassification.marketsTraded }}</span>
                      <span class="analysis-label">Markets</span>
                    </div>
                    <div v-if="traderClassification.accountAgeDays !== null" class="analysis-item">
                      <span class="analysis-value">{{ traderClassification.accountAgeDays }}d</span>
                      <span class="analysis-label">Account Age</span>
                    </div>
                    <div v-if="traderClassification.leaderboardRank" class="analysis-item">
                      <span class="analysis-value">#{{ traderClassification.leaderboardRank }}</span>
                      <span class="analysis-label">Rank</span>
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
              <a :href="getTxUrl(selectedTrade.transaction_hash)" target="_blank" class="detail-link">View on Polygonscan</a>
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

.backfill-result {
  display: flex;
  gap: var(--spacing-sm);
  font-size: var(--font-sm);
  font-weight: 600;
}

.result-won {
  color: #4caf50;
}

.result-lost {
  color: #f44336;
}

.result-pending {
  color: #ffc107;
}

.btn-backfill {
  background: #ff9800;
}

.btn-backfill:hover {
  background: #f57c00;
}

.btn-cleanup {
  background: #9c27b0;
}

.btn-cleanup:hover {
  background: #7b1fa2;
}

.cleanup-result {
  font-size: var(--font-sm);
  font-weight: 600;
}

.result-cleaned {
  color: #9c27b0;
}

.resolved-status {
  width: 60px;
  text-align: center;
}

.status-chip {
  display: inline-block;
  font-size: var(--font-xs);
  font-weight: 700;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
}

.status-chip.won {
  background: rgba(76, 175, 80, 0.2);
  color: #4caf50;
}

.status-chip.lost {
  background: rgba(244, 67, 54, 0.2);
  color: #f44336;
}

.status-chip.pending {
  color: var(--text-muted);
  opacity: 0.5;
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

.stats-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  font-size: var(--font-sm);
  font-weight: 600;
}

.stat-item {
  font-family: monospace;
}

.stat-item.won {
  color: #4caf50;
}

.stat-item.lost {
  color: #f44336;
}

.stat-item.pending {
  color: var(--text-muted);
}

.stat-item.win-rate {
  color: var(--text-muted);
}

.stat-item.win-rate.good {
  color: #4caf50;
}

.stat-item.profit.positive {
  color: #4caf50;
}

.stat-item.profit.negative {
  color: #f44336;
}

.stat-divider {
  color: var(--border-primary);
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

.trade-row {
  cursor: pointer;
  transition: background 0.15s;
  background: rgba(76, 175, 80, 0.05);
}

.trade-row:hover {
  background: rgba(76, 175, 80, 0.12);
}

.trade-row.selected {
  background: rgba(76, 175, 80, 0.18);
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

.market-status-section {
  margin-top: var(--spacing-sm);
}

.status-loading {
  font-size: var(--font-xs);
  color: var(--text-muted);
  font-style: italic;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding: var(--spacing-xs) var(--spacing-sm);
  border-radius: var(--radius-md);
  font-size: var(--font-sm);
  font-weight: 600;
}

.status-badge.resolved.won {
  background: rgba(76, 175, 80, 0.2);
  border: 1px solid #4caf50;
  color: #4caf50;
}

.status-badge.resolved.lost {
  background: rgba(244, 67, 54, 0.2);
  border: 1px solid #f44336;
  color: #f44336;
}

.status-badge.pending {
  background: rgba(255, 193, 7, 0.2);
  border: 1px solid #ffc107;
  color: #ffc107;
}

.status-badge.open {
  background: rgba(33, 150, 243, 0.2);
  border: 1px solid #2196f3;
  color: #2196f3;
}

.status-icon {
  font-size: var(--font-base);
  font-weight: 700;
}

.status-text {
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.winning-outcome {
  font-size: var(--font-xs);
  font-weight: 400;
  opacity: 0.8;
}

.status-detail {
  font-size: var(--font-xs);
  font-weight: 400;
  opacity: 0.8;
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

.positive {
  color: var(--accent-green);
}

.negative {
  color: var(--accent-red);
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

.score-bar.follow {
  background: linear-gradient(90deg, #4caf50, #8bc34a);
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
  content: '- ';
  color: var(--text-muted);
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

.follow-score-row {
  margin-bottom: var(--spacing-xs);
}
</style>
