export interface BetLog {
  id: string
  orderId?: string | null
  marketSlug: string
  conditionId?: string | null
  tokenId?: string | null
  outcome: string
  side: 'BUY' | 'SELL'
  amount: number
  price: number
  size?: number | null
  orderType?: 'GTC' | 'GTD' | 'FOK' | null
  status: 'pending' | 'placed' | 'filled' | 'partial' | 'cancelled' | 'failed'
  errorMessage?: string | null
  source: 'manual' | 'auto'
  // Trigger info (if auto-bet)
  triggerTradeId?: string | null
  triggerWallet?: string | null
  triggerFollowScore?: number | null
  // Resolution tracking
  resolvedStatus?: 'won' | 'lost' | null
  pnl?: number | null
  // Timestamps
  createdAt: string
  placedAt?: string | null
  filledAt?: string | null
  cancelledAt?: string | null
}
