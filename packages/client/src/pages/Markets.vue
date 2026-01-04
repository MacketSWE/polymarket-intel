<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import PageLayout from '../components/PageLayout.vue'

interface Market {
  question: string
  slug: string
  volumeNum: number
  volume24hr: number
  lastTradePrice: number
  closed: boolean
  active: boolean
  endDate: string
}

interface EventTag {
  id: string
  label: string
  slug: string
}

interface EventMarket {
  question: string
  slug: string
  volumeNum: number
  volume24hr: number
  closed: boolean
  endDate: string
}

interface Event {
  id: string
  title: string
  slug: string
  volume24hr: number
  closed: boolean
  tags: EventTag[] | null
  markets: EventMarket[]
}

interface Tag {
  id: string
  slug: string
  label: string
}

interface PopularTag {
  id: string
  slug: string
  label: string
  count: number
}

interface Sport {
  id: number
  sport: string
  tags: string
  image?: string
}

interface MarketStats {
  totalMarkets: number
  openMarkets: number
  closedMarkets: number
}

const markets = ref<Market[]>([])
const stats = ref<MarketStats | null>(null)
const loading = ref(true)
const statsLoading = ref(false)
const error = ref('')

// Filters
const statusFilter = ref<'all' | 'open' | 'closed'>('open')
const orderBy = ref('volume24hr')
const ascending = ref(false)

// Direction labels based on order field
const directionLabels = {
  volume24hr: { asc: 'Lowest first', desc: 'Highest first' },
  volumeNum: { asc: 'Lowest first', desc: 'Highest first' },
  createdAt: { asc: 'Oldest first', desc: 'Newest first' },
  endDate: { asc: 'Ending soonest', desc: 'Ending latest' },
  liquidity: { asc: 'Lowest first', desc: 'Highest first' }
} as Record<string, { asc: string; desc: string }>

function formatUSD(value: number): string {

  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

function formatNumber(value: number): string {

  return new Intl.NumberFormat('en-US').format(value)
}

async function loadMarkets() {
  loading.value = true
  error.value = ''
  try {
    const params = new URLSearchParams()
    params.set('limit', '50')
    params.set('order', orderBy.value)
    params.set('ascending', ascending.value.toString())
    if (statusFilter.value !== 'all') {
      params.set('closed', (statusFilter.value === 'closed').toString())
    }

    const response = await fetch(`/api/polymarket/markets?${params}`)
    const data = await response.json()

    if (data.success) {
      markets.value = data.data
    }
  } catch (e) {
    error.value = 'Failed to fetch markets'
  }
  loading.value = false
}

async function loadStats() {
  statsLoading.value = true
  try {
    const response = await fetch('/api/polymarket/stats')
    const data = await response.json()

    if (data.success) {
      stats.value = data.data
    }
  } catch (e) {
    console.error('Failed to fetch stats')
  }
  statsLoading.value = false
}

// Debug fetch state
const debugLoading = ref(false)
const debugEvents = ref<Event[]>([])
const debugOffset = ref(0)
const debugStatus = ref<'all' | 'open' | 'closed'>('all')
const debugOrder = ref('volume24hr')
const debugAscending = ref(false)
const debugHasMore = ref(false)
const debugLimit = ref(100)
const expandedEvents = ref<Set<string>>(new Set())

// Exclude tags
const excludeTags = ref({
  sports: false,      // tag_id=1
  crypto: false,      // tag_id=21
  recurring: true,    // tag_id=101757
  hidden: true        // tag_id=102169
})

function getExcludeTagIds(): string[] {
  const ids: string[] = []
  if (excludeTags.value.sports) ids.push('1')
  if (excludeTags.value.crypto) ids.push('21')
  if (excludeTags.value.recurring) ids.push('101757')
  if (excludeTags.value.hidden) ids.push('102169')
  return ids
}

function toggleEvent(slug: string) {
  if (expandedEvents.value.has(slug)) {
    expandedEvents.value.delete(slug)
  } else {
    expandedEvents.value.add(slug)
  }
  expandedEvents.value = new Set(expandedEvents.value) // trigger reactivity
}

function getEventUrl(slug: string) {
  return `https://polymarket.com/event/${slug}`
}

function getMarketUrl(eventSlug: string, marketSlug: string) {
  return `https://polymarket.com/event/${eventSlug}/${marketSlug}`
}

async function debugFetch(append = false) {
  debugLoading.value = true
  if (!append) {
    debugOffset.value = 0
    debugEvents.value = []
  }

  try {
    const params = new URLSearchParams()
    params.set('limit', debugLimit.value.toString())
    params.set('order', debugOrder.value)
    params.set('ascending', debugAscending.value.toString())
    params.set('offset', debugOffset.value.toString())
    if (debugStatus.value !== 'all') {
      params.set('closed', (debugStatus.value === 'closed').toString())
    }

    // Add exclude tags
    const excludeIds = getExcludeTagIds()
    if (excludeIds.length > 0) {
      params.set('exclude_tag_ids', excludeIds.join(','))
    }

    const response = await fetch(`/api/polymarket/events?${params}`)
    const data = await response.json()

    if (data.success) {
      if (append) {
        debugEvents.value = [...debugEvents.value, ...data.data]
      } else {
        debugEvents.value = data.data
      }
      debugHasMore.value = data.data.length === debugLimit.value
      console.log(`Fetched ${data.data.length} events (offset ${debugOffset.value}):`, data.data)
      console.log('First 10:', data.data.slice(0, 10))
    }
  } catch (e) {
    console.error('Debug fetch failed:', e)
  }
  debugLoading.value = false
}

function debugFetchNext() {
  debugOffset.value += debugLimit.value
  debugFetch(true)
}

function debugReset() {
  debugEvents.value = []
  debugOffset.value = 0
  debugHasMore.value = false
}

// Tags state
const tagsLoading = ref(false)
const tags = ref<Tag[]>([])
const tagsSearch = ref('')
const sportsLoading = ref(false)
const sports = ref<Sport[]>([])
const popularTagsLoading = ref(false)
const popularTags = ref<PopularTag[]>([])

async function fetchTags() {
  tagsLoading.value = true
  try {
    const response = await fetch('/api/polymarket/tags')
    const data = await response.json()
    if (data.success) {
      tags.value = data.data
      console.log(`Fetched ${data.data.length} tags:`, data.data)
    }
  } catch (e) {
    console.error('Failed to fetch tags:', e)
  }
  tagsLoading.value = false
}

async function fetchSports() {
  sportsLoading.value = true
  try {
    const response = await fetch('/api/polymarket/sports')
    const data = await response.json()
    if (data.success) {
      sports.value = data.data
      console.log(`Fetched ${data.data.length} sports:`, data.data)
    }
  } catch (e) {
    console.error('Failed to fetch sports:', e)
  }
  sportsLoading.value = false
}

async function fetchPopularTags() {
  popularTagsLoading.value = true
  try {
    const response = await fetch('/api/polymarket/tags/popular?sample=500')
    const data = await response.json()
    if (data.success) {
      popularTags.value = data.data
      console.log(`Fetched ${data.data.length} popular tags:`, data.data)
    }
  } catch (e) {
    console.error('Failed to fetch popular tags:', e)
  }
  popularTagsLoading.value = false
}

function getFilteredTags() {
  if (!tagsSearch.value) return tags.value
  const search = tagsSearch.value.toLowerCase()
  return tags.value.filter(t =>
    t.label?.toLowerCase().includes(search) ||
    t.slug?.toLowerCase().includes(search)
  )
}

// Reload markets when filters change
watch([statusFilter, orderBy, ascending], () => {
  loadMarkets()
})

onMounted(loadMarkets)
</script>

<template>
  <PageLayout title="Markets">
    <!-- Stats Section -->
    <div class="stats-section">
      <div class="stats-card">
        <div class="stat">
          <span class="stat-label">Total Markets</span>
          <span class="stat-value">{{ stats ? formatNumber(stats.totalMarkets) : '-' }}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Open</span>
          <span class="stat-value open">{{ stats ? formatNumber(stats.openMarkets) : '-' }}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Closed</span>
          <span class="stat-value closed">{{ stats ? formatNumber(stats.closedMarkets) : '-' }}</span>
        </div>
      </div>
      <button @click="loadStats" :disabled="statsLoading" class="btn">
        {{ statsLoading ? 'Fetching...' : stats ? 'Refresh Stats' : 'Fetch Stats' }}
      </button>
      <span v-if="statsLoading" class="stats-hint">This may take 30-60 seconds</span>
    </div>

    <!-- Filters -->
    <div class="filters">
      <div class="filter-group">
        <label>Status</label>
        <select v-model="statusFilter">
          <option value="all">All</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      <div class="filter-group">
        <label>Order By</label>
        <select v-model="orderBy">
          <option value="volume24hr">24h Volume</option>
          <option value="volumeNum">Total Volume</option>
          <option value="createdAt">Created Date</option>
          <option value="endDate">End Date</option>
          <option value="liquidity">Liquidity</option>
        </select>
      </div>

      <div class="filter-group">
        <label>Direction</label>
        <select v-model="ascending">
          <option :value="false">{{ directionLabels[orderBy]?.desc || 'Descending' }}</option>
          <option :value="true">{{ directionLabels[orderBy]?.asc || 'Ascending' }}</option>
        </select>
      </div>
    </div>

    <!-- Debug Section -->
    <div class="debug-section">
      <div class="debug-header">
        <span class="debug-label">Debug Fetch (Events)</span>
        <span class="debug-info" v-if="debugEvents.length > 0">
          {{ debugEvents.length }} events loaded (offset: {{ debugOffset }})
        </span>
      </div>

      <div class="debug-controls">
        <div class="filter-group">
          <label>Status</label>
          <select v-model="debugStatus">
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
        </div>

        <div class="filter-group">
          <label>Order By</label>
          <select v-model="debugOrder">
            <option value="volume24hr">24h Volume</option>
            <option value="createdAt">Created Date</option>
            <option value="endDate">End Date</option>
          </select>
        </div>

        <div class="filter-group">
          <label>Direction</label>
          <select v-model="debugAscending">
            <option :value="false">{{ directionLabels[debugOrder]?.desc || 'Descending' }}</option>
            <option :value="true">{{ directionLabels[debugOrder]?.asc || 'Ascending' }}</option>
          </select>
        </div>

        <div class="filter-group">
          <label>Limit</label>
          <select v-model="debugLimit">
            <option :value="50">50</option>
            <option :value="100">100</option>
            <option :value="200">200</option>
            <option :value="500">500</option>
          </select>
        </div>

        <button @click="debugFetch(false)" :disabled="debugLoading" class="btn btn-debug">
          {{ debugLoading ? 'Fetching...' : `Fetch ${debugLimit}` }}
        </button>
      </div>

      <div class="exclude-tags">
        <span class="exclude-label">Exclude:</span>
        <label class="checkbox-label">
          <input type="checkbox" v-model="excludeTags.sports" />
          <span>Sports</span>
        </label>
        <label class="checkbox-label">
          <input type="checkbox" v-model="excludeTags.crypto" />
          <span>Crypto</span>
        </label>
        <label class="checkbox-label">
          <input type="checkbox" v-model="excludeTags.recurring" />
          <span>Recurring</span>
        </label>
        <label class="checkbox-label">
          <input type="checkbox" v-model="excludeTags.hidden" />
          <span>Hidden</span>
        </label>

        <div class="exclude-actions">
          <button
            v-if="debugHasMore"
            @click="debugFetchNext"
            :disabled="debugLoading"
            class="btn btn-debug"
          >
            Next {{ debugLimit }}
          </button>

          <button
            v-if="debugEvents.length > 0"
            @click="debugReset"
            class="btn btn-debug btn-reset"
          >
            Clear
          </button>
        </div>
      </div>

      <!-- Debug Results -->
      <div v-if="debugEvents.length > 0" class="debug-results">
        <table class="table debug-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Status</th>
              <th>Title</th>
              <th>Tags</th>
              <th>Markets</th>
              <th>24h Vol</th>
              <th>Link</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="(event, i) in debugEvents" :key="event.slug">
              <tr
                :class="['event-row', { expanded: expandedEvents.has(event.slug) }]"
                @click="toggleEvent(event.slug)"
              >
                <td class="row-num">{{ i + 1 }}</td>
                <td>
                  <span :class="['status', event.closed ? 'closed' : 'open']">
                    {{ event.closed ? 'Closed' : 'Open' }}
                  </span>
                </td>
                <td class="question">
                  <span class="expand-icon">{{ expandedEvents.has(event.slug) ? '▼' : '▶' }}</span>
                  {{ event.title }}
                </td>
                <td class="tags-cell">
                  <span v-if="event.tags && event.tags.length > 0" class="tag-list">
                    <span v-for="tag in event.tags" :key="tag.id" class="mini-tag">
                      {{ tag.label }}
                    </span>
                  </span>
                  <span v-else class="no-tags">-</span>
                </td>
                <td class="markets-count">{{ event.markets?.length || 0 }}</td>
                <td class="volume-total">{{ formatUSD(event.volume24hr || 0) }}</td>
                <td class="link-cell">
                  <a
                    :href="getEventUrl(event.slug)"
                    target="_blank"
                    @click.stop
                    class="external-link"
                  >↗</a>
                </td>
              </tr>
              <!-- Expanded Markets -->
              <tr v-if="expandedEvents.has(event.slug) && event.markets?.length > 0" class="markets-row">
                <td colspan="7">
                  <div class="markets-list">
                    <div v-for="market in event.markets" :key="market.slug" class="market-item">
                      <span :class="['status', 'small', market.closed ? 'closed' : 'open']">
                        {{ market.closed ? 'C' : 'O' }}
                      </span>
                      <span class="market-question">{{ market.question }}</span>
                      <span class="market-volume">{{ formatUSD(market.volume24hr || 0) }}</span>
                      <a
                        :href="getMarketUrl(event.slug, market.slug)"
                        target="_blank"
                        class="external-link"
                      >↗</a>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Tags Section -->
    <div class="tags-section">
      <div class="tags-header">
        <span class="section-label">Tags & Categories</span>
        <div class="tags-actions">
          <button @click="fetchPopularTags" :disabled="popularTagsLoading" class="btn btn-sm btn-primary">
            {{ popularTagsLoading ? 'Loading...' : popularTags.length ? `Refresh Popular (${popularTags.length})` : 'Popular Tags' }}
          </button>
          <button @click="fetchTags" :disabled="tagsLoading" class="btn btn-sm">
            {{ tagsLoading ? 'Loading...' : tags.length ? `Refresh All (${tags.length})` : 'All Tags' }}
          </button>
          <button @click="fetchSports" :disabled="sportsLoading" class="btn btn-sm">
            {{ sportsLoading ? 'Loading...' : sports.length ? `Refresh Sports (${sports.length})` : 'Fetch Sports' }}
          </button>
        </div>
      </div>

      <!-- Popular Tags -->
      <div v-if="popularTags.length > 0" class="popular-tags-list">
        <div class="subsection-label">Popular Tags ({{ popularTags.length }})</div>
        <div class="popular-tags-grid">
          <div v-for="tag in popularTags" :key="tag.id" class="popular-tag-chip">
            <span class="tag-label">{{ tag.label }}</span>
            <span class="tag-count">{{ tag.count }}</span>
            <span class="tag-id">{{ tag.id }}</span>
          </div>
        </div>
      </div>

      <!-- Sports List -->
      <div v-if="sports.length > 0" class="sports-list">
        <div class="subsection-label">Sports ({{ sports.length }})</div>
        <div class="sports-grid">
          <div v-for="sport in sports" :key="sport.id" class="sport-chip">
            <span class="sport-name">{{ sport.sport }}</span>
            <span class="sport-tags">{{ sport.tags }}</span>
          </div>
        </div>
      </div>

      <!-- Tags List -->
      <div v-if="tags.length > 0" class="tags-list">
        <div class="tags-list-header">
          <span class="subsection-label">All Tags ({{ tags.length }})</span>
          <input
            v-model="tagsSearch"
            type="text"
            placeholder="Search tags..."
            class="tags-search"
          />
        </div>
        <div class="tags-grid">
          <div v-for="tag in getFilteredTags()" :key="tag.id" class="tag-chip">
            <span class="tag-id">{{ tag.id }}</span>
            <span class="tag-label">{{ tag.label || tag.slug }}</span>
          </div>
        </div>
        <div v-if="getFilteredTags().length === 0" class="no-results">
          No tags match "{{ tagsSearch }}"
        </div>
      </div>
    </div>

    <div v-if="loading" class="loading">Loading...</div>
    <div v-else-if="error" class="error">{{ error }}</div>

    <!-- Markets Table -->
    <div v-else class="markets-container">
      <table class="table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Question</th>
            <th>24h Volume</th>
            <th>Total Volume</th>
            <th>Price</th>
            <th>End Date</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="market in markets" :key="market.slug">
            <td>
              <span :class="['status', market.closed ? 'closed' : 'open']">
                {{ market.closed ? 'Closed' : 'Open' }}
              </span>
            </td>
            <td class="question">{{ market.question }}</td>
            <td class="volume">{{ formatUSD(market.volume24hr) }}</td>
            <td class="volume-total">{{ formatUSD(market.volumeNum) }}</td>
            <td class="price">{{ (market.lastTradePrice * 100).toFixed(1) }}%</td>
            <td class="date">{{ market.endDate ? new Date(market.endDate).toLocaleDateString() : '-' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </PageLayout>
</template>

<style scoped>
.stats-section {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-md);
}

.stats-card {
  display: flex;
  gap: var(--spacing-xl);
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-xl);
  padding: var(--spacing-md) var(--spacing-lg);
}

.stat {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.stat-label {
  font-size: var(--font-sm);
  color: var(--text-muted);
  text-transform: uppercase;
}

.stat-value {
  font-size: 1.25rem;
  font-weight: 600;
}

.stat-value.open {
  color: var(--accent-green-text);
}

.stat-value.closed {
  color: var(--status-closed-text);
}

.btn {
  background: var(--accent-blue);
  color: white;
  border: none;
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: var(--font-base);
}

.btn:hover {
  background: var(--accent-blue-hover);
}

.btn:disabled {
  background: #444;
  cursor: not-allowed;
}

.stats-hint {
  font-size: var(--font-sm);
  color: var(--text-faint);
}

.filters {
  display: flex;
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-lg);
  padding: var(--spacing-md);
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-xl);
}

.filter-group {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.filter-group label {
  font-size: var(--font-sm);
  color: var(--text-muted);
  text-transform: uppercase;
}

.filter-group select {
  background: var(--bg-hover);
  border: 1px solid var(--border-secondary);
  color: var(--text-primary);
  padding: var(--spacing-sm) 0.75rem;
  border-radius: var(--radius-md);
  font-size: var(--font-base);
  cursor: pointer;
  min-width: 140px;
}

.filter-group select:hover {
  border-color: var(--text-disabled);
}

.filter-group select:focus {
  outline: none;
  border-color: var(--accent-blue);
}

.markets-container {
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-xl);
  padding: var(--spacing-md);
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-base);
}

.table th,
.table td {
  padding: 0.75rem;
  text-align: left;
  border-bottom: 1px solid var(--border-primary);
}

.table th {
  font-weight: 600;
  color: var(--text-muted);
  font-size: var(--font-sm);
  text-transform: uppercase;
}

.table tbody tr:hover {
  background: var(--bg-hover);
}

.question {
  max-width: 400px;
  font-weight: 500;
}

.volume {
  color: var(--accent-green-text);
  font-weight: 600;
}

.volume-total {
  color: var(--text-muted);
}

.price {
  font-weight: 600;
}

.status {
  font-size: var(--font-xs);
  padding: 0.2rem var(--spacing-sm);
  border-radius: var(--radius-sm);
  text-transform: uppercase;
  font-weight: 600;
}

.status.open {
  background: var(--status-open-bg);
  color: var(--status-open-text);
}

.status.closed {
  background: var(--status-closed-bg);
  color: var(--status-closed-text);
}

.date {
  color: var(--text-muted);
  font-size: var(--font-md);
}

.loading,
.error {
  padding: var(--spacing-xl);
  text-align: center;
}

.error {
  color: var(--accent-red);
}

.debug-section {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-lg);
  padding: var(--spacing-md);
  background: var(--bg-elevated);
  border: 1px solid var(--accent-orange);
  border-radius: var(--radius-xl);
}

.debug-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
}

.debug-label {
  font-size: var(--font-xs);
  font-weight: 600;
  color: var(--accent-orange);
  text-transform: uppercase;
  padding: var(--spacing-xs) var(--spacing-sm);
  background: rgba(249, 115, 22, 0.1);
  border-radius: var(--radius-md);
}

.debug-info {
  font-size: var(--font-md);
  color: var(--text-muted);
  font-family: monospace;
}

.debug-controls {
  display: flex;
  align-items: flex-end;
  gap: var(--spacing-md);
  flex-wrap: wrap;
}

.btn-debug {
  background: var(--bg-hover);
  border: 1px solid var(--border-secondary);
  font-size: var(--font-md);
  padding: var(--spacing-sm) 0.75rem;
}

.btn-debug:hover:not(:disabled) {
  background: var(--bg-active);
  border-color: var(--text-disabled);
}

.btn-reset {
  border-color: var(--text-faint);
  color: var(--text-muted);
}

.exclude-tags {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: var(--spacing-sm) 0;
  flex-wrap: wrap;
}

.exclude-label {
  font-size: var(--font-xs);
  color: var(--text-faint);
  text-transform: uppercase;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: var(--font-md);
  color: var(--text-secondary);
  cursor: pointer;
}

.checkbox-label input[type="checkbox"] {
  cursor: pointer;
  accent-color: var(--accent-primary);
}

.checkbox-label:hover {
  color: var(--text-primary);
}

.exclude-actions {
  display: flex;
  gap: var(--spacing-sm);
  margin-left: auto;
}

.debug-results {
  max-height: 400px;
  overflow-y: auto;
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
}

.debug-table {
  font-size: var(--font-sm);
}

.debug-table th,
.debug-table td {
  padding: var(--spacing-sm);
}

.row-num {
  color: var(--text-faint);
  font-family: monospace;
  width: 50px;
}

.tags-cell {
  max-width: 200px;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
}

.mini-tag {
  background: var(--bg-active);
  color: var(--text-muted);
  padding: 0.125rem 0.375rem;
  border-radius: var(--radius-sm);
  font-size: var(--font-xs);
  white-space: nowrap;
}

.no-tags {
  color: var(--text-disabled);
}

.markets-count {
  color: var(--text-muted);
  font-family: monospace;
  text-align: center;
}

.event-row {
  cursor: pointer;
  transition: background 0.15s;
}

.event-row:hover {
  background: var(--bg-tertiary) !important;
}

.event-row.expanded {
  background: var(--bg-elevated);
}

.expand-icon {
  color: var(--text-faint);
  font-size: 0.6rem;
  margin-right: var(--spacing-sm);
}

.link-cell {
  width: 40px;
  text-align: center;
}

.external-link {
  color: var(--accent-blue);
  text-decoration: none;
  font-size: 0.9rem;
  padding: var(--spacing-xs) var(--spacing-sm);
  border-radius: var(--radius-sm);
  transition: background 0.15s;
}

.external-link:hover {
  background: var(--bg-active);
  color: var(--accent-blue-hover);
}

.markets-row {
  background: var(--bg-elevated);
}

.markets-row td {
  padding: 0 !important;
}

.markets-list {
  padding: var(--spacing-sm) var(--spacing-md) var(--spacing-sm) 2.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  border-left: 2px solid var(--border-secondary);
  margin-left: var(--spacing-md);
}

.market-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.375rem var(--spacing-sm);
  background: var(--bg-tertiary);
  border-radius: var(--radius-md);
  font-size: var(--font-sm);
}

.market-item:hover {
  background: #1c2128;
}

.market-question {
  flex: 1;
  color: var(--text-secondary);
}

.market-volume {
  color: var(--text-muted);
  font-family: monospace;
  font-size: var(--font-xs);
}

.status.small {
  font-size: 0.6rem;
  padding: 0.1rem 0.3rem;
}

.tags-section {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-lg);
  padding: var(--spacing-md);
  background: var(--bg-elevated);
  border: 1px solid var(--border-secondary);
  border-radius: var(--radius-xl);
}

.tags-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section-label {
  font-size: var(--font-md);
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
}

.tags-actions {
  display: flex;
  gap: var(--spacing-sm);
}

.btn-sm {
  font-size: var(--font-sm);
  padding: 0.375rem 0.75rem;
}

.btn-primary {
  background: var(--accent-primary);
  color: var(--accent-primary-text);
}

.btn-primary:hover:not(:disabled) {
  background: var(--accent-primary-hover);
}

.subsection-label {
  font-size: var(--font-xs);
  color: var(--text-faint);
  text-transform: uppercase;
  margin-bottom: var(--spacing-sm);
}

.popular-tags-list {
  padding-top: var(--spacing-sm);
  border-top: 1px solid var(--border-muted);
}

.popular-tags-grid {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
  max-height: 200px;
  overflow-y: auto;
}

.popular-tag-chip {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  background: var(--accent-primary);
  border: 1px solid var(--accent-primary-hover);
  border-radius: var(--radius-md);
  padding: 0.375rem 0.625rem;
  font-size: var(--font-sm);
}

.popular-tag-chip .tag-label {
  font-weight: 600;
  color: var(--accent-primary-text);
}

.popular-tag-chip .tag-count {
  background: rgba(0, 0, 0, 0.2);
  color: var(--accent-primary-text);
  padding: 0.125rem 0.375rem;
  border-radius: var(--radius-sm);
  font-size: var(--font-xs);
  font-weight: 600;
}

.popular-tag-chip .tag-id {
  color: rgba(0, 0, 0, 0.5);
  font-family: monospace;
  font-size: var(--font-xs);
}

.sports-list {
  padding-top: var(--spacing-sm);
  border-top: 1px solid var(--border-muted);
}

.sports-grid {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}

.sport-chip {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  background: var(--bg-tertiary);
  border: 1px solid var(--border-secondary);
  border-radius: var(--radius-md);
  padding: 0.375rem 0.625rem;
  font-size: var(--font-sm);
}

.sport-name {
  font-weight: 600;
  color: var(--accent-blue);
  text-transform: uppercase;
}

.sport-tags {
  color: var(--text-faint);
  font-family: monospace;
  font-size: var(--font-xs);
}

.tags-list {
  padding-top: var(--spacing-sm);
  border-top: 1px solid var(--border-muted);
}

.tags-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-sm);
}

.tags-search {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-secondary);
  color: var(--text-secondary);
  padding: 0.375rem 0.625rem;
  border-radius: var(--radius-md);
  font-size: var(--font-sm);
  width: 200px;
}

.tags-search:focus {
  outline: none;
  border-color: var(--accent-blue);
}

.tags-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  max-height: 300px;
  overflow-y: auto;
}

.tag-chip {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-secondary);
  border-radius: var(--radius-md);
  padding: var(--spacing-xs) var(--spacing-sm);
  font-size: var(--font-xs);
}

.tag-id {
  color: var(--text-faint);
  font-family: monospace;
}

.tag-label {
  color: var(--text-secondary);
}

.no-results {
  color: var(--text-faint);
  font-size: var(--font-sm);
  padding: var(--spacing-sm);
}
</style>
