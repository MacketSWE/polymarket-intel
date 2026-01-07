# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TIC LENS - A Polymarket analytics dashboard that tracks large trades, classifies traders, and identifies follow-worthy betting signals.

## Commands

```bash
# Development (runs both client and server)
npm run dev

# Run only server
npm run dev:server

# Run only client
npm run dev:client

# Build client for production
npm run build

# Start production server
npm run start

# Type-check server
npx tsc --noEmit -p packages/server/tsconfig.json

# Type-check client
npx vue-tsc --noEmit -p packages/client/tsconfig.json

# Run a one-off script
npx tsx packages/server/src/scripts/<script-name>.ts [args]
```

## Architecture

### Monorepo Structure
- `packages/server/` - Express + TypeScript backend
- `packages/client/` - Vue 3 + Vite frontend

### Server Components

**API Layer** (`src/index.ts`)
- Express server with cookie-based auth via Supabase
- All routes prefixed with `/api/`
- `requireAuth` middleware protects most endpoints

**Services** (`src/services/`)
- `polymarket.ts` - Polymarket API wrappers (GAMMA_API, DATA_API, CLOB_API)
- `supabase.ts` - Two clients: `supabase` (anon) for auth, `supabaseAdmin` (service role) for data
- `analysis.ts` - Trade detection and wallet analysis
- `database.ts` - Local SQLite operations

**Cron Jobs** (`src/cron/`)
- `trades-sync.ts` - Fetches trades >= $2,500, classifies new wallets, marks take_bets
- `resolution-sync.ts` - Checks market resolutions, updates won/lost status
- Jobs run in production only (`NODE_ENV=production`)

**Scripts** (`src/scripts/`)
- One-time backfill scripts, run with `npx tsx`

### Database

Uses Supabase (PostgreSQL). All DB-related code lives in `src/db/`.

**Table Structure** (`src/db/tables/`):
```
db/tables/
  <table_name>/
    type.ts       # TypeScript interface (camelCase fields)
    schema.sql    # CREATE TABLE + indexes + RLS policies
```

**DB Functions** (`src/db/functions/`):
```
db/functions/
  <function_name>/
    function.sql  # CREATE FUNCTION SQL
    index.ts      # Typed wrapper (camelCase return)
```

**trades table** - Core table storing:
- Trade data (transaction_hash, proxy_wallet, side, size, price, etc.)
- Trader classification (good_trader, follow_score, insider_score, bot_score, whale_score)
- Take bet tracking (take_bet boolean, deduplicated per wallet/market/outcome)
- Resolution status (resolved_status: 'won'|'lost', end_date, last_resolution_check)

### Client Components

**Pages** (`src/pages/`) - Vue components for each route
**Router** (`src/router/index.ts`) - Auth guard redirects to `/login` if not authenticated

### External APIs

- **GAMMA_API** (`gamma-api.polymarket.com`) - Markets, events, tags
- **DATA_API** (`data-api.polymarket.com`) - Trades, positions, activity
- **CLOB_API** (`clob.polymarket.com`) - Market resolution status, end dates

### Key Business Logic

**Trader Classification** (`classifyTrader` in polymarket.ts):
- Fetches profile, leaderboard rank, activity, positions
- Calculates follow_score, insider_score, bot_score, whale_score (0-100)
- Determines if trader is "follow-worthy"

**Take Bet Criteria** (`qualifiesForTakeBet` in trades-sync.ts):
- follow_score >= 75
- side === 'BUY'
- amount >= $3,000
- price <= 0.65

## Environment Variables

Required in `.env` (see `.env.example`):
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `VITE_API_URL` for client API calls
