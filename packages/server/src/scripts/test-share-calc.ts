/**
 * Test script to verify share calculation with $3 minimum
 * Run: npx tsx packages/server/src/scripts/test-share-calc.ts
 */

import { calculateShares } from "../utils/betting";

// Sample prices from the trades.csv (in cents converted to dollars)
const testPrices = [
  { event: "Kent State Golden Flashes", price: 0.29 },
  { event: "Man City Yes", price: 0.23 },
  { event: "Sharks", price: 0.28 },
  { event: "Gaethje", price: 0.32 },
  { event: "Flyers", price: 0.34 },
  { event: "Capitals", price: 0.36 },
  { event: "Rangers", price: 0.39 },
  { event: "Kings", price: 0.41 },
  { event: "Suns", price: 0.49 },
  { event: "Spurs", price: 0.50 },
  { event: "Lakers", price: 0.57 },
  { event: "Bulls", price: 0.61 },
  { event: "76ers", price: 0.70 },
  { event: "Lightning", price: 0.73 },
  { event: "Suns", price: 0.78 },
  { event: "Timberwolves", price: 0.86 },
  { event: "FK Bodø/Glimt No", price: 0.89 },
];

console.log("Share Calculation with $3 Minimum (Option B)\n");
console.log("=".repeat(70));
console.log(
  "Event".padEnd(25),
  "Price".padEnd(8),
  "Old Shares".padEnd(12),
  "Old Cost".padEnd(10),
  "New Shares".padEnd(12),
  "New Cost"
);
console.log("=".repeat(70));

for (const { event, price } of testPrices) {
  const oldShares = 5.0;
  const oldCost = (oldShares * price).toFixed(2);
  const { shares: newShares, cost: newCost } = calculateShares(price);

  const changed = newShares !== oldShares ? " *" : "";

  console.log(
    event.padEnd(25),
    `${(price * 100).toFixed(0)}¢`.padEnd(8),
    oldShares.toFixed(1).padEnd(12),
    `$${oldCost}`.padEnd(10),
    newShares.toFixed(1).padEnd(12),
    `$${newCost.toFixed(2)}${changed}`
  );
}

console.log("\n* = adjusted to meet $3 minimum");
