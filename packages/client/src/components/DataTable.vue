<script setup lang="ts" generic="T extends Record<string, unknown>">
import { ref, computed } from 'vue'

interface Column<T> {
  key: keyof T | string
  label: string
  sortable?: boolean
  align?: 'left' | 'center' | 'right'
  width?: string
  format?: (value: unknown, row: T) => string
}

const props = defineProps<{
  columns: Column<T>[]
  data: T[]
  rowKey: keyof T
  defaultSort?: string
  defaultSortDir?: 'asc' | 'desc'
}>()

const emit = defineEmits<{
  rowClick: [row: T]
}>()

const sortKey = ref<string>(props.defaultSort || '')
const sortDir = ref<'asc' | 'desc'>(props.defaultSortDir || 'desc')

const sortedData = computed(() => {
  if (!sortKey.value) return props.data

  const key = sortKey.value
  const dir = sortDir.value === 'asc' ? 1 : -1

  return [...props.data].sort((a, b) => {
    const aVal = getNestedValue(a, key)
    const bVal = getNestedValue(b, key)

    if (aVal == null && bVal == null) return 0
    if (aVal == null) return 1
    if (bVal == null) return -1

    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return aVal.localeCompare(bVal) * dir
    }

    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return (aVal - bVal) * dir
    }

    // Date comparison
    if (aVal instanceof Date && bVal instanceof Date) {
      return (aVal.getTime() - bVal.getTime()) * dir
    }

    // Try parsing as dates
    const aDate = new Date(aVal as string)
    const bDate = new Date(bVal as string)
    if (!isNaN(aDate.getTime()) && !isNaN(bDate.getTime())) {
      return (aDate.getTime() - bDate.getTime()) * dir
    }

    return String(aVal).localeCompare(String(bVal)) * dir
  })
})

function getNestedValue(obj: T, path: string): unknown {
  return path.split('.').reduce((acc: unknown, part) => {
    if (acc && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[part]
    }
    return undefined
  }, obj)
}

function toggleSort(key: string) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = 'desc'
  }
}

function getValue(row: T, col: Column<T>): string {
  const val = getNestedValue(row, col.key as string)
  if (col.format) {
    return col.format(val, row)
  }
  if (val == null) return '-'
  return String(val)
}
</script>

<template>
  <div class="table-container">
    <table class="data-table">
      <thead>
        <tr>
          <th
            v-for="col in columns"
            :key="String(col.key)"
            :class="[
              'th',
              col.align ? `align-${col.align}` : '',
              { sortable: col.sortable, sorted: sortKey === col.key }
            ]"
            :style="col.width ? { width: col.width } : {}"
            @click="col.sortable && toggleSort(col.key as string)"
          >
            <span class="th-content">
              {{ col.label }}
              <span v-if="col.sortable" class="sort-icon">
                <template v-if="sortKey === col.key">
                  {{ sortDir === 'asc' ? '↑' : '↓' }}
                </template>
                <template v-else>⇅</template>
              </span>
            </span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in sortedData"
          :key="String(row[rowKey])"
          class="tr"
          @click="emit('rowClick', row)"
        >
          <td
            v-for="col in columns"
            :key="String(col.key)"
            :class="['td', col.align ? `align-${col.align}` : '']"
          >
            <slot :name="`cell-${String(col.key)}`" :value="getNestedValue(row, col.key as string)" :row="row">
              {{ getValue(row, col) }}
            </slot>
          </td>
        </tr>
        <tr v-if="sortedData.length === 0">
          <td :colspan="columns.length" class="empty">
            <slot name="empty">No data</slot>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.table-container {
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-xl);
  overflow: hidden;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-md);
}

.th,
.td {
  padding: 0.625rem 0.75rem;
  text-align: left;
  border-bottom: 1px solid var(--border-primary);
}

.th {
  font-weight: 600;
  color: var(--text-muted);
  font-size: var(--font-sm);
  text-transform: uppercase;
  background: var(--bg-elevated);
  user-select: none;
}

.th.sortable {
  cursor: pointer;
  transition: color 0.15s;
}

.th.sortable:hover {
  color: var(--text-primary);
}

.th.sorted {
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

.th.sorted .sort-icon {
  opacity: 1;
}

.tr {
  transition: background 0.15s;
}

.tr:hover {
  background: var(--bg-tertiary);
}

.tr:last-child .td {
  border-bottom: none;
}

.align-center {
  text-align: center;
}

.align-center .th-content {
  justify-content: center;
}

.align-right {
  text-align: right;
}

.align-right .th-content {
  justify-content: flex-end;
}

.empty {
  text-align: center;
  color: var(--text-muted);
  padding: var(--spacing-xl);
}
</style>
