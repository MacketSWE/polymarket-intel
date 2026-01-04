<script setup lang="ts">
import { ref, onMounted } from 'vue'

const message = ref('Loading...')

onMounted(async () => {
  try {
    const response = await fetch('/api/health')
    const data = await response.json()
    message.value = data.message
  } catch {
    message.value = 'Failed to connect to server'
  }
})
</script>

<template>
  <div class="app">
    <h1>Polymarket</h1>
    <p>Server says: {{ message }}</p>
  </div>
</template>

<style scoped>
.app {
  font-family: system-ui, sans-serif;
  text-align: center;
  padding: 2rem;
}
</style>
