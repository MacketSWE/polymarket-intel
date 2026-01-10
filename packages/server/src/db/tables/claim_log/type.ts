export interface ClaimLog {
  id: string
  conditionId: string
  marketSlug: string
  outcome: string
  value: number
  status: 'claimed' | 'failed' | 'skipped'
  txHash: string | null
  errorMessage: string | null
  createdAt: string
  claimedAt: string | null
}
