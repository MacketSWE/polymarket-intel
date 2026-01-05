import { createRouter, createWebHistory } from 'vue-router'
import Dashboard from '../pages/Dashboard.vue'
import Markets from '../pages/Markets.vue'
import New from '../pages/New.vue'
import Top from '../pages/Top.vue'
import Trades from '../pages/Trades.vue'
import Trader from '../pages/Trader.vue'
import Login from '../pages/Login.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: Login,
      meta: { public: true }
    },
    {
      path: '/',
      name: 'dashboard',
      component: Dashboard
    },
    {
      path: '/markets',
      name: 'markets',
      component: Markets
    },
    {
      path: '/new',
      name: 'new',
      component: New
    },
    {
      path: '/top',
      name: 'top',
      component: Top
    },
    {
      path: '/trades',
      name: 'trades',
      component: Trades
    },
    {
      path: '/trader',
      name: 'trader',
      component: Trader
    }
  ]
})

router.beforeEach(async (to) => {
  if (to.meta.public) return true

  try {
    const res = await fetch('/api/auth/me')
    const data = await res.json()
    if (!data.success) return '/login'
    return true
  } catch {
    return '/login'
  }
})

export default router
