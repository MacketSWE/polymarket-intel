# Polymarket Intelligence

A tool for detecting early signals from prediction markets that may indicate informed trading or upcoming events affecting traditional markets.

## Overview

Polymarket is a prediction market where users bet on real-world outcomes. This project monitors trading activity to identify patterns that may signal insider knowledge or early awareness of market-moving events.

## Why This Matters

Prediction markets often react faster than traditional markets to breaking news. By monitoring:
- **Who** is betting (new wallets, known smart money)
- **What** they're betting on (stock-relevant events)
- **How** they're betting (unusual sizes, coordinated activity)

We can potentially identify signals before they're reflected in stock prices.

## Architecture

```
polymarket/
├── packages/
│   ├── server/          # Express API + analysis engine
│   │   └── src/
│   │       ├── services/
│   │       │   └── polymarket.ts   # API client
│   │       └── index.ts            # REST endpoints
│   └── client/          # Vue dashboard
└── docs/                # Documentation
```

## Data Sources

All data comes from Polymarket's public APIs (no authentication required for read-only):

| API | Base URL | Purpose |
|-----|----------|---------|
| Gamma | gamma-api.polymarket.com | Markets, events, metadata |
| Data | data-api.polymarket.com | Trades, positions, activity |
| CLOB | clob.polymarket.com | Order book, pricing |
| WebSocket | ws-subscriptions-clob.polymarket.com | Real-time updates |

## Detection Strategies

See [detection.md](./detection.md) for detailed detection logic.

### Summary

1. **Fresh Wallet Detection** - Flag new accounts making large bets
2. **Unusual Sizing** - Identify bets that exceed normal patterns
3. **Niche Market Early Entry** - Track first movers in obscure markets
4. **Volume Spikes** - Detect sudden interest in specific markets
5. **Coordinated Activity** - Find wallets acting in sync

## Stock-Relevant Categories

Markets we specifically monitor:

- Federal Reserve / monetary policy
- Corporate earnings and M&A
- FDA approvals
- Political outcomes
- Sector-specific regulation

## Getting Started

```bash
# Install dependencies
npm install

# Run development servers
npm run dev

# Server: http://localhost:3000
# Client: http://localhost:5173
```

## API Endpoints

### Markets & Trades
- `GET /api/polymarket/markets` - Active markets by volume
- `GET /api/polymarket/trades` - Recent trades
- `GET /api/polymarket/trades/large` - Large trades (>$1000)

### Analysis
- `GET /api/analysis/fresh-wallets` - New wallets with significant activity
- `GET /api/analysis/volume-spikes` - Markets with unusual volume
- `GET /api/analysis/wallet/:address` - Wallet profile and history
- `GET /api/analysis/alerts` - Aggregated suspicious activity

## Status

This project is under active development.

- [x] Basic Polymarket API integration
- [x] Markets and trades display
- [x] Trade storage and indexing (SQLite)
- [x] Fresh wallet detection
- [x] Large trade detection
- [x] Volume spike detection
- [x] Alert system
- [x] Dark-mode dashboard
- [ ] Real-time WebSocket monitoring
- [ ] Wallet correlation analysis
- [ ] Smart money tracking
