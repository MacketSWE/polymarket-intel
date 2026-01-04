<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import PageLayout from '../components/PageLayout.vue'

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
  createdAt: string
}

type Category = 'start' | 'sports' | 'crypto'

const loading = ref(true)
const rawEvents = ref<Event[]>([])
const error = ref('')
const selectedEvent = ref<Event | null>(null)
const sortKey = ref<string>('volume24hr')
const sortDir = ref<'asc' | 'desc'>('desc')
const category = ref<Category>('start')
const currentUtc = ref('')
let clockInterval: number | null = null

function updateClock() {
  const now = new Date()
  currentUtc.value = now.toISOString().slice(11, 19) + ' UTC'
}

// Client-side sorted events
const events = computed(() => {
  const sorted = [...rawEvents.value]
  const dir = sortDir.value === 'asc' ? 1 : -1

  sorted.sort((a, b) => {
    if (sortKey.value === 'volume24hr') {
      return ((b.volume24hr || 0) - (a.volume24hr || 0)) * (sortDir.value === 'asc' ? -1 : 1)
    } else if (sortKey.value === 'createdAt') {
      return (new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) * (sortDir.value === 'asc' ? -1 : 1)
    } else if (sortKey.value === 'title') {
      return a.title.localeCompare(b.title) * dir
    } else if (sortKey.value === 'markets') {
      return ((a.markets?.length || 0) - (b.markets?.length || 0)) * dir
    }
    return 0
  })
  return sorted
})

function toggleSort(key: string) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = key === 'title' ? 'asc' : 'desc'
  }
}

// Category descriptions
const categoryInfo = {
  start: { label: 'Start', desc: 'Excluding sports, crypto, recurring, hidden' },
  sports: { label: 'Sports', desc: 'Sports events only' },
  crypto: { label: 'Crypto', desc: 'Crypto events only' }
}

function formatUSD(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })
}

function selectEvent(event: Event) {
  selectedEvent.value = selectedEvent.value?.slug === event.slug ? null : event
}

function getEventUrl(slug: string) {
  return `https://polymarket.com/event/${slug}`
}

function getMarketUrl(eventSlug: string, marketSlug: string) {
  return `https://polymarket.com/event/${eventSlug}/${marketSlug}`
}

async function fetchEvents() {
  loading.value = true
  error.value = ''

  try {
    const params = new URLSearchParams()
    params.set('limit', '200')
    params.set('order', 'volume24hr')
    params.set('ascending', 'false')
    params.set('closed', 'false')

    // Different filters per category
    if (category.value === 'start') {
      params.set('exclude_tag_ids', '1,21,101757,102169')
    } else if (category.value === 'sports') {
      params.set('tag_id', '1')
      params.set('exclude_tag_ids', '101757,102169')
    } else if (category.value === 'crypto') {
      params.set('tag_id', '21')
      params.set('exclude_tag_ids', '101757,102169')
    }

    const response = await fetch(`/api/polymarket/events?${params}`)
    const data = await response.json()

    if (data.success) {
      rawEvents.value = data.data
    } else {
      error.value = data.error || 'Failed to fetch events'
    }
  } catch (e) {
    error.value = 'Failed to fetch events'
    console.error(e)
  }

  loading.value = false
}

function setCategory(cat: Category) {
  category.value = cat
}

// Re-fetch when category changes
watch(category, () => {
  fetchEvents()
})

onMounted(() => {
  fetchEvents()
  updateClock()
  clockInterval = window.setInterval(updateClock, 1000)
})

onUnmounted(() => {
  if (clockInterval) clearInterval(clockInterval)
})
</script>

<template>
  <PageLayout title="Top Events">
    <template #subnav>
      <button
        v-for="cat in (['start', 'sports', 'crypto'] as Category[])"
        :key="cat"
        @click="setCategory(cat)"
        :class="['subnav-btn', { active: category === cat }]"
      >
        {{ categoryInfo[cat].label }}
      </button>
      <span class="subnav-spacer"></span>
      <span class="utc-clock">{{ currentUtc }}</span>
      <button @click="fetchEvents" :disabled="loading" class="btn btn-sm">
        {{ loading ? 'Loading...' : 'Refresh' }}
      </button>
    </template>

    <div v-if="loading" class="loading">Loading events...</div>
    <div v-else-if="error" class="error">{{ error }}</div>

    <div v-else class="content-layout">
      <!-- Events Table -->
      <div class="events-container">
        <div class="table-header">
          <span class="subtitle">{{ events.length }} events by 24h volume</span>
        </div>
        <div class="table-scroll">
          <table class="table">
            <thead>
              <tr>
                <th class="th-static">#</th>
                <th class="th-sortable" :class="{ sorted: sortKey === 'volume24hr' }" @click="toggleSort('volume24hr')">
                  <span class="th-content">24h Vol <span class="sort-icon">{{ sortKey === 'volume24hr' ? (sortDir === 'asc' ? '↑' : '↓') : '⇅' }}</span></span>
                </th>
                <th class="th-sortable" :class="{ sorted: sortKey === 'title' }" @click="toggleSort('title')">
                  <span class="th-content">Title <span class="sort-icon">{{ sortKey === 'title' ? (sortDir === 'asc' ? '↑' : '↓') : '⇅' }}</span></span>
                </th>
                <th class="th-sortable" :class="{ sorted: sortKey === 'markets' }" @click="toggleSort('markets')">
                  <span class="th-content">Mkts <span class="sort-icon">{{ sortKey === 'markets' ? (sortDir === 'asc' ? '↑' : '↓') : '⇅' }}</span></span>
                </th>
                <th class="th-sortable" :class="{ sorted: sortKey === 'createdAt' }" @click="toggleSort('createdAt')">
                  <span class="th-content">Created <span class="sort-icon">{{ sortKey === 'createdAt' ? (sortDir === 'asc' ? '↑' : '↓') : '⇅' }}</span></span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(event, i) in events"
                :key="event.slug"
                :class="['event-row', { selected: selectedEvent?.slug === event.slug }]"
                @click="selectEvent(event)"
              >
                <td class="row-num">{{ i + 1 }}</td>
                <td class="volume">{{ formatUSD(event.volume24hr || 0) }}</td>
                <td class="title-cell">{{ event.title }}</td>
                <td class="markets-count">{{ event.markets?.length || 0 }}</td>
                <td class="date">{{ formatDate(event.createdAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Detail Panel -->
      <div class="detail-panel" :class="{ open: selectedEvent }">
        <template v-if="selectedEvent">
          <div class="panel-header">
            <h3 class="panel-title">{{ selectedEvent.title }}</h3>
            <a :href="getEventUrl(selectedEvent.slug)" target="_blank" class="external-link">↗</a>
            <button class="close-btn" @click="selectedEvent = null">×</button>
          </div>

          <div class="panel-meta">
            <span class="meta-item">{{ formatUSD(selectedEvent.volume24hr || 0) }} 24h vol</span>
            <span class="meta-item">Created {{ formatDate(selectedEvent.createdAt) }}</span>
          </div>

          <div v-if="selectedEvent.tags && selectedEvent.tags.length > 0" class="panel-tags">
            <span v-for="tag in selectedEvent.tags" :key="tag.id" class="mini-tag">{{ tag.label }}</span>
          </div>

          <div class="panel-section">
            <h4 class="section-title">Markets ({{ selectedEvent.markets?.length || 0 }})</h4>
            <div class="markets-list">
              <div v-for="market in selectedEvent.markets" :key="market.slug" class="market-item">
                <div class="market-main">
                  <span :class="['status', market.closed ? 'closed' : 'open']">
                    {{ market.closed ? 'C' : 'O' }}
                  </span>
                  <span class="market-question">{{ market.question }}</span>
                </div>
                <div class="market-actions">
                  <span class="market-volume">{{ formatUSD(market.volume24hr || 0) }}</span>
                  <a :href="getMarketUrl(selectedEvent.slug, market.slug)" target="_blank" class="external-link small">↗</a>
                </div>
              </div>
            </div>
          </div>
        </template>
        <div v-else class="panel-empty">
          Select an event to view details
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

.utc-clock {
  font-family: monospace;
  font-size: var(--font-sm);
  color: var(--text-muted);
  padding: var(--spacing-xs) var(--spacing-sm);
  background: var(--bg-tertiary);
  border-radius: var(--radius-md);
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

.events-container {
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

.row-num {
  color: var(--text-faint);
  font-family: monospace;
  width: 36px;
}

.volume {
  color: var(--accent-green);
  font-family: monospace;
  font-weight: 600;
  width: 100px;
}

.title-cell {
  font-weight: 500;
  color: var(--text-secondary);
  max-width: 400px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.markets-count {
  color: var(--text-muted);
  font-family: monospace;
  text-align: center;
  width: 50px;
}

.date {
  color: var(--text-muted);
  font-size: var(--font-sm);
  white-space: nowrap;
  width: 120px;
}

.event-row {
  cursor: pointer;
  transition: background 0.15s;
}

.event-row:hover {
  background: var(--bg-tertiary);
}

.event-row.selected {
  background: var(--bg-active);
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
  align-items: flex-start;
  gap: var(--spacing-sm);
  padding: var(--spacing-md);
  border-bottom: 1px solid var(--border-primary);
  background: var(--bg-elevated);
}

.panel-title {
  flex: 1;
  font-size: var(--font-base);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  line-height: 1.4;
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

.meta-item {
  font-size: var(--font-sm);
  color: var(--text-muted);
}

.panel-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
  padding: var(--spacing-sm) var(--spacing-md);
  border-bottom: 1px solid var(--border-primary);
}

.mini-tag {
  background: var(--bg-active);
  color: var(--text-muted);
  padding: 0.125rem 0.375rem;
  border-radius: var(--radius-sm);
  font-size: var(--font-xs);
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

.markets-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 var(--spacing-md) var(--spacing-md);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.market-item {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  padding: var(--spacing-sm);
  background: var(--bg-tertiary);
  border-radius: var(--radius-md);
  font-size: var(--font-sm);
}

.market-item:hover {
  background: var(--bg-active);
}

.market-main {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-sm);
}

.market-question {
  flex: 1;
  color: var(--text-secondary);
  line-height: 1.4;
}

.market-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-left: 1.5rem;
}

.market-volume {
  color: var(--text-muted);
  font-family: monospace;
  font-size: var(--font-xs);
}

.status {
  font-size: var(--font-xs);
  padding: 0.1rem 0.3rem;
  border-radius: var(--radius-sm);
  text-transform: uppercase;
  font-weight: 600;
  flex-shrink: 0;
}

.status.open {
  background: var(--status-open-bg);
  color: var(--status-open-text);
}

.status.closed {
  background: var(--status-closed-bg);
  color: var(--status-closed-text);
}

.external-link {
  color: var(--accent-blue);
  text-decoration: none;
  font-size: var(--font-lg);
  padding: var(--spacing-xs);
  border-radius: var(--radius-sm);
  transition: background 0.15s;
  flex-shrink: 0;
}

.external-link:hover {
  background: var(--bg-active);
  color: var(--accent-blue-hover);
}

.external-link.small {
  font-size: var(--font-base);
  padding: 0;
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
