<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import PageLayout from '../components/PageLayout.vue'

interface BetLog {
  id: string
  orderId: string | null
  marketSlug: string
  outcome: string
  side: 'BUY' | 'SELL'
  amount: number
  price: number
  status: 'pending' | 'placed' | 'filled' | 'partial' | 'cancelled' | 'failed'
  errorMessage: string | null
  source: 'manual' | 'auto'
  triggerTradeId: string | null
  triggerWallet: string | null
  triggerFollowScore: number | null
  resolvedStatus: 'won' | 'lost' | null
  pnl: number | null
  createdAt: string
  placedAt: string | null
}

type FilterType = 'all' | 'auto' | 'manual' | 'placed' | 'failed'

const bets = ref<BetLog[]>([])
const loading = ref(true)
const error = ref('')
const filter = ref<FilterType>('all')

const filteredBets = computed(() => {
  if (filter.value === 'all') return bets.value
  if (filter.value === 'auto') return bets.value.filter(b => b.source === 'auto')
  if (filter.value === 'manual') return bets.value.filter(b => b.source === 'manual')
  if (filter.value === 'placed') return bets.value.filter(b => b.status === 'placed' || b.status === 'filled')
  if (filter.value === 'failed') return bets.value.filter(b => b.status === 'failed')
  return bets.value
})

const stats = computed(() => {
  const total = bets.value.length
  const auto = bets.value.filter(b => b.source === 'auto').length
  const manual = bets.value.filter(b => b.source === 'manual').length
  const placed = bets.value.filter(b => b.status === 'placed' || b.status === 'filled').length
  const failed = bets.value.filter(b => b.status === 'failed').length
  const totalAmount = bets.value
    .filter(b => b.status === 'placed' || b.status === 'filled')
    .reduce((sum, b) => sum + b.amount, 0)
  return { total, auto, manual, placed, failed, totalAmount }
})

async function fetchBets() {
  loading.value = true
  error.value = ''
  try {
    const res = await fetch('/api/bet-log?limit=200')
    const data = await res.json()
    if (data.success) {
      bets.value = data.data
    } else {
      error.value = data.error
    }
  } catch (e) {
    error.value = 'Failed to fetch bets'
    console.error(e)
  }
  loading.value = false
}

function setFilter(f: FilterType) {
  filter.value = f
}

function formatDate(isoString: string): string {
  const d = new Date(isoString)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function formatUSD(value: number): string {
  return '$' + value.toFixed(2)
}

function truncateWallet(wallet: string): string {
  return wallet.slice(0, 6) + '...' + wallet.slice(-4)
}

function getMarketUrl(slug: string): string {
  return `https://polymarket.com/event/${slug}`
}

function getStatusClass(status: string): string {
  if (status === 'placed' || status === 'filled') return 'success'
  if (status === 'failed') return 'error'
  if (status === 'cancelled') return 'muted'
  return 'pending'
}

onMounted(() => {
  fetchBets()
})
</script>

<template>
  <PageLayout title="Bet Log">
    <template #subnav>
      <button
        @click="setFilter('all')"
        :class="['subnav-btn', { active: filter === 'all' }]"
      >
        All
      </button>
      <button
        @click="setFilter('auto')"
        :class="['subnav-btn', { active: filter === 'auto' }]"
      >
        Auto
      </button>
      <button
        @click="setFilter('manual')"
        :class="['subnav-btn', { active: filter === 'manual' }]"
      >
        Manual
      </button>
      <button
        @click="setFilter('placed')"
        :class="['subnav-btn', { active: filter === 'placed' }]"
      >
        Placed
      </button>
      <button
        @click="setFilter('failed')"
        :class="['subnav-btn', { active: filter === 'failed' }]"
      >
        Failed
      </button>
      <span class="subnav-spacer"></span>
      <span class="bet-count">{{ filteredBets.length }} bets</span>
      <button @click="fetchBets" :disabled="loading" class="btn btn-sm">
        {{ loading ? 'Loading...' : 'Refresh' }}
      </button>
    </template>

    <!-- Stats Banner -->
    <div class="stats-banner">
      <div class="stat-item">
        <span class="stat-value">{{ stats.total }}</span>
        <span class="stat-label">Total</span>
      </div>
      <div class="stat-item">
        <span class="stat-value auto">{{ stats.auto }}</span>
        <span class="stat-label">Auto</span>
      </div>
      <div class="stat-item">
        <span class="stat-value manual">{{ stats.manual }}</span>
        <span class="stat-label">Manual</span>
      </div>
      <div class="stat-item">
        <span class="stat-value success">{{ stats.placed }}</span>
        <span class="stat-label">Placed</span>
      </div>
      <div class="stat-item">
        <span class="stat-value error">{{ stats.failed }}</span>
        <span class="stat-label">Failed</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">{{ formatUSD(stats.totalAmount) }}</span>
        <span class="stat-label">Total Bet</span>
      </div>
    </div>

    <div v-if="loading && bets.length === 0" class="loading">Loading bets...</div>
    <div v-else-if="error" class="error">{{ error }}</div>

    <div v-else-if="filteredBets.length === 0" class="empty">
      No bets found
    </div>

    <div v-else class="table-container">
      <table class="table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Source</th>
            <th>Market</th>
            <th>Side</th>
            <th class="th-right">Amount</th>
            <th class="th-right">Price</th>
            <th>Status</th>
            <th>Trigger</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="bet in filteredBets" :key="bet.id" class="bet-row">
            <td class="time-cell">
              {{ formatDate(bet.createdAt) }}
            </td>
            <td>
              <span :class="['source-badge', bet.source]">{{ bet.source.toUpperCase() }}</span>
            </td>
            <td class="market-cell">
              <a :href="getMarketUrl(bet.marketSlug)" target="_blank" class="market-link">
                <span class="market-slug">{{ bet.marketSlug }}</span>
                <span class="market-outcome">{{ bet.outcome }}</span>
              </a>
            </td>
            <td>
              <span :class="['side-badge', bet.side.toLowerCase()]">{{ bet.side }}</span>
            </td>
            <td class="amount-cell">
              {{ formatUSD(bet.amount) }}
            </td>
            <td class="price-cell">
              {{ (bet.price * 100).toFixed(0) }}c
            </td>
            <td>
              <span :class="['status-badge', getStatusClass(bet.status)]">
                {{ bet.status.toUpperCase() }}
              </span>
              <span v-if="bet.errorMessage" class="error-tooltip" :title="bet.errorMessage">
                ?
              </span>
            </td>
            <td class="trigger-cell">
              <template v-if="bet.triggerWallet">
                <a
                  :href="`https://polymarket.com/profile/${bet.triggerWallet}`"
                  target="_blank"
                  class="trigger-link"
                >
                  {{ truncateWallet(bet.triggerWallet) }}
                </a>
              </template>
              <span v-else class="muted">-</span>
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

.bet-count {
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
}

.stat-value.auto {
  color: var(--accent-primary);
}

.stat-value.manual {
  color: var(--text-secondary);
}

.stat-value.success {
  color: var(--accent-green);
}

.stat-value.error {
  color: var(--accent-red);
}

.stat-label {
  font-size: var(--font-xs);
  color: var(--text-muted);
  text-transform: uppercase;
}

.loading,
.error,
.empty {
  padding: var(--spacing-xl);
  text-align: center;
}

.error {
  color: var(--accent-red);
}

.empty {
  color: var(--text-muted);
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

.bet-row:hover {
  background: var(--bg-tertiary);
}

.time-cell {
  color: var(--text-muted);
  white-space: nowrap;
}

.source-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  font-size: var(--font-xs);
  font-weight: 600;
}

.source-badge.auto {
  background: rgba(99, 102, 241, 0.2);
  color: #818cf8;
}

.source-badge.manual {
  background: rgba(156, 163, 175, 0.2);
  color: #9ca3af;
}

.market-cell {
  max-width: 250px;
}

.market-link {
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-decoration: none;
  color: inherit;
}

.market-link:hover .market-slug {
  color: var(--accent-primary);
  text-decoration: underline;
}

.market-slug {
  color: var(--text-secondary);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.market-outcome {
  color: var(--text-muted);
  font-size: var(--font-xs);
}

.side-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  font-size: var(--font-xs);
  font-weight: 600;
}

.side-badge.buy {
  background: rgba(34, 197, 94, 0.2);
  color: #22c55e;
}

.side-badge.sell {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

.amount-cell,
.price-cell {
  text-align: right;
  font-family: var(--font-mono);
}

.status-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  font-size: var(--font-xs);
  font-weight: 600;
}

.status-badge.success {
  background: rgba(34, 197, 94, 0.2);
  color: #22c55e;
}

.status-badge.error {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

.status-badge.pending {
  background: rgba(234, 179, 8, 0.2);
  color: #eab308;
}

.status-badge.muted {
  background: rgba(156, 163, 175, 0.2);
  color: #9ca3af;
}

.error-tooltip {
  display: inline-block;
  margin-left: 4px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
  font-size: 10px;
  text-align: center;
  line-height: 16px;
  cursor: help;
}

.trigger-cell {
  white-space: nowrap;
}

.trigger-link {
  color: var(--text-muted);
  text-decoration: none;
  font-family: var(--font-mono);
  font-size: var(--font-xs);
}

.trigger-link:hover {
  color: var(--accent-primary);
  text-decoration: underline;
}

.muted {
  color: var(--text-muted);
}
</style>
