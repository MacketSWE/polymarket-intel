import { createWalletClient, createPublicClient, http, encodeFunctionData, zeroHash, type Hex, type PublicClient } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { polygon } from 'viem/chains'
import { RelayClient, RelayerTxType } from '@polymarket/builder-relayer-client'
import { BuilderConfig } from '@polymarket/builder-signing-sdk'

// Polygon mainnet addresses
const CTF_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045' // Conditional Tokens Framework
const NEG_RISK_CTF_ADDRESS = '0xC5d563A36AE78145C45a50134d48A1215220f80a' // Neg Risk CTF Adapter
const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' // USDC on Polygon
const RELAYER_URL = 'https://relayer-v2.polymarket.com'
const CHAIN_ID = 137

// Private key part 2 (part 1 is in .env) - same as betting.ts
const PRIVATE_KEY_PART2 = '91d067cc47945655f7d9f5614ec'

// ABI for redeemPositions on CTF contract
const ctfRedeemAbi = [
  {
    name: 'redeemPositions',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'collateralToken', type: 'address' },
      { name: 'parentCollectionId', type: 'bytes32' },
      { name: 'conditionId', type: 'bytes32' },
      { name: 'indexSets', type: 'uint256[]' }
    ],
    outputs: []
  }
] as const

// ABI for redeemPositions on NegRisk adapter
const negRiskRedeemAbi = [
  {
    name: 'redeemPositions',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'conditionId', type: 'bytes32' },
      { name: 'amounts', type: 'uint256[]' }
    ],
    outputs: []
  }
] as const

let relayClient: RelayClient | null = null
let publicClient: PublicClient | null = null

// Rate limiting state
interface RateLimitState {
  isLimited: boolean
  resetAt: number | null  // Unix timestamp when limit resets
  remainingUnits: number | null
}

let rateLimitState: RateLimitState = {
  isLimited: false,
  resetAt: null,
  remainingUnits: null
}

// Max positions per batch relayer call
export const MAX_BATCH_SIZE = 8

// Rate limit configuration
const RATE_LIMIT_CONFIG = {
  delayBetweenClaimsMs: 5000,  // 5 seconds between claims
  maxClaimsPerRun: 10,         // Max claims per sync run
  cooldownAfterLimitMs: 60000  // 1 minute cooldown after hitting limit
}

export interface ClaimResult {
  success: boolean
  conditionId: string
  txHash?: string
  error?: string
  rateLimited?: boolean
}

/**
 * Check if we're currently rate limited
 */
export function isRateLimited(): boolean {
  if (!rateLimitState.isLimited) return false

  // Check if the rate limit has expired
  if (rateLimitState.resetAt && Date.now() >= rateLimitState.resetAt) {
    console.log('[Claiming] Rate limit has expired, resetting state')
    rateLimitState = { isLimited: false, resetAt: null, remainingUnits: null }
    return false
  }

  return true
}

/**
 * Get rate limit status for logging/monitoring
 */
export function getRateLimitStatus(): { isLimited: boolean; resetsIn: number | null } {
  if (!rateLimitState.isLimited || !rateLimitState.resetAt) {
    return { isLimited: false, resetsIn: null }
  }

  const resetsIn = Math.max(0, rateLimitState.resetAt - Date.now())
  return { isLimited: true, resetsIn }
}

/**
 * Parse rate limit info from error response
 */
function parseRateLimitError(errorMsg: string): { resetInSeconds: number } | null {
  // Match: "quota exceeded: 0 units remaining, resets in 13432 seconds"
  const match = errorMsg.match(/resets in (\d+) seconds/)
  if (match) {
    return { resetInSeconds: parseInt(match[1], 10) }
  }
  return null
}

/**
 * Handle rate limit error - update state
 */
function handleRateLimitError(errorMsg: string): void {
  const parsed = parseRateLimitError(errorMsg)

  if (parsed) {
    rateLimitState = {
      isLimited: true,
      resetAt: Date.now() + (parsed.resetInSeconds * 1000),
      remainingUnits: 0
    }
    console.log(`[Claiming] Rate limited! Resets in ${parsed.resetInSeconds} seconds (${(parsed.resetInSeconds / 3600).toFixed(1)} hours)`)
  } else {
    // Unknown rate limit format, use default cooldown
    rateLimitState = {
      isLimited: true,
      resetAt: Date.now() + RATE_LIMIT_CONFIG.cooldownAfterLimitMs,
      remainingUnits: 0
    }
    console.log(`[Claiming] Rate limited! Using default cooldown of ${RATE_LIMIT_CONFIG.cooldownAfterLimitMs / 1000} seconds`)
  }
}

/**
 * Get rate limit configuration
 */
export function getRateLimitConfig() {
  return { ...RATE_LIMIT_CONFIG }
}

export interface ClaimablePosition {
  conditionId: string
  asset: string
  marketSlug: string
  title: string
  outcome: string
  size: number
  avgPrice: number
  curPrice: number
  currentValue: number
  cashPnl: number
  negRisk: boolean
  redeemable: boolean
}

/**
 * Get claiming configuration from environment
 */
function getClaimingConfig() {
  const privateKeyPart1 = process.env.POLYGON_PRIVATE_KEY_PART1
  const rpcUrl = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com'
  const funderAddress = process.env.POLYMARKET_FUNDER_ADDRESS
  const signatureType = parseInt(process.env.POLYMARKET_SIGNATURE_TYPE || '0') as 0 | 1 | 2

  // Builder API credentials (required for relayer)
  const builderApiKey = process.env.BUILDER_API_KEY
  const builderApiSecret = process.env.BUILDER_API_SECRET
  const builderPassphrase = process.env.BUILDER_PASSPHRASE

  if (!privateKeyPart1 || !PRIVATE_KEY_PART2) {
    throw new Error('POLYGON_PRIVATE_KEY_PART1 not configured')
  }

  if (!builderApiKey || !builderApiSecret || !builderPassphrase) {
    throw new Error('Builder credentials not configured (BUILDER_API_KEY, BUILDER_API_SECRET, BUILDER_PASSPHRASE)')
  }

  if (!funderAddress) {
    throw new Error('POLYMARKET_FUNDER_ADDRESS not configured')
  }

  // Combine private key parts and ensure 0x prefix for viem
  const fullKey = privateKeyPart1 + PRIVATE_KEY_PART2
  const privateKey = (fullKey.startsWith('0x') ? fullKey : '0x' + fullKey) as Hex

  return {
    privateKey,
    rpcUrl,
    funderAddress,
    signatureType,
    builderCreds: {
      key: builderApiKey,
      secret: builderApiSecret,
      passphrase: builderPassphrase
    }
  }
}

/**
 * Initialize the relay client
 */
async function initializeRelayClient(): Promise<RelayClient> {
  if (relayClient) return relayClient

  const config = getClaimingConfig()

  const account = privateKeyToAccount(config.privateKey)
  const wallet = createWalletClient({
    account,
    chain: polygon,
    transport: http(config.rpcUrl)
  })

  // Determine transaction type based on signature type
  // 0 = EOA (uses SAFE), 1 = Magic/Email wallet (uses PROXY)
  const txType = config.signatureType === 1 ? RelayerTxType.PROXY : RelayerTxType.SAFE

  console.log(`[Claiming] Initializing relay client...`)
  console.log(`[Claiming] Wallet: ${account.address}`)
  console.log(`[Claiming] Funder/Safe: ${config.funderAddress}`)
  console.log(`[Claiming] Transaction type: ${txType === RelayerTxType.SAFE ? 'SAFE' : 'PROXY'}`)

  // Create BuilderConfig with credentials
  const builderConfig = new BuilderConfig({
    localBuilderCreds: {
      key: config.builderCreds.key,
      secret: config.builderCreds.secret,
      passphrase: config.builderCreds.passphrase
    }
  })

  relayClient = new RelayClient(
    RELAYER_URL,
    CHAIN_ID,
    wallet,
    builderConfig,
    txType
  )

  console.log(`[Claiming] Relay client initialized`)
  return relayClient
}

/**
 * Get a read-only public client for eth_call simulations
 */
function getPublicClient(): PublicClient {
  if (publicClient) return publicClient
  const config = getClaimingConfig()
  publicClient = createPublicClient({
    chain: polygon,
    transport: http(config.rpcUrl)
  })
  return publicClient
}

export interface PreValidationResult {
  valid: Array<{ conditionId: string; negRisk: boolean }>
  invalid: Array<{ conditionId: string; error: string }>
}

/**
 * Pre-validate positions using eth_call (read-only, no gas cost, no relayer quota)
 * Filters out positions that would revert on-chain before sending to relayer
 */
export async function preValidatePositions(
  positions: Array<{ conditionId: string; negRisk: boolean }>
): Promise<PreValidationResult> {
  const config = getClaimingConfig()
  const client = getPublicClient()
  const valid: Array<{ conditionId: string; negRisk: boolean }> = []
  const invalid: Array<{ conditionId: string; error: string }> = []

  for (const p of positions) {
    const tx = p.negRisk
      ? createNegRiskRedeemTransaction(p.conditionId)
      : createCtfRedeemTransaction(p.conditionId)
    try {
      await client.call({
        to: tx.to as Hex,
        data: tx.data as Hex,
        account: config.funderAddress as Hex,
      })
      valid.push(p)
    } catch (error) {
      const errorMsg = (error as Error).message || 'eth_call reverted'
      invalid.push({ conditionId: p.conditionId, error: errorMsg })
      console.log(`[Claiming] Pre-validation FAILED for ${p.conditionId.slice(0, 10)}... - skipping`)
    }
  }

  console.log(`[Claiming] Pre-validation: ${valid.length} valid, ${invalid.length} invalid`)
  return { valid, invalid }
}

/**
 * Create a redeem transaction for standard CTF positions
 */
function createCtfRedeemTransaction(conditionId: string) {
  const calldata = encodeFunctionData({
    abi: ctfRedeemAbi,
    functionName: 'redeemPositions',
    args: [
      USDC_ADDRESS as Hex,
      zeroHash,
      conditionId as Hex,
      [1n, 2n] // Index sets for YES (1) and NO (2) outcomes
    ]
  })

  return {
    to: CTF_ADDRESS,
    data: calldata,
    value: '0'
  }
}

/**
 * Create a redeem transaction for neg-risk positions
 * For neg-risk, we need to pass the amounts array [yesAmount, noAmount]
 * Since we don't know exact amounts, we pass max uint256 to redeem all
 */
function createNegRiskRedeemTransaction(conditionId: string) {
  const maxUint256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

  const calldata = encodeFunctionData({
    abi: negRiskRedeemAbi,
    functionName: 'redeemPositions',
    args: [
      conditionId as Hex,
      [maxUint256, maxUint256] // Redeem max amounts for both outcomes
    ]
  })

  return {
    to: NEG_RISK_CTF_ADDRESS,
    data: calldata,
    value: '0'
  }
}

export interface BatchClaimResult {
  success: boolean
  txHash?: string
  error?: string
  rateLimited?: boolean
  positions: Array<{
    conditionId: string
    success: boolean
  }>
}

/**
 * Claim multiple positions in a single batched transaction
 * This uses only 1 API quota unit regardless of how many positions are claimed
 */
export async function claimPositionsBatched(
  positions: Array<{ conditionId: string; negRisk: boolean }>
): Promise<BatchClaimResult> {
  if (positions.length === 0) {
    return {
      success: true,
      positions: []
    }
  }

  console.log(`[Claiming] Batching ${positions.length} positions into single transaction`)

  // Check if we're rate limited before attempting
  if (isRateLimited()) {
    const status = getRateLimitStatus()
    const resetsInMin = status.resetsIn ? Math.ceil(status.resetsIn / 60000) : 0
    console.log(`[Claiming] Skipping batch - rate limited for ${resetsInMin} more minutes`)
    return {
      success: false,
      error: `Rate limited - resets in ${resetsInMin} minutes`,
      rateLimited: true,
      positions: positions.map(p => ({ conditionId: p.conditionId, success: false }))
    }
  }

  try {
    const client = await initializeRelayClient()

    // Create all redeem transactions
    const transactions = positions.map(p =>
      p.negRisk
        ? createNegRiskRedeemTransaction(p.conditionId)
        : createCtfRedeemTransaction(p.conditionId)
    )

    const conditionIds = positions.map(p => p.conditionId.slice(0, 10)).join(', ')
    console.log(`[Claiming] Submitting batched redeem for: ${conditionIds}...`)

    const response = await client.execute(transactions, `Batch redeem ${positions.length} positions`)

    console.log(`[Claiming] Transaction ID: ${response.transactionID}`)
    console.log(`[Claiming] Initial state: ${response.state}`)
    console.log(`[Claiming] Hash: ${response.hash || response.transactionHash || 'pending'}`)
    console.log(`[Claiming] Waiting for confirmation (up to 2 minutes)...`)

    // Poll with longer timeout: 60 polls * 2000ms = 2 minutes
    const result = await client.pollUntilState(
      response.transactionID,
      ['STATE_MINED', 'STATE_CONFIRMED'],
      'STATE_FAILED',
      60,   // maxPolls
      2000  // pollFrequency ms
    )

    if (!result) {
      console.log(`[Claiming] Batch transaction failed or timed out`)
      return {
        success: false,
        error: `Transaction failed or timed out. ID: ${response.transactionID}`,
        positions: positions.map(p => ({ conditionId: p.conditionId, success: false }))
      }
    }

    console.log(`[Claiming] BATCH SUCCESS! TX: ${result.transactionHash}`)

    return {
      success: true,
      txHash: result.transactionHash,
      positions: positions.map(p => ({ conditionId: p.conditionId, success: true }))
    }
  } catch (error) {
    const errorMsg = (error as Error).message
    console.log(`[Claiming] BATCH FAILED: ${errorMsg}`)

    // Check for rate limit errors (429)
    if (errorMsg.includes('429') || errorMsg.includes('Too Many Requests') || errorMsg.includes('quota exceeded')) {
      handleRateLimitError(errorMsg)
      return {
        success: false,
        error: errorMsg,
        rateLimited: true,
        positions: positions.map(p => ({ conditionId: p.conditionId, success: false }))
      }
    }

    return {
      success: false,
      error: errorMsg,
      positions: positions.map(p => ({ conditionId: p.conditionId, success: false }))
    }
  }
}

/**
 * Claim a single position by condition ID
 */
export async function claimPosition(conditionId: string, negRisk: boolean = false): Promise<ClaimResult> {
  console.log(`[Claiming] Claiming position: ${conditionId} (negRisk: ${negRisk})`)

  // Check if we're rate limited before attempting
  if (isRateLimited()) {
    const status = getRateLimitStatus()
    const resetsInMin = status.resetsIn ? Math.ceil(status.resetsIn / 60000) : 0
    console.log(`[Claiming] Skipping - rate limited for ${resetsInMin} more minutes`)
    return {
      success: false,
      conditionId,
      error: `Rate limited - resets in ${resetsInMin} minutes`,
      rateLimited: true
    }
  }

  try {
    const client = await initializeRelayClient()

    const redeemTx = negRisk
      ? createNegRiskRedeemTransaction(conditionId)
      : createCtfRedeemTransaction(conditionId)

    console.log(`[Claiming] Submitting redeem transaction to relayer...`)
    const response = await client.execute([redeemTx], `Redeem position ${conditionId.slice(0, 10)}...`)

    console.log(`[Claiming] Transaction ID: ${response.transactionID}`)
    console.log(`[Claiming] Initial state: ${response.state}`)
    console.log(`[Claiming] Hash: ${response.hash || response.transactionHash || 'pending'}`)
    console.log(`[Claiming] Waiting for confirmation (up to 2 minutes)...`)

    // Poll with longer timeout: 60 polls * 2000ms = 2 minutes
    const result = await client.pollUntilState(
      response.transactionID,
      ['STATE_MINED', 'STATE_CONFIRMED'],
      'STATE_FAILED',
      60,   // maxPolls
      2000  // pollFrequency ms
    )

    if (!result) {
      console.log(`[Claiming] Transaction failed or timed out`)
      return {
        success: false,
        conditionId,
        error: `Transaction failed or timed out. ID: ${response.transactionID}`
      }
    }

    console.log(`[Claiming] SUCCESS! TX: ${result.transactionHash}`)

    return {
      success: true,
      conditionId,
      txHash: result.transactionHash
    }
  } catch (error) {
    const errorMsg = (error as Error).message
    console.log(`[Claiming] FAILED: ${errorMsg}`)

    // Check for rate limit errors (429)
    if (errorMsg.includes('429') || errorMsg.includes('Too Many Requests') || errorMsg.includes('quota exceeded')) {
      handleRateLimitError(errorMsg)
      return {
        success: false,
        conditionId,
        error: errorMsg,
        rateLimited: true
      }
    }

    return {
      success: false,
      conditionId,
      error: errorMsg
    }
  }
}

const DATA_API = 'https://data-api.polymarket.com'

interface ApiPosition {
  proxyWallet: string
  asset: string
  conditionId: string
  size: number
  avgPrice: number
  curPrice: number
  currentValue: number
  cashPnl: number
  redeemable: boolean
  mergeable: boolean
  title: string
  slug: string
  outcome: string
  negativeRisk: boolean
}

/**
 * Get all positions from Polymarket API
 */
export async function getPositions(onlyRedeemable: boolean = false): Promise<ClaimablePosition[]> {
  const config = getClaimingConfig()
  const wallet = config.funderAddress

  console.log(`[Claiming] Fetching positions for ${wallet}...`)

  const response = await fetch(`${DATA_API}/positions?user=${wallet}&limit=500`)
  if (!response.ok) {
    throw new Error(`Failed to fetch positions: ${response.status}`)
  }

  const positions = await response.json() as ApiPosition[]
  console.log(`[Claiming] Found ${positions.length} total positions`)

  let filtered = positions
  if (onlyRedeemable) {
    filtered = positions.filter(p => p.redeemable)
    console.log(`[Claiming] ${filtered.length} are redeemable`)
  }

  return filtered.map(p => ({
    conditionId: p.conditionId,
    asset: p.asset,
    marketSlug: p.slug,
    title: p.title,
    outcome: p.outcome,
    size: p.size,
    avgPrice: p.avgPrice,
    curPrice: p.curPrice,
    currentValue: p.currentValue,
    cashPnl: p.cashPnl,
    negRisk: p.negativeRisk,
    redeemable: p.redeemable
  }))
}

/**
 * Get claimable (redeemable) positions with value > 0 (winning positions)
 */
export async function getClaimablePositions(): Promise<ClaimablePosition[]> {
  const positions = await getPositions(true) // only redeemable
  // Filter to only winning positions (currentValue > 0)
  return positions.filter(p => p.currentValue > 0)
}

/**
 * Get all redeemable positions (including losses worth $0)
 */
export async function getAllRedeemablePositions(): Promise<ClaimablePosition[]> {
  return getPositions(true)
}

/**
 * Claim all winning positions using batched transactions
 * All positions are claimed in a single relayer call (1 API quota unit)
 */
export async function claimAllWinning(): Promise<{
  total: number
  claimed: number
  failed: number
  rateLimited: boolean
  txHash?: string
  results: ClaimResult[]
}> {
  // Check if we're rate limited before starting
  if (isRateLimited()) {
    const status = getRateLimitStatus()
    const resetsInMin = status.resetsIn ? Math.ceil(status.resetsIn / 60000) : 0
    console.log(`[Claiming] Rate limited - resets in ${resetsInMin} minutes`)
    return {
      total: 0,
      claimed: 0,
      failed: 0,
      rateLimited: true,
      results: []
    }
  }

  const positions = await getClaimablePositions()
  console.log(`[Claiming] Found ${positions.length} claimable positions`)

  if (positions.length === 0) {
    return {
      total: 0,
      claimed: 0,
      failed: 0,
      rateLimited: false,
      results: []
    }
  }

  // Batch all positions into a single transaction
  const batchResult = await claimPositionsBatched(
    positions.map(p => ({ conditionId: p.conditionId, negRisk: p.negRisk }))
  )

  // Convert batch result to individual results for compatibility
  const results: ClaimResult[] = batchResult.positions.map(p => ({
    success: p.success,
    conditionId: p.conditionId,
    txHash: p.success ? batchResult.txHash : undefined,
    error: p.success ? undefined : batchResult.error
  }))

  const claimed = batchResult.success ? positions.length : 0
  const failed = batchResult.success ? 0 : positions.length

  return {
    total: positions.length,
    claimed,
    failed,
    rateLimited: batchResult.rateLimited || false,
    txHash: batchResult.txHash,
    results
  }
}

/**
 * Check if claiming is properly configured
 */
export function isClaimingConfigured(): boolean {
  try {
    getClaimingConfig()
    return true
  } catch {
    return false
  }
}

/**
 * Reset the relay client (for re-initialization)
 */
export function resetRelayClient(): void {
  relayClient = null
  console.log('[Claiming] Relay client reset')
}

/**
 * Reset rate limit state (useful for testing or manual override)
 */
export function resetRateLimitState(): void {
  rateLimitState = { isLimited: false, resetAt: null, remainingUnits: null }
  console.log('[Claiming] Rate limit state reset')
}
