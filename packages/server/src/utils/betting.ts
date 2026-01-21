/**
 * Betting calculation utilities
 */

const DEFAULT_SHARES = 5.0;
const MINIMUM_COST = 3.0;

/**
 * Calculate the number of shares to buy ensuring a minimum cost of $3.
 * If the default 5 shares would cost >= $3, keeps 5 shares.
 * Otherwise, calculates shares needed to reach $3 minimum.
 *
 * @param price - Price per share (e.g., 0.29 for 29¢)
 * @param minimumCost - Minimum cost target (default: $3.00)
 * @param defaultShares - Default number of shares (default: 5.0)
 * @returns Object with shares to buy and total cost
 */
export function calculateShares(
  price: number,
  minimumCost: number = MINIMUM_COST,
  defaultShares: number = DEFAULT_SHARES
): { shares: number; cost: number } {
  const defaultCost = defaultShares * price;

  if (defaultCost >= minimumCost) {
    return {
      shares: defaultShares,
      cost: Math.round(defaultCost * 100) / 100,
    };
  }

  const shares = Math.round((minimumCost / price) * 10) / 10; // Round to 1 decimal
  const cost = Math.round(shares * price * 100) / 100;

  return { shares, cost };
}

/**
 * Batch calculate shares for multiple prices
 */
export function calculateSharesBatch(
  prices: number[],
  minimumCost: number = MINIMUM_COST,
  defaultShares: number = DEFAULT_SHARES
): Array<{ price: number; shares: number; cost: number }> {
  return prices.map((price) => ({
    price,
    ...calculateShares(price, minimumCost, defaultShares),
  }));
}
