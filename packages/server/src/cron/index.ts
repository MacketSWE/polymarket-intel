import { syncTrades } from './trades-sync.js'

const SYNC_INTERVAL_MS = 3 * 60 * 1000 // 3 minutes

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
}

async function runTradesSync() {
  try {
    console.log(`[${new Date().toISOString()}] Syncing trades...`)
    const result = await syncTrades()
    console.log(`Done: ${result.fetched} trades`)
  } catch (error) {
    console.error('Trades sync failed:', error)
  }
}
