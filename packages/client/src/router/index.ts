import { createRouter, createWebHistory } from 'vue-router'
import New from '../pages/New.vue'
import Top from '../pages/Top.vue'
import BigTrades from '../pages/BigTrades.vue'
import Leaderboard from '../pages/Leaderboard.vue'
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
      name: 'home',
      component: BigTrades
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
      path: '/leaderboard',
      name: 'leaderboard',
      component: Leaderboard
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
