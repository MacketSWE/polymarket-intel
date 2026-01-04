import { createRouter, createWebHistory } from 'vue-router'
import Dashboard from '../pages/Dashboard.vue'
import Markets from '../pages/Markets.vue'
import New from '../pages/New.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
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
    }
  ]
})

export default router
