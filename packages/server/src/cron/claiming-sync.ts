/**
 * Claiming Sync Worker
 *
 * Automatically claims winning positions when they become redeemable on-chain.
 *
 * Logic:
 * 1. Fetch all positions from Polymarket API
 * 2. Filter to redeemable positions with value > 0 (winners)
 * 3. Try to claim each one
 * 4. Skip if oracle hasn't posted result yet (will retry next run)
 * 5. Log successes to database
 */

import {
  getClaimablePositions,
  claimPosition,
  isClaimingConfigured,
  type ClaimablePosition
} from '../services/claiming.js'
import { supabaseAdmin } from '../services/supabase.js'

interface ClaimingSyncResult {
  checked: number
  claimed: number
  failed: number
  skipped: number  // Oracle not ready yet
  totalValue: number
  details: Array<{
    conditionId: string
    title: string
    outcome: string
    value: number
    status: 'claimed' | 'failed' | 'skipped'
    txHash?: string
    error?: string
  }>
}

/**
 * Check if a position was already claimed (to avoid duplicate attempts)
 */
async function wasAlreadyClaimed(conditionId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('claim_log')
    .select('id')
    .eq('condition_id', conditionId)
    .eq('status', 'claimed')
    .limit(1)

  return (data?.length || 0) > 0
}

/**
 * Log a claim attempt to the database
 */
async function logClaimAttempt(params: {
  conditionId: string
  marketSlug: string
  outcome: string
  value: number
  status: 'claimed' | 'failed' | 'skipped'
  txHash?: string
  error?: string
}): Promise<void> {
  try {
    await supabaseAdmin.from('claim_log').insert({
      condition_id: params.conditionId,
      market_slug: params.marketSlug,
      outcome: params.outcome,
      value: params.value,
      status: params.status,
      tx_hash: params.txHash || null,
      error_message: params.error || null,
      claimed_at: params.status === 'claimed' ? new Date().toISOString() : null
    })
  } catch (error) {
    console.error('[CLAIMING] Failed to log claim attempt:', (error as Error).message)
  }
}

/**
 * Main sync function - checks for claimable positions and claims them
 */
export async function syncClaiming(): Promise<ClaimingSyncResult> {
  const result: ClaimingSyncResult = {
    checked: 0,
    claimed: 0,
    failed: 0,
    skipped: 0,
    totalValue: 0,
    details: []
  }

  // Check if claiming is configured
  if (!isClaimingConfigured()) {
    console.log('[CLAIMING] Not configured, skipping')
    return result
  }

  // Get claimable positions (redeemable with value > 0)
  let positions: ClaimablePosition[]
  try {
    positions = await getClaimablePositions()
  } catch (error) {
    console.error('[CLAIMING] Failed to fetch positions:', (error as Error).message)
    return result
  }

  result.checked = positions.length

  if (positions.length === 0) {
    console.log('[CLAIMING] No winning positions to claim')
    return result
  }

  console.log(`[CLAIMING] Found ${positions.length} winning positions to claim`)

  // Try to claim each position
  for (const position of positions) {
    // Check if already claimed
    const alreadyClaimed = await wasAlreadyClaimed(position.conditionId)
    if (alreadyClaimed) {
      console.log(`[CLAIMING] Skipping ${position.conditionId.slice(0, 16)}... (already claimed)`)
      result.skipped++
      continue
    }

    console.log(`[CLAIMING] Claiming: ${position.title.slice(0, 40)}... ($${position.currentValue.toFixed(2)})`)

    const claimResult = await claimPosition(position.conditionId, position.negRisk)

    if (claimResult.success) {
      console.log(`[CLAIMING] SUCCESS: ${claimResult.txHash}`)
      result.claimed++
      result.totalValue += position.currentValue

      result.details.push({
        conditionId: position.conditionId,
        title: position.title,
        outcome: position.outcome,
        value: position.currentValue,
        status: 'claimed',
        txHash: claimResult.txHash
      })

      await logClaimAttempt({
        conditionId: position.conditionId,
        marketSlug: position.marketSlug,
        outcome: position.outcome,
        value: position.currentValue,
        status: 'claimed',
        txHash: claimResult.txHash
      })
    } else {
      // Check if it's an "oracle not ready" error
      const isOracleNotReady = claimResult.error?.includes('result for condition not received yet')

      if (isOracleNotReady) {
        console.log(`[CLAIMING] SKIPPED (oracle not ready): ${position.conditionId.slice(0, 16)}...`)
        result.skipped++

        result.details.push({
          conditionId: position.conditionId,
          title: position.title,
          outcome: position.outcome,
          value: position.currentValue,
          status: 'skipped',
          error: 'Oracle not ready'
        })
        // Don't log to DB - will retry next run
      } else {
        console.log(`[CLAIMING] FAILED: ${claimResult.error}`)
        result.failed++

        result.details.push({
          conditionId: position.conditionId,
          title: position.title,
          outcome: position.outcome,
          value: position.currentValue,
          status: 'failed',
          error: claimResult.error
        })

        await logClaimAttempt({
          conditionId: position.conditionId,
          marketSlug: position.marketSlug,
          outcome: position.outcome,
          value: position.currentValue,
          status: 'failed',
          error: claimResult.error
        })
      }
    }

    // Small delay between claims to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  return result
}
