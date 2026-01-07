import { supabaseAdmin } from '../services/supabase.js'

const POLYMARKET_API = 'https://data-api.polymarket.com/v1/leaderboard'

interface LeaderboardTrader {
  rank: string
  proxyWallet: string
  userName: string
  xUsername: string
  verifiedBadge: boolean
  vol: number
  pnl: number
  profileImage: string
}

interface TopPVTrader {
  proxyWallet: string
  userName: string | null
  xUsername: string | null
  verifiedBadge: boolean
  profileImage: string | null
  pnl: number
  vol: number
  pv: number
  source: '7d' | '30d' | 'both'
}

async function fetchLeaderboard(timePeriod: 'WEEK' | 'MONTH'): Promise<LeaderboardTrader[]> {
  const params = new URLSearchParams({
    timePeriod,
    orderBy: 'PNL',
    limit: '50'
  })

  const response = await fetch(`${POLYMARKET_API}?${params}`)
  if (!response.ok) {
    throw new Error(`Polymarket API error: ${response.status}`)
  }

  return response.json() as Promise<LeaderboardTrader[]>
}

export async function syncTopPVTraders(): Promise<{ count: number }> {
  // 1. Fetch both leaderboards
  const [weekTraders, monthTraders] = await Promise.all([
    fetchLeaderboard('WEEK'),
    fetchLeaderboard('MONTH')
  ])

  // 2. Calculate P/V and get top 15 from each (filter pnl > 0)
  const calcPV = (t: LeaderboardTrader) => t.vol > 0 ? t.pnl / t.vol : 0

  const weekTop: TopPVTrader[] = weekTraders
    .filter(t => t.vol > 0 && t.pnl > 0)
    .map(t => ({
      proxyWallet: t.proxyWallet,
      userName: t.userName || null,
      xUsername: t.xUsername || null,
      verifiedBadge: t.verifiedBadge,
      profileImage: t.profileImage || null,
      pnl: t.pnl,
      vol: t.vol,
      pv: calcPV(t),
      source: '7d' as const
    }))
    .sort((a, b) => b.pv - a.pv)
    .slice(0, 15)

  const monthTop: TopPVTrader[] = monthTraders
    .filter(t => t.vol > 0 && t.pnl > 0)
    .map(t => ({
      proxyWallet: t.proxyWallet,
      userName: t.userName || null,
      xUsername: t.xUsername || null,
      verifiedBadge: t.verifiedBadge,
      profileImage: t.profileImage || null,
      pnl: t.pnl,
      vol: t.vol,
      pv: calcPV(t),
      source: '30d' as const
    }))
    .sort((a, b) => b.pv - a.pv)
    .slice(0, 15)

  // 3. Combine and deduplicate
  const combined = new Map<string, TopPVTrader>()

  for (const t of weekTop) {
    combined.set(t.proxyWallet, t)
  }

  for (const t of monthTop) {
    if (combined.has(t.proxyWallet)) {
      const existing = combined.get(t.proxyWallet)!
      // Mark as 'both', keep higher P/V data
      if (t.pv > existing.pv) {
        combined.set(t.proxyWallet, { ...t, source: 'both' })
      } else {
        existing.source = 'both'
      }
    } else {
      combined.set(t.proxyWallet, t)
    }
  }

  // 4. Sort by P/V and assign ranks
  const sorted = Array.from(combined.values()).sort((a, b) => b.pv - a.pv)

  // 5. Wipe table
  await supabaseAdmin.from('top_pv_traders').delete().neq('id', 0)

  // 6. Insert fresh rows
  const rows = sorted.map((t, i) => ({
    proxy_wallet: t.proxyWallet,
    user_name: t.userName,
    x_username: t.xUsername,
    verified_badge: t.verifiedBadge,
    profile_image: t.profileImage,
    pnl: t.pnl,
    vol: t.vol,
    pv: t.pv,
    source: t.source,
    rank: i + 1,
    updated_at: new Date().toISOString()
  }))

  if (rows.length > 0) {
    const { error } = await supabaseAdmin.from('top_pv_traders').insert(rows)
    if (error) throw error
  }

  return { count: rows.length }
}

export async function isTableEmpty(): Promise<boolean> {
  const { count, error } = await supabaseAdmin
    .from('top_pv_traders')
    .select('*', { count: 'exact', head: true })

  if (error) throw error
  return count === 0
}
