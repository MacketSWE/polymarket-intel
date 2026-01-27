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
  claimPositionsBatched,
  preValidatePositions,
  isClaimingConfigured,
  isRateLimited,
  getRateLimitStatus,
  MAX_BATCH_SIZE,
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
 * Main sync function - checks for claimable positions and claims them in a batch
 * Uses a single relayer call for all positions (1 API quota unit)
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

  // Check if we're currently rate limited
  if (isRateLimited()) {
    const status = getRateLimitStatus()
    const resetsInMin = status.resetsIn ? Math.ceil(status.resetsIn / 60000) : 0
    console.log(`[CLAIMING] Rate limited - resets in ${resetsInMin} minutes, skipping this run`)
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

  // Filter out already claimed positions
  const toClaim: ClaimablePosition[] = []
  for (const position of positions) {
    const alreadyClaimed = await wasAlreadyClaimed(position.conditionId)
    if (alreadyClaimed) {
      console.log(`[CLAIMING] Skipping ${position.conditionId.slice(0, 16)}... (already claimed)`)
      result.skipped++
    } else {
      toClaim.push(position)
    }
  }

  if (toClaim.length === 0) {
    console.log('[CLAIMING] All positions already claimed')
    return result
  }

  // Pre-validate positions on-chain (eth_call, no gas cost, no relayer quota)
  const { valid: validated, invalid } = await preValidatePositions(
    toClaim.map(p => ({ conditionId: p.conditionId, negRisk: p.negRisk }))
  )

  // Mark invalid positions as skipped
  if (invalid.length > 0) {
    console.log(`[CLAIMING] ${invalid.length} positions failed pre-validation, skipping`)
    for (const inv of invalid) {
      const pos = toClaim.find(p => p.conditionId === inv.conditionId)
      if (pos) {
        result.skipped++
        result.details.push({
          conditionId: pos.conditionId,
          title: pos.title,
          outcome: pos.outcome,
          value: pos.currentValue,
          status: 'skipped',
          error: inv.error
        })
      }
    }
  }

  // Filter toClaim to only validated positions
  const validToClaim = toClaim.filter(p =>
    validated.some(v => v.conditionId === p.conditionId)
  )

  if (validToClaim.length === 0) {
    console.log('[CLAIMING] No positions passed pre-validation')
    return result
  }

  const totalValue = validToClaim.reduce((sum, p) => sum + p.currentValue, 0)
  console.log(`[CLAIMING] Claiming ${validToClaim.length} validated positions ($${totalValue.toFixed(2)} total) in chunks of ${MAX_BATCH_SIZE}`)

  // Process in chunks of MAX_BATCH_SIZE
  for (let i = 0; i < validToClaim.length; i += MAX_BATCH_SIZE) {
    const chunk = validToClaim.slice(i, i + MAX_BATCH_SIZE)
    const chunkNum = Math.floor(i / MAX_BATCH_SIZE) + 1
    const totalChunks = Math.ceil(validToClaim.length / MAX_BATCH_SIZE)
    console.log(`[CLAIMING] Processing chunk ${chunkNum}/${totalChunks} (${chunk.length} positions)`)

    const batchResult = await claimPositionsBatched(
      chunk.map(p => ({ conditionId: p.conditionId, negRisk: p.negRisk }))
    )

    if (batchResult.success) {
      console.log(`[CLAIMING] Chunk ${chunkNum} SUCCESS! TX: ${batchResult.txHash}`)
      result.claimed += chunk.length
      result.totalValue += chunk.reduce((sum, p) => sum + p.currentValue, 0)

      for (const position of chunk) {
        result.details.push({
          conditionId: position.conditionId,
          title: position.title,
          outcome: position.outcome,
          value: position.currentValue,
          status: 'claimed',
          txHash: batchResult.txHash
        })

        await logClaimAttempt({
          conditionId: position.conditionId,
          marketSlug: position.marketSlug,
          outcome: position.outcome,
          value: position.currentValue,
          status: 'claimed',
          txHash: batchResult.txHash
        })
      }
    } else {
      console.log(`[CLAIMING] Chunk ${chunkNum} FAILED: ${batchResult.error}`)

      // If rate limited, stop processing further chunks
      if (batchResult.rateLimited) {
        console.log(`[CLAIMING] Rate limited, stopping further chunks`)
        // Mark remaining positions (this chunk + future chunks) as failed
        const remaining = validToClaim.slice(i)
        result.failed += remaining.length
        for (const position of remaining) {
          result.details.push({
            conditionId: position.conditionId,
            title: position.title,
            outcome: position.outcome,
            value: position.currentValue,
            status: 'failed',
            error: batchResult.error
          })

          await logClaimAttempt({
            conditionId: position.conditionId,
            marketSlug: position.marketSlug,
            outcome: position.outcome,
            value: position.currentValue,
            status: 'failed',
            error: batchResult.error
          })
        }
        break
      }

      // Check if it's an oracle error - mark as skipped (will retry)
      const isOracleNotReady = batchResult.error?.includes('result for condition not received yet')

      if (isOracleNotReady) {
        console.log(`[CLAIMING] Oracle not ready for chunk ${chunkNum}, will retry next run`)
        result.skipped += chunk.length
        for (const position of chunk) {
          result.details.push({
            conditionId: position.conditionId,
            title: position.title,
            outcome: position.outcome,
            value: position.currentValue,
            status: 'skipped',
            error: 'Oracle not ready'
          })
        }
      } else {
        // Real failure - log it
        result.failed += chunk.length
        for (const position of chunk) {
          result.details.push({
            conditionId: position.conditionId,
            title: position.title,
            outcome: position.outcome,
            value: position.currentValue,
            status: 'failed',
            error: batchResult.error
          })

          await logClaimAttempt({
            conditionId: position.conditionId,
            marketSlug: position.marketSlug,
            outcome: position.outcome,
            value: position.currentValue,
            status: 'failed',
            error: batchResult.error
          })
        }
      }
    }
  }

  console.log(`[CLAIMING] Run complete: ${result.claimed} claimed, ${result.failed} failed, ${result.skipped} skipped`)
  return result
}
