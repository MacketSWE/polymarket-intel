export interface Trades {
  id: string
  transactionHash: string
  proxyWallet: string
  side: 'BUY' | 'SELL'
  asset: string
  conditionId: string
  size: number
  price: number
  amount: number
  timestamp: number
  title: string
  slug: string
  icon: string
  eventSlug: string
  outcome: string
  outcomeIndex: number
  name: string
  pseudonym: string
  bio: string
  profileImage: string
  profileImageOptimized: string
  createdAt?: string
  // Classification columns
  goodTrader?: boolean | null
  followScore?: number | null
  insiderScore?: number | null
  botScore?: number | null
  whaleScore?: number | null
  classification?: string | null
  takeBet?: boolean | null
  // Resolution status
  resolvedStatus?: 'won' | 'lost' | null
  endDate?: string | null
  lastResolutionCheck?: string | null
  profitPerDollar?: number | null
}
