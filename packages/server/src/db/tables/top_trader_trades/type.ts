export interface TopTraderTrade {
  id: string
  transactionHash: string
  proxyWallet: string
  name: string | null
  pseudonym: string | null
  profileImage: string | null
  slug: string
  eventSlug: string
  title: string
  icon: string | null
  conditionId: string
  outcome: string
  outcomeIndex: number
  side: 'BUY' | 'SELL'
  totalSize: number
  totalValue: number
  avgPrice: number
  tradeCount: number
  firstTimestamp: number
  latestTimestamp: number
  createdAt: string
  updatedAt: string
  // Resolution tracking
  resolvedStatus: 'won' | 'lost' | null
  endDate: string | null
  lastResolutionCheck: string | null
  profitPerDollar: number | null
}
