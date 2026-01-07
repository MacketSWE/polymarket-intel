<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import PageLayout from '../components/PageLayout.vue'

interface Trader {
  rank: string
  proxyWallet: string
  userName: string
  vol: number
  pnl: number
  profileImage: string
  xUsername: string
  verifiedBadge: boolean
}

interface Trade {
  transactionHash: string
  proxyWallet: string
  side: 'BUY' | 'SELL'
  size: number
  price: number
  timestamp: number
  title: string
  slug: string
  eventSlug: string
  outcome: string
  icon: string
  name: string
  pseudonym: string
  profileImage: string
}

type TimePeriod = 'DAY' | 'WEEK' | 'MONTH' | 'ALL'
type OrderBy = 'PNL' | 'VOL'
type ViewMode = 'standard' | 'topPV'

interface TopPVTrader extends Trader {
  pv: number
  source: '7d' | '30d' | 'both'
}

const loading = ref(true)
const traders = ref<Trader[]>([])
const topPVTraders = ref<TopPVTrader[]>([])
const error = ref('')
const timePeriod = ref<TimePeriod>('WEEK')
const orderBy = ref<OrderBy>('PNL')
const viewMode = ref<ViewMode>('standard')

const selectedTrader = ref<Trader | null>(null)
const traderTrades = ref<Trade[]>([])
const tradesLoading = ref(false)

// Combined trades from all Top P/V traders
const allTopPVTrades = ref<Trade[]>([])
const allTradesLoading = ref(false)
const allTradesProgress = ref({ loaded: 0, total: 0 })

interface GroupedTrade {
  key: string
  proxyWallet: string
  traderName: string
  traderImage: string
  side: 'BUY' | 'SELL'
  title: string
  slug: string
  eventSlug: string
  outcome: string
  icon: string
  totalSize: number
  totalValue: number
  avgPrice: number
  tradeCount: number
  latestTimestamp: number
}

function groupTrades(trades: Trade[], includeTrader = false): GroupedTrade[] {
  const groups = new Map<string, GroupedTrade>()

  for (const trade of trades) {
    // Include proxyWallet in key when grouping across multiple traders
    const key = includeTrader
      ? `${trade.proxyWallet}-${trade.slug}-${trade.side}-${trade.outcome}`
      : `${trade.slug}-${trade.side}-${trade.outcome}`

    if (groups.has(key)) {
      const group = groups.get(key)!
      group.totalSize += trade.size
      group.totalValue += trade.size * trade.price
      group.tradeCount += 1
      if (trade.timestamp > group.latestTimestamp) {
        group.latestTimestamp = trade.timestamp
      }
    } else {
      groups.set(key, {
        key,
        proxyWallet: trade.proxyWallet,
        traderName: trade.name || trade.pseudonym || '',
        traderImage: trade.profileImage || '',
        side: trade.side,
        title: trade.title,
        slug: trade.slug,
        eventSlug: trade.eventSlug,
        outcome: trade.outcome,
        icon: trade.icon,
        totalSize: trade.size,
        totalValue: trade.size * trade.price,
        avgPrice: trade.price,
        tradeCount: 1,
        latestTimestamp: trade.timestamp
      })
    }
  }

  // Calculate average price and sort by latest timestamp
  const result = Array.from(groups.values())
  for (const group of result) {
    group.avgPrice = group.totalValue / group.totalSize
  }
  result.sort((a, b) => b.latestTimestamp - a.latestTimestamp)

  return result
}

const groupedTrades = computed(() => groupTrades(traderTrades.value))
const groupedAllTrades = computed(() => groupTrades(allTopPVTrades.value, true))

// Batched fetch with rate limiting - 5 concurrent requests, 200ms between batches
async function fetchTradesForWallets(wallets: string[], limit = 100): Promise<Trade[]> {
  const BATCH_SIZE = 5
  const DELAY_MS = 200
  const allTrades: Trade[] = []

  allTradesProgress.value = { loaded: 0, total: wallets.length }

  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batch = wallets.slice(i, i + BATCH_SIZE)

    const batchResults = await Promise.all(
      batch.map(wallet =>
        fetch(`/api/polymarket/user/${wallet}/trades?limit=${limit}`)
          .then(r => r.json())
          .then(d => (d.data || []) as Trade[])
          .catch(() => [] as Trade[])
      )
    )

    for (const trades of batchResults) {
      allTrades.push(...trades)
    }

    allTradesProgress.value.loaded = Math.min(i + BATCH_SIZE, wallets.length)

    // Delay between batches (except for last batch)
    if (i + BATCH_SIZE < wallets.length) {
      await new Promise(resolve => setTimeout(resolve, DELAY_MS))
    }
  }

  return allTrades
}

const periodLabels: Record<TimePeriod, string> = {
  DAY: '24h',
  WEEK: '7d',
  MONTH: '30d',
  ALL: 'All Time'
}

function formatUSD(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 1 }).format(value / 1_000_000) + 'M'
  }
  if (Math.abs(value) >= 1_000) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value / 1_000) + 'K'
  }
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp * 1000)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function truncateWallet(wallet: string): string {
  return wallet.slice(0, 6) + '...' + wallet.slice(-4)
}

function getPolymarketProfileUrl(wallet: string): string {
  return `https://polymarket.com/profile/${wallet}`
}

function getMarketUrl(eventSlug: string, slug: string): string {
  return `https://polymarket.com/event/${eventSlug}/${slug}`
}

async function fetchLeaderboard() {
  loading.value = true
  error.value = ''

  try {
    const params = new URLSearchParams({
      timePeriod: timePeriod.value,
      orderBy: orderBy.value,
      limit: '50'
    })

    const response = await fetch(`/api/polymarket/leaderboard?${params}`)
    const data = await response.json()

    if (data.success) {
      traders.value = data.data
    } else {
      error.value = data.error || 'Failed to fetch leaderboard'
    }
  } catch (e) {
    error.value = 'Failed to fetch leaderboard'
    console.error(e)
  }

  loading.value = false
}

async function fetchTopPVTraders() {
  loading.value = true
  error.value = ''

  try {
    // Fetch both 7d and 30d leaderboards in parallel
    const [weekRes, monthRes] = await Promise.all([
      fetch('/api/polymarket/leaderboard?timePeriod=WEEK&orderBy=PNL&limit=50'),
      fetch('/api/polymarket/leaderboard?timePeriod=MONTH&orderBy=PNL&limit=50')
    ])

    const [weekData, monthData] = await Promise.all([weekRes.json(), monthRes.json()])

    if (!weekData.success || !monthData.success) {
      error.value = 'Failed to fetch leaderboard data'
      loading.value = false
      return
    }

    // Calculate P/V and get top 15 from each period
    const calcPV = (t: Trader) => t.vol > 0 ? t.pnl / t.vol : 0

    const weekTraders: TopPVTrader[] = (weekData.data as Trader[])
      .filter(t => t.vol > 0 && t.pnl > 0)
      .map(t => ({ ...t, pv: calcPV(t), source: '7d' as const }))
      .sort((a, b) => b.pv - a.pv)
      .slice(0, 15)

    const monthTraders: TopPVTrader[] = (monthData.data as Trader[])
      .filter(t => t.vol > 0 && t.pnl > 0)
      .map(t => ({ ...t, pv: calcPV(t), source: '30d' as const }))
      .sort((a, b) => b.pv - a.pv)
      .slice(0, 15)

    // Combine and deduplicate - keep the one with higher P/V, mark as 'both' if in both
    const combined = new Map<string, TopPVTrader>()

    for (const t of weekTraders) {
      combined.set(t.proxyWallet, t)
    }

    for (const t of monthTraders) {
      if (combined.has(t.proxyWallet)) {
        const existing = combined.get(t.proxyWallet)!
        existing.source = 'both'
        // Keep the higher P/V
        if (t.pv > existing.pv) {
          combined.set(t.proxyWallet, { ...t, source: 'both' })
        }
      } else {
        combined.set(t.proxyWallet, t)
      }
    }

    // Sort by P/V descending
    topPVTraders.value = Array.from(combined.values()).sort((a, b) => b.pv - a.pv)

    // Fetch trades for all Top P/V traders (with rate limiting)
    loading.value = false
    allTradesLoading.value = true
    allTopPVTrades.value = []

    const wallets = topPVTraders.value.map(t => t.proxyWallet)
    allTopPVTrades.value = await fetchTradesForWallets(wallets, 100)

    allTradesLoading.value = false
  } catch (e) {
    error.value = 'Failed to fetch leaderboard'
    console.error(e)
    loading.value = false
    allTradesLoading.value = false
  }
}

async function fetchTraderTrades(wallet: string) {
  tradesLoading.value = true
  traderTrades.value = []

  try {
    const response = await fetch(`/api/polymarket/user/${wallet}/trades?limit=500`)
    const data = await response.json()

    if (data.success) {
      traderTrades.value = data.data
    }
  } catch (e) {
    console.error('Failed to fetch trades:', e)
  }

  tradesLoading.value = false
}

function selectTrader(trader: Trader) {
  if (selectedTrader.value?.proxyWallet === trader.proxyWallet) {
    selectedTrader.value = null
    traderTrades.value = []
  } else {
    selectedTrader.value = trader
    fetchTraderTrades(trader.proxyWallet)
  }
}

function setPeriod(period: TimePeriod) {
  timePeriod.value = period
}

function setOrderBy(order: OrderBy) {
  orderBy.value = order
}

function setViewMode(mode: ViewMode) {
  viewMode.value = mode
  if (mode === 'topPV') {
    fetchTopPVTraders()
  } else {
    fetchLeaderboard()
  }
}

watch([timePeriod, orderBy], () => {
  if (viewMode.value === 'standard') {
    fetchLeaderboard()
  }
})

onMounted(() => {
  fetchLeaderboard()
})
</script>

<template>
  <PageLayout title="Leaderboard">
    <template #subnav>
      <button
        @click="setViewMode('standard')"
        :class="['subnav-btn', { active: viewMode === 'standard' }]"
      >
        Standard
      </button>
      <button
        @click="setViewMode('topPV')"
        :class="['subnav-btn', { active: viewMode === 'topPV' }]"
      >
        Top P/V
      </button>
      <span class="subnav-divider"></span>
      <template v-if="viewMode === 'standard'">
        <button
          v-for="period in (['DAY', 'WEEK', 'MONTH', 'ALL'] as TimePeriod[])"
          :key="period"
          @click="setPeriod(period)"
          :class="['subnav-btn', { active: timePeriod === period }]"
        >
          {{ periodLabels[period] }}
        </button>
        <span class="subnav-spacer"></span>
        <button
          @click="setOrderBy('PNL')"
          :class="['subnav-btn', { active: orderBy === 'PNL' }]"
        >
          By Profit
        </button>
        <button
          @click="setOrderBy('VOL')"
          :class="['subnav-btn', { active: orderBy === 'VOL' }]"
        >
          By Volume
        </button>
        <button @click="fetchLeaderboard" :disabled="loading" class="btn btn-sm">
          {{ loading ? 'Loading...' : 'Refresh' }}
        </button>
      </template>
      <template v-else>
        <span class="subnav-spacer"></span>
        <button @click="fetchTopPVTraders" :disabled="loading" class="btn btn-sm">
          {{ loading ? 'Loading...' : 'Refresh' }}
        </button>
      </template>
    </template>

    <div v-if="loading" class="loading">Loading leaderboard...</div>
    <div v-else-if="error" class="error">{{ error }}</div>

    <div v-else class="content-layout">
      <!-- Standard Leaderboard Table -->
      <div v-if="viewMode === 'standard'" class="leaderboard-container">
        <div class="table-header">
          <span class="subtitle">Top {{ traders.length }} traders by {{ orderBy === 'PNL' ? 'profit' : 'volume' }} ({{ periodLabels[timePeriod] }})</span>
        </div>
        <div class="table-scroll">
          <table class="table">
            <thead>
              <tr>
                <th class="th-static">#</th>
                <th>Trader</th>
                <th class="th-right">Profit</th>
                <th class="th-right">Volume</th>
                <th class="th-right">P/V</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="trader in traders"
                :key="trader.proxyWallet"
                :class="['trader-row', { selected: selectedTrader?.proxyWallet === trader.proxyWallet }]"
                @click="selectTrader(trader)"
              >
                <td class="row-num">{{ trader.rank }}</td>
                <td class="trader-cell">
                  <div class="trader-info">
                    <img
                      v-if="trader.profileImage"
                      :src="trader.profileImage"
                      class="avatar"
                      alt=""
                    />
                    <div v-else class="avatar-placeholder"></div>
                    <div class="trader-details">
                      <span class="trader-name-text">
                        {{ trader.userName || truncateWallet(trader.proxyWallet) }}
                        <span v-if="trader.verifiedBadge" class="verified">✓</span>
                      </span>
                      <span v-if="trader.xUsername" class="twitter">@{{ trader.xUsername }}</span>
                    </div>
                  </div>
                </td>
                <td :class="['pnl', trader.pnl >= 0 ? 'positive' : 'negative']">
                  {{ trader.pnl >= 0 ? '+' : '' }}{{ formatUSD(trader.pnl) }}
                </td>
                <td class="volume">{{ formatUSD(trader.vol) }}</td>
                <td :class="['pv', trader.pnl >= 0 ? 'positive' : 'negative']">
                  {{ trader.vol > 0 ? ((trader.pnl / trader.vol) * 100).toFixed(1) + '%' : '-' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Top P/V Leaderboard Table -->
      <div v-else class="leaderboard-container">
        <div class="table-header">
          <span class="subtitle">Top {{ topPVTraders.length }} traders by P/V (7d + 30d combined)</span>
        </div>
        <div class="table-scroll">
          <table class="table">
            <thead>
              <tr>
                <th class="th-static">#</th>
                <th>Trader</th>
                <th class="th-right">P/V</th>
                <th class="th-right">Profit</th>
                <th class="th-right">Volume</th>
                <th class="th-static">Source</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(trader, index) in topPVTraders"
                :key="trader.proxyWallet"
                :class="['trader-row', { selected: selectedTrader?.proxyWallet === trader.proxyWallet }]"
                @click="selectTrader(trader)"
              >
                <td class="row-num">{{ index + 1 }}</td>
                <td class="trader-cell">
                  <div class="trader-info">
                    <img
                      v-if="trader.profileImage"
                      :src="trader.profileImage"
                      class="avatar"
                      alt=""
                    />
                    <div v-else class="avatar-placeholder"></div>
                    <div class="trader-details">
                      <span class="trader-name-text">
                        {{ trader.userName || truncateWallet(trader.proxyWallet) }}
                        <span v-if="trader.verifiedBadge" class="verified">✓</span>
                      </span>
                      <span v-if="trader.xUsername" class="twitter">@{{ trader.xUsername }}</span>
                    </div>
                  </div>
                </td>
                <td class="pv positive">{{ (trader.pv * 100).toFixed(1) }}%</td>
                <td class="pnl positive">+{{ formatUSD(trader.pnl) }}</td>
                <td class="volume">{{ formatUSD(trader.vol) }}</td>
                <td class="source-cell">
                  <span :class="['source-badge', trader.source]">{{ trader.source }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Detail Panel - Standard View (single trader) -->
      <div v-if="viewMode === 'standard'" class="detail-panel" :class="{ open: selectedTrader }">
        <template v-if="selectedTrader">
          <div class="panel-header">
            <div class="panel-trader-info">
              <img
                v-if="selectedTrader.profileImage"
                :src="selectedTrader.profileImage"
                class="panel-avatar"
                alt=""
              />
              <div v-else class="panel-avatar-placeholder"></div>
              <div>
                <h3 class="panel-title">{{ selectedTrader.userName || truncateWallet(selectedTrader.proxyWallet) }}</h3>
                <span v-if="selectedTrader.xUsername" class="panel-twitter">@{{ selectedTrader.xUsername }}</span>
              </div>
            </div>
            <a :href="getPolymarketProfileUrl(selectedTrader.proxyWallet)" target="_blank" class="external-link">↗</a>
            <button class="close-btn" @click="selectedTrader = null">×</button>
          </div>

          <div class="panel-meta">
            <span :class="['meta-pnl', selectedTrader.pnl >= 0 ? 'positive' : 'negative']">
              {{ selectedTrader.pnl >= 0 ? '+' : '' }}{{ formatUSD(selectedTrader.pnl) }} profit
            </span>
            <span class="meta-item">{{ formatUSD(selectedTrader.vol) }} volume</span>
          </div>

          <div class="panel-section">
            <h4 class="section-title">Positions ({{ groupedTrades.length }})</h4>
            <div v-if="tradesLoading" class="trades-loading">Loading trades...</div>
            <div v-else-if="groupedTrades.length === 0" class="trades-empty">No recent trades</div>
            <div v-else class="trades-list">
              <div v-for="trade in groupedTrades" :key="trade.key" class="trade-item">
                <div class="trade-main">
                  <span :class="['trade-side', trade.side.toLowerCase()]">{{ trade.side }}</span>
                  <span class="trade-outcome">{{ trade.outcome }}</span>
                  <span v-if="trade.tradeCount > 1" class="trade-count">×{{ trade.tradeCount }}</span>
                </div>
                <div class="trade-details">
                  <a :href="getMarketUrl(trade.eventSlug, trade.slug)" target="_blank" class="trade-title">
                    {{ trade.title }}
                  </a>
                </div>
                <div class="trade-meta">
                  <span class="trade-size">{{ formatUSD(trade.totalValue) }} @ {{ (trade.avgPrice * 100).toFixed(0) }}¢</span>
                  <span class="trade-time">{{ formatTime(trade.latestTimestamp) }}</span>
                </div>
              </div>
            </div>
          </div>
        </template>
        <div v-else class="panel-empty">
          Select a trader to view their recent trades
        </div>
      </div>

      <!-- Combined Trades Panel - Top P/V View -->
      <div v-else class="detail-panel open">
        <div class="panel-header">
          <h3 class="panel-title">Recent Trades</h3>
          <span v-if="allTradesLoading" class="loading-progress">
            Loading {{ allTradesProgress.loaded }}/{{ allTradesProgress.total }}...
          </span>
        </div>

        <div class="panel-section">
          <h4 class="section-title">Positions ({{ groupedAllTrades.length }})</h4>
          <div v-if="allTradesLoading && groupedAllTrades.length === 0" class="trades-loading">
            Fetching trades from {{ allTradesProgress.total }} traders...
          </div>
          <div v-else-if="groupedAllTrades.length === 0" class="trades-empty">No trades found</div>
          <div v-else class="trades-list">
            <div v-for="trade in groupedAllTrades" :key="trade.key" class="trade-item">
              <div class="trade-trader">
                <img
                  v-if="trade.traderImage"
                  :src="trade.traderImage"
                  class="trade-avatar"
                  alt=""
                />
                <div v-else class="trade-avatar-placeholder"></div>
                <a :href="getPolymarketProfileUrl(trade.proxyWallet)" target="_blank" class="trade-trader-name">
                  {{ trade.traderName || truncateWallet(trade.proxyWallet) }}
                </a>
              </div>
              <div class="trade-main">
                <span :class="['trade-side', trade.side.toLowerCase()]">{{ trade.side }}</span>
                <span class="trade-outcome">{{ trade.outcome }}</span>
                <span v-if="trade.tradeCount > 1" class="trade-count">×{{ trade.tradeCount }}</span>
              </div>
              <div class="trade-details">
                <a :href="getMarketUrl(trade.eventSlug, trade.slug)" target="_blank" class="trade-title">
                  {{ trade.title }}
                </a>
              </div>
              <div class="trade-meta">
                <span class="trade-size">{{ formatUSD(trade.totalValue) }} @ {{ (trade.avgPrice * 100).toFixed(0) }}¢</span>
                <span class="trade-time">{{ formatTime(trade.latestTimestamp) }}</span>
              </div>
            </div>
          </div>
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

.subnav-divider {
  width: 1px;
  height: 20px;
  background: var(--border-primary);
  margin: 0 var(--spacing-sm);
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

/* Leaderboard Layout */
.leaderboard-container {
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
  padding: 0.75rem 1rem;
  text-align: left;
  border-bottom: 1px solid var(--border-primary);
}

.table th {
  font-weight: 600;
  color: var(--text-muted);
  font-size: var(--font-sm);
  text-transform: uppercase;
  background: var(--bg-elevated);
  position: sticky;
  top: 0;
  z-index: 1;
}

.th-right {
  text-align: right;
}

.row-num {
  color: var(--text-faint);
  font-family: monospace;
  width: 40px;
}

.trader-row {
  cursor: pointer;
  transition: background 0.15s;
}

.trader-row:hover {
  background: var(--bg-tertiary);
}

.trader-row.selected {
  background: var(--bg-active);
}

.trader-cell {
  min-width: 200px;
}

.trader-info {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
}

.avatar-placeholder {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--bg-active);
}

.trader-details {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.trader-name-text {
  color: var(--text-primary);
  font-weight: 500;
}

.verified {
  color: var(--accent-blue);
  margin-left: 4px;
}

.twitter {
  color: var(--text-muted);
  font-size: var(--font-sm);
}

.pnl {
  font-family: monospace;
  font-weight: 600;
  text-align: right;
}

.pnl.positive {
  color: var(--accent-green);
}

.pnl.negative {
  color: var(--accent-red);
}

.volume {
  color: var(--text-muted);
  font-family: monospace;
  text-align: right;
}

.pv {
  font-family: monospace;
  font-weight: 600;
  text-align: right;
  font-size: var(--font-sm);
}

.pv.positive {
  color: var(--accent-green);
}

.pv.negative {
  color: var(--accent-red);
}

.source-cell {
  text-align: center;
}

.source-badge {
  font-size: var(--font-xs);
  padding: 0.15rem 0.4rem;
  border-radius: var(--radius-sm);
  font-weight: 500;
}

.source-badge.7d {
  background: var(--bg-active);
  color: var(--text-muted);
}

.source-badge.30d {
  background: var(--bg-active);
  color: var(--text-muted);
}

.source-badge.both {
  background: var(--accent-primary);
  color: var(--accent-primary-text);
}

/* Detail Panel */
.detail-panel {
  width: 400px;
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
  gap: var(--spacing-sm);
  padding: var(--spacing-md);
  border-bottom: 1px solid var(--border-primary);
  background: var(--bg-elevated);
}

.panel-trader-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.panel-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  object-fit: cover;
}

.panel-avatar-placeholder {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--bg-active);
}

.panel-title {
  font-size: var(--font-base);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.panel-twitter {
  color: var(--text-muted);
  font-size: var(--font-sm);
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

.panel-meta {
  display: flex;
  gap: var(--spacing-md);
  padding: var(--spacing-sm) var(--spacing-md);
  border-bottom: 1px solid var(--border-primary);
}

.meta-pnl {
  font-weight: 600;
  font-family: monospace;
}

.meta-pnl.positive {
  color: var(--accent-green);
}

.meta-pnl.negative {
  color: var(--accent-red);
}

.meta-item {
  font-size: var(--font-sm);
  color: var(--text-muted);
}

.panel-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.section-title {
  font-size: var(--font-sm);
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  padding: var(--spacing-sm) var(--spacing-md);
  margin: 0;
}

.trades-loading,
.trades-empty {
  padding: var(--spacing-lg);
  text-align: center;
  color: var(--text-muted);
  font-size: var(--font-sm);
}

.trades-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 var(--spacing-md) var(--spacing-md);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.trade-item {
  padding: var(--spacing-sm);
  background: var(--bg-tertiary);
  border-radius: var(--radius-md);
  font-size: var(--font-sm);
}

.trade-item:hover {
  background: var(--bg-active);
}

.trade-main {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-bottom: 4px;
}

.trade-side {
  font-size: var(--font-xs);
  padding: 0.1rem 0.3rem;
  border-radius: var(--radius-sm);
  text-transform: uppercase;
  font-weight: 600;
}

.trade-side.buy {
  background: var(--status-open-bg);
  color: var(--status-open-text);
}

.trade-side.sell {
  background: var(--status-closed-bg);
  color: var(--status-closed-text);
}

.trade-outcome {
  color: var(--text-secondary);
  font-weight: 500;
}

.trade-count {
  color: var(--text-muted);
  font-size: var(--font-xs);
  background: var(--bg-active);
  padding: 0.1rem 0.3rem;
  border-radius: var(--radius-sm);
}

.trade-details {
  margin-bottom: 4px;
}

.trade-title {
  color: var(--text-muted);
  text-decoration: none;
  font-size: var(--font-xs);
  line-height: 1.3;
}

.trade-title:hover {
  color: var(--text-secondary);
  text-decoration: underline;
}

.trade-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.trade-size {
  color: var(--text-secondary);
  font-family: monospace;
  font-size: var(--font-xs);
}

.trade-time {
  color: var(--text-faint);
  font-size: var(--font-xs);
}

.trade-trader {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  margin-bottom: 6px;
}

.trade-avatar {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  object-fit: cover;
}

.trade-avatar-placeholder {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--bg-active);
}

.trade-trader-name {
  color: var(--text-secondary);
  font-size: var(--font-xs);
  font-weight: 500;
  text-decoration: none;
}

.trade-trader-name:hover {
  color: var(--text-primary);
  text-decoration: underline;
}

.loading-progress {
  font-size: var(--font-sm);
  color: var(--text-muted);
}

.external-link {
  color: var(--accent-blue);
  text-decoration: none;
  font-size: var(--font-lg);
  padding: var(--spacing-xs);
  border-radius: var(--radius-sm);
  transition: background 0.15s;
}

.external-link:hover {
  background: var(--bg-active);
  color: var(--accent-blue-hover);
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
