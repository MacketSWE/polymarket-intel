# Auto-Copy Trades Plan

## Overview
Automatically copy top trader trades when they're synced to the database. Each copy bet uses $2 USD at 5 cents higher than the original trade price.

## Requirements
1. When a new trade is inserted into `top_trader_trades` table, trigger an auto-copy bet
2. Fixed bet amount: $2 USD
3. Price: original trade price + $0.05 (capped at 0.95)
4. Store all bets in existing `bet_log` Supabase table
5. Link each copy bet to the original trade via `trigger_trade_id`

## Implementation

### Phase 1: Use Existing `bet_log` Table

Table already exists at `packages/server/src/db/tables/bet_log/schema.sql`

Key fields for auto-copy:
- `source = 'auto'` — marks as auto-copy bet
- `trigger_trade_id` — FK to the original trade (from top_trader_trades)
- `trigger_wallet` — top trader's wallet
- `trigger_follow_score` — set to 100 for top traders
- `status` — tracks order lifecycle

**Run schema in Supabase** (if not already done)

### Phase 2: Bet Log Functions (DONE)

**File: `packages/server/src/services/betting.ts`**

Added:
- `saveBetLog()` - Save bet to bet_log table
- `getBetLogs()` - Retrieve bet history
- `autoCopyTrade()` - Auto-copy a trade with +5c price buffer

### Phase 3: Integrate into Top Trader Trades Sync (DONE)

**File: `packages/server/src/cron/top-trader-trades-sync.ts`**

After each batch insert to `top_trader_trades`:
- Get newly inserted trades (via `.select()` after upsert)
- For each new trade, call `autoCopyTrade()`
- Log success/failure

### Phase 4: API Endpoint (DONE)

**File: `packages/server/src/index.ts`**

Added:
- `GET /api/bet-log` - List all bets with limit param

## Flow Diagram

```
top-trader-trades-sync cron runs
       ↓
fetches trades for wallets in top_pv_traders
       ↓
filters for BUY trades only
       ↓
upserts into `top_trader_trades` table (skips duplicates)
       ↓
for each NEWLY INSERTED trade:
       ↓
if AUTO_BET_ENABLED=true
       ↓
call autoCopyTrade()
       ↓
place bet via CLOB API ($2 @ original_price + 0.05)
       ↓
save result to `bet_log` table with source='auto'
```

## Config

- `AUTO_BET_ENABLED=true` — Set in .env to enable auto-copying
- Betting credentials already configured

## Files Modified

| File | Changes |
|------|---------|
| `packages/server/src/services/betting.ts` | Added `saveBetLog()`, `getBetLogs()`, `autoCopyTrade()` |
| `packages/server/src/cron/top-trader-trades-sync.ts` | Added auto-copy after insert |
| `packages/server/src/index.ts` | Added `GET /api/bet-log` endpoint |

## To Enable

1. Run `bet_log` schema in Supabase (if not done)
2. Set `AUTO_BET_ENABLED=true` in `.env`
3. Restart server
