<script setup lang="ts">
import { ref, onMounted } from 'vue'
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

const loading = ref(true)
const events = ref<Event[]>([])
const error = ref('')
const expandedEvents = ref<Set<string>>(new Set())
const sortBy = ref<'createdAt' | 'volume24hr'>('createdAt')

function formatUSD(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function toggleEvent(slug: string) {
  if (expandedEvents.value.has(slug)) {
    expandedEvents.value.delete(slug)
  } else {
    expandedEvents.value.add(slug)
  }
  expandedEvents.value = new Set(expandedEvents.value)
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
    params.set('order', sortBy.value)
    params.set('ascending', 'false')
    params.set('closed', 'false')
    // Exclude: sports (1), crypto (21), recurring (101757), hidden (102169)
    params.set('exclude_tag_ids', '1,21,101757,102169')

    const response = await fetch(`/api/polymarket/events?${params}`)
    const data = await response.json()

    if (data.success) {
      events.value = data.data
    } else {
      error.value = data.error || 'Failed to fetch events'
    }
  } catch (e) {
    error.value = 'Failed to fetch events'
    console.error(e)
  }

  loading.value = false
}

function setSortBy(sort: 'createdAt' | 'volume24hr') {
  sortBy.value = sort
  fetchEvents()
}

onMounted(fetchEvents)
</script>

<template>
  <PageLayout title="New Events">
    <div class="page-header">
      <p class="subtitle">200 open events (excluding sports, crypto, recurring, hidden)</p>
      <div class="header-controls">
        <div class="sort-buttons">
          <button
            @click="setSortBy('createdAt')"
            :class="['btn-sort', { active: sortBy === 'createdAt' }]"
            :disabled="loading"
          >
            Newest
          </button>
          <button
            @click="setSortBy('volume24hr')"
            :class="['btn-sort', { active: sortBy === 'volume24hr' }]"
            :disabled="loading"
          >
            Top Volume
          </button>
        </div>
        <button @click="fetchEvents" :disabled="loading" class="btn">
          {{ loading ? 'Loading...' : 'Refresh' }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="loading">Loading events...</div>
    <div v-else-if="error" class="error">{{ error }}</div>

    <div v-else class="events-container">
      <table class="table">
        <thead>
          <tr>
            <th>#</th>
            <th>Created</th>
            <th>Title</th>
            <th>Tags</th>
            <th>Markets</th>
            <th>24h Vol</th>
            <th>Link</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="(event, i) in events" :key="event.slug">
            <tr
              :class="['event-row', { expanded: expandedEvents.has(event.slug) }]"
              @click="toggleEvent(event.slug)"
            >
              <td class="row-num">{{ i + 1 }}</td>
              <td class="date">{{ formatDate(event.createdAt) }}</td>
              <td class="title">
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
              <td class="volume">{{ formatUSD(event.volume24hr || 0) }}</td>
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
                    <span :class="['status', market.closed ? 'closed' : 'open']">
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
  </PageLayout>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-lg);
}

.subtitle {
  color: var(--text-muted);
  font-size: var(--font-base);
  margin: 0;
}

.header-controls {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
}

.sort-buttons {
  display: flex;
  gap: var(--spacing-xs);
  background: var(--bg-tertiary);
  padding: var(--spacing-xs);
  border-radius: var(--radius-lg);
}

.btn-sort {
  background: transparent;
  color: var(--text-muted);
  border: none;
  padding: 0.375rem 0.75rem;
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: var(--font-md);
  font-weight: 500;
  transition: all 0.15s;
}

.btn-sort:hover:not(:disabled) {
  color: var(--text-secondary);
  background: var(--bg-active);
}

.btn-sort.active {
  background: var(--accent-primary);
  color: var(--accent-primary-text);
}

.btn-sort:disabled {
  cursor: not-allowed;
  opacity: 0.6;
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

.loading,
.error {
  padding: var(--spacing-xl);
  text-align: center;
}

.error {
  color: var(--accent-red);
}

.events-container {
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-xl);
  overflow: hidden;
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-md);
}

.table th,
.table td {
  padding: 0.625rem 0.75rem;
  text-align: left;
  border-bottom: 1px solid var(--border-primary);
}

.table th {
  font-weight: 600;
  color: var(--text-muted);
  font-size: var(--font-sm);
  text-transform: uppercase;
  background: var(--bg-elevated);
}

.row-num {
  color: var(--text-faint);
  font-family: monospace;
  width: 40px;
}

.date {
  color: var(--text-muted);
  font-size: var(--font-sm);
  white-space: nowrap;
}

.title {
  font-weight: 500;
  color: var(--text-secondary);
}

.expand-icon {
  color: var(--text-faint);
  font-size: var(--font-xs);
  margin-right: var(--spacing-sm);
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

.volume {
  color: var(--text-muted);
  font-family: monospace;
}

.link-cell {
  width: 40px;
  text-align: center;
}

.external-link {
  color: var(--accent-blue);
  text-decoration: none;
  font-size: var(--font-lg);
  padding: var(--spacing-xs) var(--spacing-sm);
  border-radius: var(--radius-sm);
  transition: background 0.15s;
}

.external-link:hover {
  background: var(--bg-active);
  color: var(--accent-blue-hover);
}

.event-row {
  cursor: pointer;
  transition: background 0.15s;
}

.event-row:hover {
  background: var(--bg-tertiary);
}

.event-row.expanded {
  background: var(--bg-elevated);
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
  font-size: var(--font-sm);
}

.status {
  font-size: var(--font-xs);
  padding: 0.1rem 0.3rem;
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
</style>
