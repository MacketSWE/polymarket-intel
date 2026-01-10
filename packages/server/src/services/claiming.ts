import { createWalletClient, http, encodeFunctionData, zeroHash, type Hex } from 'viem'
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

export interface ClaimResult {
  success: boolean
  conditionId: string
  txHash?: string
  error?: string
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

/**
 * Claim a single position by condition ID
 */
export async function claimPosition(conditionId: string, negRisk: boolean = false): Promise<ClaimResult> {
  console.log(`[Claiming] Claiming position: ${conditionId} (negRisk: ${negRisk})`)

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
 * Claim all winning positions
 */
export async function claimAllWinning(): Promise<{
  total: number
  claimed: number
  failed: number
  results: ClaimResult[]
}> {
  const positions = await getClaimablePositions()
  console.log(`[Claiming] Found ${positions.length} claimable positions`)

  const results: ClaimResult[] = []
  let claimed = 0
  let failed = 0

  for (const position of positions) {
    const result = await claimPosition(position.conditionId, position.negRisk)
    results.push(result)

    if (result.success) {
      claimed++
    } else {
      failed++
    }

    // Small delay between claims to avoid rate limiting
    if (positions.length > 1) {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }

  return {
    total: positions.length,
    claimed,
    failed,
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
