export interface BetParams {
  marketSlug: string
  outcome: string           // "Yes" or "No"
  side: 'BUY' | 'SELL'
  amount: number            // USDC amount
  price: number             // 0.01 - 0.99
  orderType?: 'GTC' | 'GTD' | 'FOK'  // Good-til-cancelled, Good-til-date, Fill-or-kill
}

export interface BetResult {
  success: boolean
  orderId?: string
  error?: string
  market?: string
  outcome?: string
  side?: 'BUY' | 'SELL'
  amount?: number
  price?: number
}

export interface OpenOrder {
  orderId: string
  market: string
  asset: string
  side: 'BUY' | 'SELL'
  price: number
  originalSize: number
  sizeMatched: number
  sizeRemaining: number
  status: string
  createdAt: string
}

export interface Balances {
  usdc: number
  collateral: number
}

export interface BettingConfig {
  privateKey: string
  rpcUrl: string
  funderAddress: string
  signatureType: 0 | 1 | 2  // 0=EOA, 1=Poly GNOSIS SAFE, 2=Poly Proxy
}

export interface MarketInfo {
  conditionId: string
  tokenId: string
  question: string
  outcome: string
  price: number
}

export interface ApiCredentials {
  apiKey: string
  apiSecret: string
  passphrase: string
}
