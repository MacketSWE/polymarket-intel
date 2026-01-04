<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router'
import { computed, useSlots } from 'vue'

defineProps<{
  title: string
}>()

const route = useRoute()
const slots = useSlots()

const hasSubnav = computed(() => !!slots.subnav)
</script>

<template>
  <div class="page">
    <header class="header">
      <nav class="nav">
        <RouterLink to="/" :class="['nav-link', { active: route.path === '/' }]">Dashboard</RouterLink>
        <RouterLink to="/new" :class="['nav-link', { active: route.path === '/new' }]">New</RouterLink>
        <RouterLink to="/top" :class="['nav-link', { active: route.path === '/top' }]">Top</RouterLink>
        <RouterLink to="/trades" :class="['nav-link', { active: route.path === '/trades' }]">Trades</RouterLink>
        <RouterLink to="/markets" :class="['nav-link', { active: route.path === '/markets' }]">Markets</RouterLink>
      </nav>
      <div class="header-slot">
        <slot name="header-actions" />
      </div>
    </header>
    <div v-if="hasSubnav" class="subheader">
      <slot name="subnav" />
    </div>
    <main class="main">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  width: 100%;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 var(--spacing-lg);
  border-bottom: 1px solid var(--border-primary);
  background: var(--bg-primary);
  position: sticky;
  top: 0;
  z-index: 100;
  height: 56px;
}

.nav {
  display: flex;
  gap: var(--spacing-sm);
}

.nav-link {
  padding: var(--spacing-sm) var(--spacing-md);
  color: var(--text-muted);
  text-decoration: none;
  font-size: var(--font-base);
  font-weight: 500;
  border-radius: var(--radius-md);
  transition: color 0.15s, background 0.15s;
}

.nav-link:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.nav-link.active {
  color: var(--accent-primary-text);
  background: var(--accent-primary);
}

.header-slot {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
}

.subheader {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-lg);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-primary);
}

.main {
  flex: 1;
  padding: var(--spacing-lg);
  overflow-y: auto;
}
</style>
