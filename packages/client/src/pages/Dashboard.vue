<script setup lang="ts">
import { ref, onMounted } from 'vue'
import PageLayout from '../components/PageLayout.vue'

interface Trade {
  name: string
  pseudonym: string
  side: 'BUY' | 'SELL'
  size: number
  price: number
  title: string
  outcome: string
  timestamp: number
  proxyWallet: string
}

interface FreshWallet {
  wallet: string
  ageInDays: number
  totalVolume: number
  tradeCount: number
  volumePerDay: number
}

interface LargeTrade {
  wallet: string
  title: string
  size: number
  price: number
  side: string
  outcome: string
  timestamp: string
}

interface Alert {
  id: number
  type: string
  severity: string
  wallet: string
  market_slug: string
  details: string
  created_at: number
}

interface Stats {
  totalTrades: number
  totalWallets: number
  totalAlerts: number
}

const trades = ref<Trade[]>([])
const freshWallets = ref<FreshWallet[]>([])
const largeTrades = ref<LargeTrade[]>([])
const alerts = ref<Alert[]>([])
const stats = ref<Stats>({ totalTrades: 0, totalWallets: 0, totalAlerts: 0 })
const loading = ref(true)
const syncing = ref(false)
const error = ref('')

function formatTime(timestamp: number): string {

  return new Date(timestamp * 1000).toLocaleTimeString()
}

function formatDate(timestamp: number): string {

  return new Date(timestamp * 1000).toLocaleString()
}

function formatUSD(value: number): string {

  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

function shortenWallet(wallet: string): string {

  return wallet.slice(0, 6) + '...' + wallet.slice(-4)
}

async function syncData() {
  syncing.value = true
  try {
    await fetch('/api/analysis/sync', { method: 'POST' })
    await loadData()
  } catch (e) {
    error.value = 'Sync failed'
  }
  syncing.value = false
}

async function loadData() {
  try {
    const [tradesRes, freshRes, largeRes, alertsRes, statsRes] = await Promise.all([
      fetch('/api/polymarket/trades?limit=10'),
      fetch('/api/analysis/fresh-wallets'),
      fetch('/api/analysis/large-trades?min_size=1000'),
      fetch('/api/analysis/alerts?limit=10'),
      fetch('/api/analysis/stats')
    ])

    const [tradesData, freshData, largeData, alertsData, statsData] = await Promise.all([
      tradesRes.json(),
      freshRes.json(),
      largeRes.json(),
      alertsRes.json(),
      statsRes.json()
    ])

    if (tradesData.success) trades.value = tradesData.data
    if (freshData.success) freshWallets.value = freshData.data.slice(0, 10)
    if (largeData.success) largeTrades.value = largeData.data.slice(0, 10)
    if (alertsData.success) alerts.value = alertsData.data
    if (statsData.success) stats.value = statsData.data

    loading.value = false
  } catch (e) {
    error.value = 'Failed to fetch data'
    loading.value = false
  }
}

onMounted(loadData)
</script>

<template>
  <PageLayout title="Dashboard">
    <template #header-actions>
      <div class="stats">
        <span>Trades: {{ stats.totalTrades }}</span>
        <span>Wallets: {{ stats.totalWallets }}</span>
        <span>Alerts: {{ stats.totalAlerts }}</span>
      </div>
      <button @click="syncData" :disabled="syncing" class="sync-btn">
        {{ syncing ? 'Syncing...' : 'Sync Trades' }}
      </button>
    </template>

    <div v-if="loading" class="loading">Loading...</div>
    <div v-else-if="error" class="error">{{ error }}</div>

    <div v-else class="grid">
      <!-- Alerts -->
      <section class="section alerts-section" v-if="alerts.length > 0">
        <h2>Recent Alerts</h2>
        <div class="alert-list">
          <div v-for="alert in alerts" :key="alert.id" :class="['alert-item', alert.severity]">
            <span class="alert-type">{{ alert.type.replace('_', ' ') }}</span>
            <span class="alert-severity">{{ alert.severity }}</span>
            <span class="alert-wallet" v-if="alert.wallet">{{ shortenWallet(alert.wallet) }}</span>
            <span class="alert-time">{{ formatDate(alert.created_at) }}</span>
          </div>
        </div>
      </section>

      <!-- Fresh Wallets -->
      <section class="section">
        <h2>Fresh Wallets (High Activity)</h2>
        <table class="table" v-if="freshWallets.length > 0">
          <thead>
            <tr>
              <th>Wallet</th>
              <th>Age</th>
              <th>Volume</th>
              <th>Trades</th>
              <th>$/Day</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="wallet in freshWallets" :key="wallet.wallet">
              <td class="mono">{{ shortenWallet(wallet.wallet) }}</td>
              <td>{{ wallet.ageInDays }}d</td>
              <td>{{ formatUSD(wallet.totalVolume) }}</td>
              <td>{{ wallet.tradeCount }}</td>
              <td class="highlight">{{ formatUSD(wallet.volumePerDay) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="empty">No fresh wallets detected. Click "Sync Trades" to fetch data.</p>
      </section>

      <!-- Large Trades -->
      <section class="section">
        <h2>Large Trades (&gt;$1,000)</h2>
        <table class="table" v-if="largeTrades.length > 0">
          <thead>
            <tr>
              <th>Wallet</th>
              <th>Size</th>
              <th>Side</th>
              <th>Market</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(trade, i) in largeTrades" :key="i">
              <td class="mono">{{ shortenWallet(trade.wallet) }}</td>
              <td class="highlight">{{ formatUSD(trade.size) }}</td>
              <td :class="trade.side.toLowerCase()">{{ trade.side }}</td>
              <td class="market">{{ trade.title }}</td>
              <td>{{ trade.outcome }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="empty">No large trades found.</p>
      </section>

      <!-- Recent Trades -->
      <section class="section full-width">
        <h2>Recent Trades</h2>
        <table class="table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Trader</th>
              <th>Side</th>
              <th>Size</th>
              <th>Market</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="trade in trades" :key="trade.timestamp + trade.proxyWallet">
              <td>{{ formatTime(trade.timestamp) }}</td>
              <td class="trader">{{ trade.name || trade.pseudonym }}</td>
              <td :class="trade.side.toLowerCase()">{{ trade.side }}</td>
              <td>{{ formatUSD(trade.size) }}</td>
              <td class="market">{{ trade.title }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  </PageLayout>
</template>

<style scoped>
.stats {
  display: flex;
  gap: var(--spacing-md);
  font-size: var(--font-base);
  color: var(--text-muted);
}

.sync-btn {
  background: var(--accent-primary);
  color: var(--accent-primary-text);
  border: none;
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: var(--font-base);
  font-weight: 500;
}

.sync-btn:hover {
  background: var(--accent-primary-hover);
}

.sync-btn:disabled {
  background: #444;
  cursor: not-allowed;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-lg);
}

.section {
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-xl);
  padding: var(--spacing-md);
}

.alerts-section,
.full-width {
  grid-column: 1 / -1;
}

h2 {
  margin-bottom: var(--spacing-md);
  font-size: var(--font-lg);
  color: var(--text-primary);
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-md);
}

.table th,
.table td {
  padding: var(--spacing-sm);
  text-align: left;
  border-bottom: 1px solid var(--border-primary);
}

.table th {
  font-weight: 600;
  color: var(--text-muted);
  font-size: var(--font-sm);
  text-transform: uppercase;
}

.trader {
  font-weight: 500;
}

.market {
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mono {
  font-family: monospace;
  font-size: var(--font-sm);
}

.highlight {
  color: #fbbf24;
  font-weight: 600;
}

.buy {
  color: var(--accent-green-text);
  font-weight: 600;
}

.sell {
  color: var(--accent-red);
  font-weight: 600;
}

.alert-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.alert-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: var(--spacing-sm) 0.75rem;
  background: var(--bg-hover);
  border-radius: var(--radius-md);
  font-size: var(--font-md);
  border-left: 3px solid var(--text-disabled);
}

.alert-item.critical {
  border-left-color: var(--accent-red);
  background: #1f1111;
}

.alert-item.high {
  border-left-color: var(--accent-orange);
  background: #1a1510;
}

.alert-item.medium {
  border-left-color: #fbbf24;
}

.alert-item.low {
  border-left-color: var(--accent-green-text);
}

.alert-type {
  font-weight: 600;
  text-transform: capitalize;
}

.alert-severity {
  font-size: var(--font-xs);
  text-transform: uppercase;
  padding: 0.125rem 0.375rem;
  border-radius: var(--radius-sm);
  background: var(--border-secondary);
}

.alert-wallet {
  font-family: monospace;
  color: var(--text-muted);
}

.alert-time {
  margin-left: auto;
  color: var(--text-faint);
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

.empty {
  color: var(--text-faint);
  font-size: var(--font-base);
  padding: var(--spacing-md) 0;
}
</style>
