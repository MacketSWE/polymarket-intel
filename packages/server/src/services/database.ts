import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = path.resolve(__dirname, '../../../../data/polymarket.db')

// Ensure data directory exists
import fs from 'fs'
const dataDir = path.dirname(dbPath)
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

const db = new Database(dbPath)

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL')

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tx_hash TEXT UNIQUE,
    wallet TEXT NOT NULL,
    market_slug TEXT NOT NULL,
    title TEXT,
    side TEXT NOT NULL,
    outcome TEXT NOT NULL,
    size REAL NOT NULL,
    price REAL NOT NULL,
    timestamp INTEGER NOT NULL,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_trades_wallet ON trades(wallet);
  CREATE INDEX IF NOT EXISTS idx_trades_market ON trades(market_slug);
  CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
  CREATE INDEX IF NOT EXISTS idx_trades_size ON trades(size);

  CREATE TABLE IF NOT EXISTS wallets (
    address TEXT PRIMARY KEY,
    first_trade_at INTEGER,
    last_trade_at INTEGER,
    total_volume REAL DEFAULT 0,
    trade_count INTEGER DEFAULT 0,
    markets_traded INTEGER DEFAULT 0,
    updated_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    severity TEXT NOT NULL,
    wallet TEXT,
    market_slug TEXT,
    details TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    reviewed INTEGER DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_alerts_type ON alerts(type);
  CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);
  CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at);
`)

export interface TradeRecord {
  tx_hash: string
  wallet: string
  market_slug: string
  title: string
  side: string
  outcome: string
  size: number
  price: number
  timestamp: number
}

export interface WalletProfile {
  address: string
  first_trade_at: number
  last_trade_at: number
  total_volume: number
  trade_count: number
  markets_traded: number
}

export interface Alert {
  id?: number
  type: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  wallet?: string
  market_slug?: string
  details: string
  created_at?: number
  reviewed?: number
}

// Trade operations
const insertTrade = db.prepare(`
  INSERT OR IGNORE INTO trades (tx_hash, wallet, market_slug, title, side, outcome, size, price, timestamp)
  VALUES (@tx_hash, @wallet, @market_slug, @title, @side, @outcome, @size, @price, @timestamp)
`)

export function saveTrade(trade: TradeRecord): boolean {
  const result = insertTrade.run(trade)

  return result.changes > 0
}

export function saveTrades(trades: TradeRecord[]): number {
  let saved = 0
  const saveMany = db.transaction((items: TradeRecord[]) => {
    for (const trade of items) {
      if (saveTrade(trade)) saved++
    }
  })
  saveMany(trades)

  return saved
}

export function getRecentTrades(limit = 100): TradeRecord[] {

  return db.prepare(`
    SELECT * FROM trades ORDER BY timestamp DESC LIMIT ?
  `).all(limit) as TradeRecord[]
}

export function getTradesByWallet(wallet: string, limit = 100): TradeRecord[] {

  return db.prepare(`
    SELECT * FROM trades WHERE wallet = ? ORDER BY timestamp DESC LIMIT ?
  `).all(wallet, limit) as TradeRecord[]
}

export function getTradesByMarket(marketSlug: string, limit = 100): TradeRecord[] {

  return db.prepare(`
    SELECT * FROM trades WHERE market_slug = ? ORDER BY timestamp DESC LIMIT ?
  `).all(marketSlug, limit) as TradeRecord[]
}

// Wallet operations
export function updateWalletProfile(wallet: string): void {
  db.prepare(`
    INSERT INTO wallets (address, first_trade_at, last_trade_at, total_volume, trade_count, markets_traded, updated_at)
    SELECT
      ? as address,
      MIN(timestamp) as first_trade_at,
      MAX(timestamp) as last_trade_at,
      SUM(size) as total_volume,
      COUNT(*) as trade_count,
      COUNT(DISTINCT market_slug) as markets_traded,
      unixepoch() as updated_at
    FROM trades WHERE wallet = ?
    ON CONFLICT(address) DO UPDATE SET
      first_trade_at = excluded.first_trade_at,
      last_trade_at = excluded.last_trade_at,
      total_volume = excluded.total_volume,
      trade_count = excluded.trade_count,
      markets_traded = excluded.markets_traded,
      updated_at = excluded.updated_at
  `).run(wallet, wallet)
}

export function getWalletProfile(wallet: string): WalletProfile | null {

  return db.prepare(`
    SELECT * FROM wallets WHERE address = ?
  `).get(wallet) as WalletProfile | null
}

export function getFreshWallets(maxAgeDays = 7, minVolume = 1000): WalletProfile[] {
  const cutoff = Math.floor(Date.now() / 1000) - (maxAgeDays * 24 * 60 * 60)

  return db.prepare(`
    SELECT * FROM wallets
    WHERE first_trade_at > ? AND total_volume > ?
    ORDER BY total_volume DESC
  `).all(cutoff, minVolume) as WalletProfile[]
}

export function getLargeTraders(minVolume = 10000): WalletProfile[] {

  return db.prepare(`
    SELECT * FROM wallets WHERE total_volume > ? ORDER BY total_volume DESC
  `).all(minVolume) as WalletProfile[]
}

// Alert operations
const insertAlert = db.prepare(`
  INSERT INTO alerts (type, severity, wallet, market_slug, details)
  VALUES (@type, @severity, @wallet, @market_slug, @details)
`)

export function createAlert(alert: Alert): number {
  const result = insertAlert.run({
    type: alert.type,
    severity: alert.severity,
    wallet: alert.wallet ?? null,
    market_slug: alert.market_slug ?? null,
    details: alert.details
  })

  return result.lastInsertRowid as number
}

export function getAlerts(limit = 50, includeReviewed = false): Alert[] {
  const query = includeReviewed
    ? `SELECT * FROM alerts ORDER BY created_at DESC LIMIT ?`
    : `SELECT * FROM alerts WHERE reviewed = 0 ORDER BY created_at DESC LIMIT ?`

  return db.prepare(query).all(limit) as Alert[]
}

export function markAlertReviewed(id: number): void {
  db.prepare(`UPDATE alerts SET reviewed = 1 WHERE id = ?`).run(id)
}

// Stats
export function getStats() {

  return {
    totalTrades: (db.prepare(`SELECT COUNT(*) as count FROM trades`).get() as { count: number }).count,
    totalWallets: (db.prepare(`SELECT COUNT(*) as count FROM wallets`).get() as { count: number }).count,
    totalAlerts: (db.prepare(`SELECT COUNT(*) as count FROM alerts WHERE reviewed = 0`).get() as { count: number }).count,
  }
}

export default db
