<script setup lang="ts">
import { ref, onMounted } from 'vue'
import PageLayout from '../components/PageLayout.vue'

interface Stats {
  totalCount: number
  wonCount: number
  lostCount: number
  totalProfitPerDollar: number
}

interface TopTraderTrade {
  id: string
  transaction_hash: string
  proxy_wallet: string
  name: string | null
  pseudonym: string | null
  profile_image: string | null
  slug: string
  event_slug: string
  title: string
  icon: string | null
  outcome: string
  side: 'BUY' | 'SELL'
  total_size: number
  total_value: number
  avg_price: number
  trade_count: number
  first_timestamp: number
  latest_timestamp: number
  resolved_status: 'won' | 'lost' | null
  profit_per_dollar: number | null
}

type FilterType = 'all' | 'pending' | 'resolved' | 'won' | 'lost'

const trades = ref<TopTraderTrade[]>([])
const loading = ref(true)
const error = ref('')
const filter = ref<FilterType>('all')
const stats = ref<Stats | null>(null)

async function fetchTrades() {
  loading.value = true
  error.value = ''
  try {
    const params = new URLSearchParams({ limit: '200' })
    if (filter.value !== 'all') {
      params.set('filter', filter.value)
    }
    const res = await fetch(`/api/top-trader-trades?${params}`)
    const data = await res.json()
    if (data.success) {
      trades.value = data.data
    } else {
      error.value = data.error
    }
  } catch (e) {
    error.value = 'Failed to fetch trades'
    console.error(e)
  }
  loading.value = false
}

function setFilter(f: FilterType) {
  filter.value = f
  fetchTrades()
}

async function fetchStats() {
  try {
    const res = await fetch('/api/top-trader-trades/stats')
    const data = await res.json()
    if (data.success) {
      stats.value = data.data
    }
  } catch (e) {
    console.error('Failed to fetch stats:', e)
  }
}

function formatUSD(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return '$' + (value / 1_000_000).toFixed(1) + 'M'
  }
  if (Math.abs(value) >= 1_000) {
    return '$' + (value / 1_000).toFixed(1) + 'K'
  }
  return '$' + value.toFixed(0)
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp * 1000)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function truncateWallet(wallet: string): string {
  return wallet.slice(0, 6) + '...' + wallet.slice(-4)
}

function getTraderName(trade: TopTraderTrade): string {
  return trade.name || trade.pseudonym || truncateWallet(trade.proxy_wallet)
}

function getPolymarketProfileUrl(wallet: string): string {
  return `https://polymarket.com/profile/${wallet}`
}

function getMarketUrl(eventSlug: string, slug: string): string {
  return `https://polymarket.com/event/${eventSlug}/${slug}`
}

onMounted(() => {
  fetchTrades()
  fetchStats()
})
</script>

<template>
  <PageLayout title="Top Trader Trades">
    <template #subnav>
      <button
        @click="setFilter('all')"
        :class="['subnav-btn', { active: filter === 'all' }]"
      >
        All
      </button>
      <button
        @click="setFilter('pending')"
        :class="['subnav-btn', { active: filter === 'pending' }]"
      >
        Pending
      </button>
      <button
        @click="setFilter('resolved')"
        :class="['subnav-btn', { active: filter === 'resolved' }]"
      >
        Resolved
      </button>
      <button
        @click="setFilter('won')"
        :class="['subnav-btn', { active: filter === 'won' }]"
      >
        Won
      </button>
      <button
        @click="setFilter('lost')"
        :class="['subnav-btn', { active: filter === 'lost' }]"
      >
        Lost
      </button>
      <span class="subnav-spacer"></span>
      <span class="trade-count">{{ trades.length }} positions</span>
      <button @click="fetchTrades" :disabled="loading" class="btn btn-sm">
        {{ loading ? 'Loading...' : 'Refresh' }}
      </button>
    </template>

    <!-- Stats Banner -->
    <div v-if="stats" class="stats-banner">
      <div class="stat-item">
        <span class="stat-value">{{ stats.totalCount }}</span>
        <span class="stat-label">Resolved</span>
      </div>
      <div class="stat-item">
        <span class="stat-value won">{{ stats.wonCount }}</span>
        <span class="stat-label">Won</span>
      </div>
      <div class="stat-item">
        <span class="stat-value lost">{{ stats.lostCount }}</span>
        <span class="stat-label">Lost</span>
      </div>
      <div class="stat-item">
        <span class="stat-value" :class="stats.totalProfitPerDollar >= 0 ? 'positive' : 'negative'">
          {{ stats.totalProfitPerDollar >= 0 ? '+' : '' }}${{ stats.totalProfitPerDollar.toFixed(2) }}
        </span>
        <span class="stat-label">P/D (weighted)</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">{{ stats.totalCount > 0 ? ((stats.wonCount / stats.totalCount) * 100).toFixed(0) : 0 }}%</span>
        <span class="stat-label">Win Rate</span>
      </div>
    </div>

    <div v-if="loading && trades.length === 0" class="loading">Loading trades...</div>
    <div v-else-if="error" class="error">{{ error }}</div>

    <div v-else class="table-container">
      <table class="table">
        <thead>
          <tr>
            <th>Trader</th>
            <th>Market</th>
            <th>Side</th>
            <th class="th-right">Position</th>
            <th class="th-right">Trades</th>
            <th>Status</th>
            <th class="th-right">P/D</th>
            <th class="th-right">Time</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="trade in trades" :key="trade.id" class="trade-row">
            <td class="trader-cell">
              <a :href="getPolymarketProfileUrl(trade.proxy_wallet)" target="_blank" class="trader-link">
                <img
                  v-if="trade.profile_image"
                  :src="trade.profile_image"
                  class="avatar"
                  alt=""
                />
                <div v-else class="avatar-placeholder"></div>
                <span class="trader-name">{{ getTraderName(trade) }}</span>
              </a>
            </td>
            <td class="market-cell">
              <a :href="getMarketUrl(trade.event_slug, trade.slug)" target="_blank" class="market-link">
                <span class="market-title">{{ trade.title }}</span>
                <span class="market-outcome">{{ trade.outcome }}</span>
              </a>
            </td>
            <td>
              <span :class="['side-badge', trade.side.toLowerCase()]">{{ trade.side }}</span>
            </td>
            <td class="position-cell">
              <span class="position-value">{{ formatUSD(trade.total_value) }}</span>
              <span class="position-price">@ {{ (trade.avg_price * 100).toFixed(0) }}c</span>
            </td>
            <td class="trades-cell">
              {{ trade.trade_count }}
            </td>
            <td>
              <span v-if="trade.resolved_status" :class="['status-badge', trade.resolved_status]">
                {{ trade.resolved_status.toUpperCase() }}
              </span>
              <span v-else class="status-badge pending">PENDING</span>
            </td>
            <td class="pd-cell">
              <span v-if="trade.profit_per_dollar !== null" :class="['pd-value', trade.profit_per_dollar >= 0 ? 'positive' : 'negative']">
                {{ trade.profit_per_dollar >= 0 ? '+' : '' }}${{ trade.profit_per_dollar.toFixed(2) }}
              </span>
              <span v-else class="pd-value muted">-</span>
            </td>
            <td class="time-cell">
              {{ formatTime(trade.latest_timestamp) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </PageLayout>
</template>

<style scoped>
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

.trade-count {
  color: var(--text-muted);
  font-size: var(--font-sm);
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

.table-container {
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-xl);
  overflow: hidden;
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-sm);
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
  font-size: var(--font-xs);
  text-transform: uppercase;
  background: var(--bg-elevated);
  position: sticky;
  top: 0;
  z-index: 1;
}

.th-right {
  text-align: right;
}

.trade-row:hover {
  background: var(--bg-tertiary);
}

.trader-cell {
  min-width: 150px;
}

.trader-link {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  text-decoration: none;
  color: inherit;
}

.trader-link:hover .trader-name {
  color: var(--accent-primary);
  text-decoration: underline;
}

.avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
}

.avatar-placeholder {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--bg-active);
}

.trader-name {
  color: var(--text-secondary);
  font-weight: 500;
}

.market-cell {
  max-width: 300px;
}

.market-link {
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-decoration: none;
}

.market-link:hover .market-title {
  color: var(--accent-primary);
  text-decoration: underline;
}

.market-title {
  color: var(--text-secondary);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.market-outcome {
  color: var(--text-muted);
  font-size: var(--font-xs);
}

.side-badge {
  font-size: var(--font-xs);
  padding: 0.15rem 0.4rem;
  border-radius: var(--radius-sm);
  text-transform: uppercase;
  font-weight: 600;
}

.side-badge.buy {
  background: var(--status-open-bg);
  color: var(--status-open-text);
}

.side-badge.sell {
  background: var(--status-closed-bg);
  color: var(--status-closed-text);
}

.position-cell {
  text-align: right;
}

.position-value {
  color: var(--text-primary);
  font-weight: 600;
  font-family: monospace;
}

.position-price {
  color: var(--text-muted);
  font-size: var(--font-xs);
  margin-left: var(--spacing-xs);
}

.trades-cell {
  text-align: right;
  color: var(--text-muted);
  font-family: monospace;
}

.status-badge {
  font-size: var(--font-xs);
  padding: 0.15rem 0.4rem;
  border-radius: var(--radius-sm);
  font-weight: 600;
}

.status-badge.won {
  background: var(--accent-green);
  color: #000;
}

.status-badge.lost {
  background: var(--accent-red);
  color: #fff;
}

.status-badge.pending {
  background: var(--bg-active);
  color: var(--text-muted);
}

.pd-cell {
  text-align: right;
}

.pd-value {
  font-family: monospace;
  font-weight: 600;
}

.pd-value.positive {
  color: var(--accent-green);
}

.pd-value.negative {
  color: var(--accent-red);
}

.pd-value.muted {
  color: var(--text-muted);
}

.time-cell {
  text-align: right;
  color: var(--text-muted);
  font-size: var(--font-xs);
  white-space: nowrap;
}

.stats-banner {
  display: flex;
  gap: var(--spacing-xl);
  padding: var(--spacing-lg);
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-xl);
  margin-bottom: var(--spacing-lg);
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.stat-value {
  font-size: var(--font-xl);
  font-weight: 700;
  color: var(--text-primary);
  font-family: monospace;
}

.stat-value.won,
.stat-value.positive {
  color: var(--accent-green);
}

.stat-value.lost,
.stat-value.negative {
  color: var(--accent-red);
}

.stat-label {
  font-size: var(--font-xs);
  color: var(--text-muted);
  text-transform: uppercase;
}
</style>
