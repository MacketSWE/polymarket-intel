# Detection Strategies

## 1. Fresh Wallet Detection

### Rationale
Insiders may create new wallets to avoid association with their identity. A new wallet making large, confident bets is suspicious.

### Signals
- Wallet age < 7 days
- Total volume > $5,000
- Few trades but high conviction (large sizes)
- Betting on sensitive/stock-relevant markets

### Thresholds
| Metric | Warning | Alert |
|--------|---------|-------|
| Wallet age | < 30 days | < 7 days |
| First trade size | > $1,000 | > $5,000 |
| Volume/age ratio | > $500/day | > $2,000/day |

### Implementation
```typescript
interface FreshWalletAlert {
  wallet: string
  firstTradeAt: Date
  totalVolume: number
  tradeCount: number
  markets: string[]
  largestTrade: number
}
```

---

## 2. Unusual Sizing

### Rationale
Someone with insider knowledge will bet big. Unusually large bets relative to the market or the wallet's history are worth investigating.

### Signals
- Trade > 95th percentile for market
- Trade > 5x wallet's median
- Trade > 5% of market liquidity
- Single trade > $10,000

### Context Matters
- Market makers make large trades routinely (filter by spread behavior)
- Consider time of day (after-hours unusual)
- Look at price impact

### Implementation
```typescript
interface LargeTradeAlert {
  wallet: string
  market: string
  size: number
  marketMedian: number
  walletMedian: number
  priceImpact: number
  timestamp: Date
}
```

---

## 3. Niche Market Early Entry

### Rationale
Obscure markets with sudden interest may indicate someone knows something. First movers in these markets are worth tracking.

### Signals
- Market has < $50k total volume
- Wallet is among first 10 traders
- Subsequent volume spike validates early entry
- Same wallet appears early in multiple related markets

### Tracking
1. When a trade occurs in a low-volume market, record the wallet
2. If market volume 10x within 7 days, flag original traders
3. Build "early bird" score per wallet

### Implementation
```typescript
interface EarlyEntryAlert {
  wallet: string
  market: string
  entryTimestamp: Date
  volumeAtEntry: number
  currentVolume: number
  volumeMultiple: number
  walletEarlyEntryCount: number  // how often this wallet is early
}
```

---

## 4. Volume Spike Detection

### Rationale
Sudden interest in a market often precedes news. Detecting spikes early gives lead time.

### Signals
- 24hr volume > 5x 7-day average
- Trade count spike (many participants, not just one whale)
- Price movement accompanying volume

### Categories to Watch
Prioritize spikes in:
- Fed/monetary policy markets
- Company-specific markets (earnings, M&A)
- Regulatory markets (FDA, FTC)

### Implementation
```typescript
interface VolumeSpikeAlert {
  market: string
  question: string
  volume24h: number
  volume7dAvg: number
  spikeRatio: number
  tradeCount24h: number
  priceChange24h: number
  category: string
}
```

---

## 5. Coordinated Wallet Detection

### Rationale
Bad actors may use multiple wallets to hide their activity. Detecting coordination helps identify this.

### Signals
- Multiple wallets betting same direction within 5 minutes
- Wallets that only trade the same markets
- Similar trade sizes across wallets
- Wallets created around the same time

### Clustering Approach
1. Group trades by market and time window
2. Identify wallets that frequently co-occur
3. Score wallet pairs by correlation
4. Flag clusters above threshold

### Implementation
```typescript
interface CoordinationAlert {
  wallets: string[]
  market: string
  direction: 'YES' | 'NO'
  timeWindow: string  // e.g., "5 minutes"
  totalVolume: number
  correlationScore: number
}
```

---

## 6. Smart Money Tracking

### Rationale
Some wallets are consistently right. Tracking their activity is valuable.

### Building Smart Money List
1. Track all wallet outcomes over time
2. Calculate accuracy and ROI
3. Weight by volume (big correct bets matter more)
4. Minimum sample size: 20 resolved bets

### Signals
- Known smart wallet enters a market
- Smart wallet increases position
- Smart wallet exits (sells) before resolution

### Implementation
```typescript
interface WalletProfile {
  address: string
  totalBets: number
  resolvedBets: number
  accuracy: number
  totalVolume: number
  totalPnL: number
  roi: number
  marketsTraded: string[]
  isSmartMoney: boolean  // accuracy > 60%, volume > $50k, 20+ bets
}
```

---

## Alert Severity Levels

### Critical (Immediate)
- Single trade > $50,000
- Smart money wallet makes unusual move
- Coordinated activity detected

### High (Same day review)
- Fresh wallet with > $10k volume
- Volume spike > 10x average
- Multiple early entries from same wallet

### Medium (Daily digest)
- Large trade > $5,000
- Volume spike > 5x average
- Fresh wallet with notable activity

### Low (Weekly review)
- Unusual sizing patterns
- Niche market activity
- Wallet correlation patterns

---

## False Positive Mitigation

### Market Maker Detection
- High trade frequency with small sizes
- Trades on both sides
- Tight spread maintenance
- Flag and filter from alerts

### Known Entities
- Maintain whitelist of known funds, traders
- Lower sensitivity for whitelisted wallets
- Still track for unusual departures from pattern

### Time-Based Filters
- Ignore activity during major announcements (everyone trades)
- Weight after-hours activity higher
- Consider market open/close patterns
