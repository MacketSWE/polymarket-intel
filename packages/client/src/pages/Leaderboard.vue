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
  side: 'BUY' | 'SELL'
  size: number
  price: number
  timestamp: number
  title: string
  slug: string
  eventSlug: string
  outcome: string
  icon: string
}

type TimePeriod = 'DAY' | 'WEEK' | 'MONTH' | 'ALL'
type OrderBy = 'PNL' | 'VOL'

const loading = ref(true)
const traders = ref<Trader[]>([])
const error = ref('')
const timePeriod = ref<TimePeriod>('WEEK')
const orderBy = ref<OrderBy>('PNL')

const selectedTrader = ref<Trader | null>(null)
const traderTrades = ref<Trade[]>([])
const tradesLoading = ref(false)

interface GroupedTrade {
  key: string
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

function groupTrades(trades: Trade[]): GroupedTrade[] {
  const groups = new Map<string, GroupedTrade>()

  for (const trade of trades) {
    const key = `${trade.slug}-${trade.side}-${trade.outcome}`

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

watch([timePeriod, orderBy], () => {
  fetchLeaderboard()
})

onMounted(() => {
  fetchLeaderboard()
})
</script>

<template>
  <PageLayout title="Leaderboard">
    <template #subnav>
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

    <div v-if="loading" class="loading">Loading leaderboard...</div>
    <div v-else-if="error" class="error">{{ error }}</div>

    <div v-else class="content-layout">
      <!-- Leaderboard Table -->
      <div class="leaderboard-container">
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
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Detail Panel -->
      <div class="detail-panel" :class="{ open: selectedTrader }">
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
