export interface TopPVTrader {
  id: number
  proxyWallet: string
  userName: string | null
  xUsername: string | null
  verifiedBadge: boolean
  profileImage: string | null
  pnl: number
  vol: number
  pv: number
  source: '7d' | '30d' | 'both'
  rank: number
  updatedAt: string
}
