import { syncTrades } from './trades-sync.js'
import { syncResolutions } from './resolution-sync.js'
import { syncTopPVTraders, isTableEmpty } from './top-pv-sync.js'
import { syncTopTraderTrades } from './top-trader-trades-sync.js'
import { syncTopTraderTradesResolutions } from './top-trader-trades-resolution-sync.js'
import { syncClaiming } from './claiming-sync.js'

const SYNC_INTERVAL_MS = 10 * 60 * 1000 // 10 minutes
const RESOLUTION_INTERVAL_MS = 15 * 60 * 1000 // 15 minutes
const TOP_PV_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours
const TOP_TRADER_TRADES_INTERVAL_MS = 3 * 60 * 1000 // 3 minutes
const TOP_TRADER_TRADES_RESOLUTION_INTERVAL_MS = 15 * 60 * 1000 // 15 minutes
const CLAIMING_INTERVAL_MS = 30 * 60 * 1000 // 30 minutes

export function startCronJobs() {
  if (process.env.NODE_ENV !== 'production') {
    console.log('Skipping cron jobs (not production)')
    return
  }

  if (process.env.PAUSE_WORKERS === 'true') {
    console.log('Workers paused (PAUSE_WORKERS=true)')
    return
  }

  console.log('Starting cron jobs...')

  // Initial sync
  runTradesSync()

  // Schedule recurring sync
  setInterval(runTradesSync, SYNC_INTERVAL_MS)

  // Resolution sync - starts after 5 minutes, runs every 15 minutes thereafter
  setTimeout(() => {
    runResolutionSync()
    setInterval(runResolutionSync, RESOLUTION_INTERVAL_MS)
  }, 5 * 60 * 1000)

  // Top P/V sync - check if empty and populate immediately, then daily
  runTopPVSyncIfEmpty()
  setInterval(runTopPVSync, TOP_PV_INTERVAL_MS)

  // Top trader trades sync - runs immediately, then every 3 minutes
  runTopTraderTradesSync()
  setInterval(runTopTraderTradesSync, TOP_TRADER_TRADES_INTERVAL_MS)

  // Top trader trades resolution sync - starts after 3 minutes, runs every 15 minutes
  setTimeout(() => {
    runTopTraderTradesResolutionSync()
    setInterval(runTopTraderTradesResolutionSync, TOP_TRADER_TRADES_RESOLUTION_INTERVAL_MS)
  }, 3 * 60 * 1000)

  // Claiming sync - starts after 10 minutes, runs every 30 minutes
  setTimeout(() => {
    runClaimingSync()
    setInterval(runClaimingSync, CLAIMING_INTERVAL_MS)
  }, 10 * 60 * 1000)
}

async function runTradesSync() {
  try {
    console.log(`[TRADES] Starting sync...`)
    const result = await syncTrades()
    console.log(`[TRADES] Done: ${result.fetched} fetched, ${result.uploaded} uploaded`)
  } catch (error) {
    console.error('[TRADES] Sync failed:', error)
  }
}

async function runResolutionSync() {
  try {
    console.log(`[RESOLUTION] Starting sync...`)
    const result = await syncResolutions()
    console.log(`[RESOLUTION] Done: ${result.checked} checked, ${result.resolved} resolved (${result.won}W/${result.lost}L)`)
  } catch (error) {
    console.error('[RESOLUTION] Sync failed:', error)
  }
}

async function runTopPVSyncIfEmpty() {
  try {
    const empty = await isTableEmpty()
    if (empty) {
      console.log(`[TOP-PV] Table empty, populating...`)
      const result = await syncTopPVTraders()
      console.log(`[TOP-PV] Done: ${result.count} traders inserted`)
    } else {
      console.log('[TOP-PV] Table has data, skipping initial sync')
    }
  } catch (error) {
    console.error('[TOP-PV] Initial sync failed:', error)
  }
}

async function runTopPVSync() {
  try {
    console.log(`[TOP-PV] Starting sync...`)
    const result = await syncTopPVTraders()
    console.log(`[TOP-PV] Done: ${result.count} traders updated`)
  } catch (error) {
    console.error('[TOP-PV] Sync failed:', error)
  }
}

async function runTopTraderTradesSync() {
  try {
    console.log(`[TOP-TRADES] Starting sync...`)
    const result = await syncTopTraderTrades()
    console.log(`[TOP-TRADES] Summary: ${result.fetched} BUY trades, ${result.inserted} new, ${result.skipped} already exist`)
  } catch (error) {
    console.error('[TOP-TRADES] Sync failed:', error)
  }
}

async function runTopTraderTradesResolutionSync() {
  try {
    console.log(`[TOP-RESOLUTION] Starting sync...`)
    const result = await syncTopTraderTradesResolutions()
    console.log(`[TOP-RESOLUTION] Done: ${result.checked} checked, ${result.resolved} resolved (${result.won}W/${result.lost}L), ${result.pending} pending`)
  } catch (error) {
    console.error('[TOP-RESOLUTION] Sync failed:', error)
  }
}

async function runClaimingSync() {
  try {
    console.log(`[CLAIMING] Starting sync...`)
    const result = await syncClaiming()
    if (result.checked === 0) {
      console.log(`[CLAIMING] No positions to claim`)
    } else {
      console.log(`[CLAIMING] Done: ${result.checked} checked, ${result.claimed} claimed ($${result.totalValue.toFixed(2)}), ${result.skipped} skipped, ${result.failed} failed`)
    }
  } catch (error) {
    console.error('[CLAIMING] Sync failed:', error)
  }
}
