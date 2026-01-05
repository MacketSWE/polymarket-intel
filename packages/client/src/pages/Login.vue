<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function handleLogin() {
  error.value = ''
  loading.value = true

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.value, password: password.value })
    })

    const data = await res.json()

    if (!data.success) {
      error.value = data.error || 'Login failed'
      loading.value = false
      return
    }

    router.push('/')
  } catch (e) {
    error.value = 'Connection error'
    loading.value = false
  }
}
</script>

<template>
  <div class="login-container">
    <div class="login-box">
      <h1>Polymarket Insights</h1>
      <form @submit.prevent="handleLogin">
        <div class="field">
          <label for="email">Email</label>
          <input
            id="email"
            v-model="email"
            type="email"
            placeholder="you@example.com"
            required
            autocomplete="email"
          />
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input
            id="password"
            v-model="password"
            type="password"
            placeholder="Password"
            required
            autocomplete="current-password"
          />
        </div>
        <div v-if="error" class="error">{{ error }}</div>
        <button type="submit" :disabled="loading">
          {{ loading ? 'Signing in...' : 'Sign In' }}
        </button>
      </form>
    </div>
  </div>
</template>

<style scoped>
.login-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-primary);
}

.login-box {
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-xl);
  padding: var(--spacing-xl);
  width: 100%;
  max-width: 400px;
}

h1 {
  margin: 0 0 var(--spacing-lg);
  font-size: var(--font-xl);
  color: var(--text-primary);
  text-align: center;
}

form {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

label {
  font-size: var(--font-sm);
  color: var(--text-muted);
}

input {
  padding: var(--spacing-sm) var(--spacing-md);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: var(--font-base);
}

input:focus {
  outline: none;
  border-color: var(--accent-primary);
}

input::placeholder {
  color: var(--text-disabled);
}

button {
  margin-top: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--accent-primary);
  color: var(--accent-primary-text);
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--font-base);
  font-weight: 500;
  cursor: pointer;
}

button:hover {
  background: var(--accent-primary-hover);
}

button:disabled {
  background: #444;
  cursor: not-allowed;
}

.error {
  color: var(--accent-red);
  font-size: var(--font-sm);
  text-align: center;
}
</style>
