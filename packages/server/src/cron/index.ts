import { syncTrades } from './trades-sync.js'
import { syncResolutions } from './resolution-sync.js'
import { syncTopPVTraders, isTableEmpty } from './top-pv-sync.js'

const SYNC_INTERVAL_MS = 3 * 60 * 1000 // 3 minutes
const RESOLUTION_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
const TOP_PV_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours

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

  // Top P/V sync - check if empty and populate immediately, then daily
  runTopPVSyncIfEmpty()
  setInterval(runTopPVSync, TOP_PV_INTERVAL_MS)
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

async function runTopPVSyncIfEmpty() {
  try {
    const empty = await isTableEmpty()
    if (empty) {
      console.log(`[${new Date().toISOString()}] Top P/V table empty, populating...`)
      const result = await syncTopPVTraders()
      console.log(`Done: ${result.count} top P/V traders inserted`)
    } else {
      console.log('Top P/V table already has data, skipping initial sync')
    }
  } catch (error) {
    console.error('Top P/V sync (initial) failed:', error)
  }
}

async function runTopPVSync() {
  try {
    console.log(`[${new Date().toISOString()}] Syncing top P/V traders...`)
    const result = await syncTopPVTraders()
    console.log(`Done: ${result.count} top P/V traders updated`)
  } catch (error) {
    console.error('Top P/V sync failed:', error)
  }
}
