import { syncTrades } from './trades-sync.js'
import { syncResolutions } from './resolution-sync.js'

const SYNC_INTERVAL_MS = 3 * 60 * 1000 // 3 minutes
const RESOLUTION_INTERVAL_MS = 15 * 60 * 1000 // 15 minutes

export function startCronJobs() {
  if (process.env.NODE_ENV !== 'production') {
    console.log('Skipping cron jobs (not production)')
    return
  }

  console.log('Starting cron jobs...')

  // Initial sync
  runTradesSync()

  // Schedule recurring sync
  setInterval(runTradesSync, SYNC_INTERVAL_MS)

  // Resolution sync - starts after 5 minutes, runs every 15 minutes
  setTimeout(() => {
    runResolutionSync()
    setInterval(runResolutionSync, RESOLUTION_INTERVAL_MS)
  }, 5 * 60 * 1000)
}

async function runTradesSync() {
  try {
    console.log(`[${new Date().toISOString()}] Syncing trades...`)
    const result = await syncTrades()
    console.log(`Done: ${result.fetched} fetched, ${result.uploaded} uploaded`)
  } catch (error) {
    console.error('Trades sync failed:', error)
  }
}

async function runResolutionSync() {
  try {
    console.log(`[${new Date().toISOString()}] Syncing resolutions...`)
    const result = await syncResolutions()
    console.log(`Done: ${result.checked} checked, ${result.resolved} resolved (${result.won}W/${result.lost}L)`)
  } catch (error) {
    console.error('Resolution sync failed:', error)
  }
}
