import { Wallet } from '@ethersproject/wallet'
import { ClobClient } from '@polymarket/clob-client'
import { Side, OrderType, AssetType } from '@polymarket/clob-client'
import type { ApiKeyCreds } from '@polymarket/clob-client'
import type { BetParams, BetResult, OpenOrder, Balances, ApiCredentials, MarketInfo } from './betting.types.js'
import type { BetLog } from '../db/tables/bet_log/type.js'
import { supabaseAdmin } from './supabase.js'

const CLOB_HOST = 'https://clob.polymarket.com'
const GAMMA_API = 'https://gamma-api.polymarket.com'
const CHAIN_ID = 137 // Polygon mainnet

// Private key part 2 (part 1 is in .env)
const PRIVATE_KEY_PART2 = '91d067cc47945655f7d9f5614ec'

let clobClient: ClobClient | null = null
let cachedCreds: ApiKeyCreds | null = null

interface GammaMarket {
  conditionId: string
  clobTokenIds: string
  outcomePrices: string
  outcomes: string
  question: string
  slug: string
  active: boolean
  closed: boolean
  neg_risk?: boolean
}

interface ClobMarket {
  condition_id: string
  tokens: Array<{
    token_id: string
    outcome: string
    price: number
    winner?: boolean
  }>
  min_tick_size: string
  neg_risk: boolean
}

/**
 * Get betting configuration from environment
 */
function getBettingConfig() {
  const privateKeyPart1 = process.env.POLYGON_PRIVATE_KEY_PART1
  const rpcUrl = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com'
  const funderAddress = process.env.POLYMARKET_FUNDER_ADDRESS
  const signatureType = parseInt(process.env.POLYMARKET_SIGNATURE_TYPE || '0') as 0 | 1 | 2

  if (!privateKeyPart1 || !PRIVATE_KEY_PART2) {
    throw new Error('POLYGON_PRIVATE_KEY_PART1 not set or PRIVATE_KEY_PART2 not configured')
  }

  const privateKey = privateKeyPart1 + PRIVATE_KEY_PART2

  return { privateKey, rpcUrl, funderAddress, signatureType }
}

/**
 * Initialize or get existing CLOB client
 */
export async function initializeClobClient(): Promise<ClobClient> {
  if (clobClient) return clobClient

  const { privateKey, funderAddress, signatureType } = getBettingConfig()
  const wallet = new Wallet(privateKey)

  // First, derive API credentials
  if (!cachedCreds) {
    const tempClient = new ClobClient(CLOB_HOST, CHAIN_ID, wallet)
    cachedCreds = await tempClient.createOrDeriveApiKey()
    console.log('Derived API credentials')
  }

  // Create full client with credentials
  clobClient = new ClobClient(
    CLOB_HOST,
    CHAIN_ID,
    wallet,
    cachedCreds,
    signatureType,
    funderAddress
  )

  console.log('CLOB client initialized')
  return clobClient
}

/**
 * Derive API credentials (one-time setup)
 */
export async function deriveApiCredentials(): Promise<ApiCredentials> {
  const { privateKey } = getBettingConfig()
  const wallet = new Wallet(privateKey)

  const tempClient = new ClobClient(CLOB_HOST, CHAIN_ID, wallet)
  const creds = await tempClient.createOrDeriveApiKey()

  cachedCreds = creds

  return {
    apiKey: creds.key,
    apiSecret: creds.secret,
    passphrase: creds.passphrase
  }
}

/**
 * Get market info by slug
 */
async function getMarketBySlug(slug: string): Promise<MarketInfo | null> {
  // First get the market from Gamma API to get conditionId
  const gammaResponse = await fetch(`${GAMMA_API}/markets?slug=${slug}`)
  if (!gammaResponse.ok) return null

  const gammaMarkets = await gammaResponse.json() as GammaMarket[]
  if (!gammaMarkets.length) return null

  const market = gammaMarkets[0]

  // Get token info from CLOB API
  const clobResponse = await fetch(`${CLOB_HOST}/markets/${market.conditionId}`)
  if (!clobResponse.ok) return null

  const clobMarket = await clobResponse.json() as ClobMarket

  // Parse the token info
  const tokens = clobMarket.tokens || []
  if (!tokens.length) return null

  // Return first token (Yes outcome typically)
  const token = tokens[0]
  return {
    conditionId: market.conditionId,
    tokenId: token.token_id,
    question: market.question,
    outcome: token.outcome,
    price: token.price
  }
}

/**
 * Get token ID for a specific outcome
 * Returns null if market not found, closed, or outcome doesn't exist
 */
async function getTokenIdForOutcome(slug: string, outcome: string): Promise<{ tokenId: string; tickSize: string; negRisk: boolean } | { error: string } | null> {
  // Get the market from Gamma API
  const gammaResponse = await fetch(`${GAMMA_API}/markets?slug=${slug}`)
  if (!gammaResponse.ok) return null

  const gammaMarkets = await gammaResponse.json() as GammaMarket[]
  if (!gammaMarkets.length) return null

  const market = gammaMarkets[0]

  // Check if market is closed or inactive
  if (market.closed) {
    return { error: 'Market is closed' }
  }
  if (!market.active) {
    return { error: 'Market is inactive' }
  }

  // Get token info from CLOB API
  const clobResponse = await fetch(`${CLOB_HOST}/markets/${market.conditionId}`)
  if (!clobResponse.ok) {
    // Check if it's a 404 (no orderbook)
    if (clobResponse.status === 404) {
      return { error: 'No orderbook for this market' }
    }
    return null
  }

  const clobMarket = await clobResponse.json() as ClobMarket

  // Find the token matching the outcome
  const token = clobMarket.tokens?.find(t =>
    t.outcome.toLowerCase() === outcome.toLowerCase()
  )

  if (!token) return { error: `Outcome "${outcome}" not found` }

  // Check if this outcome already has a winner (market resolved)
  if (token.winner !== undefined) {
    return { error: 'Market has already resolved' }
  }

  return {
    tokenId: token.token_id,
    tickSize: clobMarket.min_tick_size || '0.01',
    negRisk: clobMarket.neg_risk || false
  }
}

/**
 * Place a bet on a market
 */
export async function placeBet(params: BetParams): Promise<BetResult> {
  try {
    const client = await initializeClobClient()

    // Get token ID for the outcome
    const tokenInfo = await getTokenIdForOutcome(params.marketSlug, params.outcome)
    if (!tokenInfo) {
      return {
        success: false,
        error: `Market or outcome not found: ${params.marketSlug} - ${params.outcome}`
      }
    }

    // Check if we got an error response
    if ('error' in tokenInfo) {
      return {
        success: false,
        error: tokenInfo.error
      }
    }

    // Calculate size (number of shares to buy)
    // size = amount / price for BUY orders
    const size = params.side === 'BUY'
      ? params.amount / params.price
      : params.amount

    const side = params.side === 'BUY' ? Side.BUY : Side.SELL
    const options = {
      tickSize: tokenInfo.tickSize as '0.1' | '0.01' | '0.001' | '0.0001',
      negRisk: tokenInfo.negRisk
    }

    let response: { success?: boolean; errorMsg?: string; orderID?: string }

    // FOK orders use createAndPostMarketOrder, others use createAndPostOrder
    if (params.orderType === 'FOK') {
      response = await client.createAndPostMarketOrder(
        {
          tokenID: tokenInfo.tokenId,
          price: params.price,
          side,
          amount: params.amount // For market orders, amount is in USDC for BUY
        },
        options,
        OrderType.FOK
      )
    } else {
      const orderType = params.orderType === 'GTD' ? OrderType.GTD : OrderType.GTC
      response = await client.createAndPostOrder(
        {
          tokenID: tokenInfo.tokenId,
          price: params.price,
          side,
          size
        },
        options,
        orderType
      )
    }

    if (response.success === false || response.errorMsg) {
      return {
        success: false,
        error: response.errorMsg || 'Order failed'
      }
    }

    return {
      success: true,
      orderId: response.orderID,
      market: params.marketSlug,
      outcome: params.outcome,
      side: params.side,
      amount: params.amount,
      price: params.price
    }
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message
    }
  }
}

/**
 * Get all open orders
 */
export async function getOpenOrders(): Promise<OpenOrder[]> {
  const client = await initializeClobClient()
  const response = await client.getOpenOrders()

  return response.map(order => ({
    orderId: order.id,
    market: order.market,
    asset: order.asset_id,
    side: order.side as 'BUY' | 'SELL',
    price: parseFloat(order.price),
    originalSize: parseFloat(order.original_size),
    sizeMatched: parseFloat(order.size_matched),
    sizeRemaining: parseFloat(order.original_size) - parseFloat(order.size_matched),
    status: order.status,
    createdAt: new Date(order.created_at * 1000).toISOString()
  }))
}

/**
 * Cancel an order
 */
export async function cancelOrder(orderId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const client = await initializeClobClient()
    await client.cancelOrder({ orderID: orderId })
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message
    }
  }
}

/**
 * Cancel all orders
 */
export async function cancelAllOrders(): Promise<{ success: boolean; error?: string }> {
  try {
    const client = await initializeClobClient()
    await client.cancelAll()
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message
    }
  }
}

/**
 * Get USDC balance and allowance
 */
export async function getBalances(): Promise<Balances> {
  const client = await initializeClobClient()

  const usdcBalance = await client.getBalanceAllowance({
    asset_type: AssetType.COLLATERAL
  })

  return {
    usdc: parseFloat(usdcBalance.balance) / 1e6, // USDC has 6 decimals
    collateral: parseFloat(usdcBalance.allowance) / 1e6
  }
}

/**
 * Update balance allowance (sync with CLOB)
 */
export async function updateAllowance(): Promise<void> {
  const client = await initializeClobClient()
  await client.updateBalanceAllowance({
    asset_type: AssetType.COLLATERAL
  })
}

/**
 * Get market info for betting
 */
export async function getMarketInfo(slug: string): Promise<MarketInfo | null> {
  return getMarketBySlug(slug)
}

/**
 * Check if betting is configured
 */
export function isBettingConfigured(): boolean {
  try {
    getBettingConfig()
    return true
  } catch {
    return false
  }
}

/**
 * Save a bet to the bet_log table
 */
export async function saveBetLog(params: {
  orderId?: string
  marketSlug: string
  outcome: string
  side: 'BUY' | 'SELL'
  amount: number
  price: number
  status: 'pending' | 'placed' | 'filled' | 'partial' | 'cancelled' | 'failed'
  errorMessage?: string
  source: 'manual' | 'auto'
  triggerTradeId?: string
  triggerWallet?: string
  triggerFollowScore?: number
}): Promise<BetLog> {
  const { data, error } = await supabaseAdmin
    .from('bet_log')
    .insert({
      order_id: params.orderId || null,
      market_slug: params.marketSlug,
      outcome: params.outcome,
      side: params.side,
      amount: params.amount,
      price: params.price,
      status: params.status,
      error_message: params.errorMessage || null,
      source: params.source,
      trigger_trade_id: params.triggerTradeId || null,
      trigger_wallet: params.triggerWallet || null,
      trigger_follow_score: params.triggerFollowScore || null,
      placed_at: params.status === 'placed' ? new Date().toISOString() : null
    })
    .select()
    .single()

  if (error) {
    console.error('[BetLog] Failed to save:', error.message)
    throw new Error(`Failed to save bet log: ${error.message}`)
  }

  return {
    id: data.id,
    orderId: data.order_id,
    marketSlug: data.market_slug,
    outcome: data.outcome,
    side: data.side,
    amount: parseFloat(data.amount),
    price: parseFloat(data.price),
    status: data.status,
    errorMessage: data.error_message,
    source: data.source,
    triggerTradeId: data.trigger_trade_id,
    triggerWallet: data.trigger_wallet,
    triggerFollowScore: data.trigger_follow_score,
    createdAt: data.created_at,
    placedAt: data.placed_at
  }
}

/**
 * Get bet logs from the database
 */
export async function getBetLogs(limit = 50): Promise<BetLog[]> {
  const { data, error } = await supabaseAdmin
    .from('bet_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[BetLog] Failed to fetch:', error.message)
    throw new Error(`Failed to fetch bet logs: ${error.message}`)
  }

  return data.map(row => ({
    id: row.id,
    orderId: row.order_id,
    marketSlug: row.market_slug,
    conditionId: row.condition_id,
    tokenId: row.token_id,
    outcome: row.outcome,
    side: row.side,
    amount: parseFloat(row.amount),
    price: parseFloat(row.price),
    size: row.size ? parseFloat(row.size) : null,
    orderType: row.order_type,
    status: row.status,
    errorMessage: row.error_message,
    source: row.source,
    triggerTradeId: row.trigger_trade_id,
    triggerWallet: row.trigger_wallet,
    triggerFollowScore: row.trigger_follow_score,
    resolvedStatus: row.resolved_status,
    pnl: row.pnl ? parseFloat(row.pnl) : null,
    createdAt: row.created_at,
    placedAt: row.placed_at,
    filledAt: row.filled_at,
    cancelledAt: row.cancelled_at
  }))
}

/**
 * Auto-copy a trade from a top trader
 */
export async function autoCopyTrade(params: {
  tradeId: string
  proxyWallet: string
  followScore: number
  marketSlug: string
  outcome: string
  side: 'BUY' | 'SELL'
  originalPrice: number
}): Promise<BetLog> {
  const COPY_AMOUNT = 2 // Fixed $2 USD
  const PRICE_BUFFER = 0.05 // 5 cents buffer

  // Calculate copy price (cap at 0.95 for BUY, floor at 0.05 for SELL)
  const copyPrice = params.side === 'BUY'
    ? Math.min(params.originalPrice + PRICE_BUFFER, 0.95)
    : Math.max(params.originalPrice - PRICE_BUFFER, 0.05)

  // Round to 2 decimal places
  const roundedPrice = Math.round(copyPrice * 100) / 100

  console.log(`[AutoCopy] Copying trade: ${params.marketSlug} ${params.outcome} ${params.side} @ ${roundedPrice} (original: ${params.originalPrice})`)

  // Place the bet
  const result = await placeBet({
    marketSlug: params.marketSlug,
    outcome: params.outcome,
    side: params.side,
    amount: COPY_AMOUNT,
    price: roundedPrice
  })

  // Save to bet_log
  const betLog = await saveBetLog({
    orderId: result.orderId,
    marketSlug: params.marketSlug,
    outcome: params.outcome,
    side: params.side,
    amount: COPY_AMOUNT,
    price: roundedPrice,
    status: result.success ? 'placed' : 'failed',
    errorMessage: result.error,
    source: 'auto',
    triggerTradeId: params.tradeId,
    triggerWallet: params.proxyWallet,
    triggerFollowScore: params.followScore
  })

  if (result.success) {
    console.log(`[AutoCopy] Success! Order ID: ${result.orderId}`)
  } else {
    console.log(`[AutoCopy] Failed: ${result.error}`)
  }

  return betLog
}
