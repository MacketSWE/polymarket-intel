/**
 * Test script for Polymarket position claiming
 *
 * Usage:
 *   npx tsx packages/server/src/scripts/test-claiming.ts [command] [args]
 *
 * Commands:
 *   status              - Check if claiming is configured
 *   positions           - List all claimable (won) positions
 *   claim <conditionId> - Claim a single position
 *   claim-all           - Claim all winning positions
 *   test <conditionId>  - Dry run (build tx but don't execute)
 *
 * Examples:
 *   npx tsx packages/server/src/scripts/test-claiming.ts status
 *   npx tsx packages/server/src/scripts/test-claiming.ts positions
 *   npx tsx packages/server/src/scripts/test-claiming.ts claim 0x123...abc
 *   npx tsx packages/server/src/scripts/test-claiming.ts claim-all
 */

import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') })

import {
  isClaimingConfigured,
  getClaimablePositions,
  getAllRedeemablePositions,
  getPositions,
  claimPosition,
  claimAllWinning,
  type ClaimablePosition
} from '../services/claiming.js'

function printPosition(p: ClaimablePosition, index: number) {
  const pnlSign = p.cashPnl >= 0 ? '+' : ''
  console.log(`  ${index + 1}. ${p.title.slice(0, 60)}`)
  console.log(`     Outcome: ${p.outcome} | Size: ${p.size.toFixed(2)} shares`)
  console.log(`     Entry: $${p.avgPrice.toFixed(2)} | Current: $${p.curPrice.toFixed(2)} | Value: $${p.currentValue.toFixed(2)}`)
  console.log(`     PnL: ${pnlSign}$${p.cashPnl.toFixed(2)} | NegRisk: ${p.negRisk} | Redeemable: ${p.redeemable}`)
  console.log(`     ConditionId: ${p.conditionId.slice(0, 20)}...`)
  console.log('')
}

async function checkStatus() {
  console.log('=== Claiming Configuration Status ===\n')

  const configured = isClaimingConfigured()

  if (!configured) {
    console.log('Status: NOT CONFIGURED\n')
    console.log('Missing environment variables. Ensure these are set:')
    console.log('  - POLYGON_PRIVATE_KEY_PART1')
    console.log('  - POLYMARKET_FUNDER_ADDRESS')
    console.log('  - BUILDER_API_KEY')
    console.log('  - BUILDER_API_SECRET')
    console.log('  - BUILDER_PASSPHRASE')
    return false
  }

  console.log('Status: CONFIGURED\n')

  // Show config summary (without secrets)
  console.log('Configuration:')
  console.log(`  Funder Address: ${process.env.POLYMARKET_FUNDER_ADDRESS || 'not set'}`)
  console.log(`  Signature Type: ${process.env.POLYMARKET_SIGNATURE_TYPE || '0'} (${process.env.POLYMARKET_SIGNATURE_TYPE === '1' ? 'PROXY' : 'SAFE'})`)
  console.log(`  Builder API Key: ${process.env.BUILDER_API_KEY?.slice(0, 8)}...`)
  console.log(`  RPC URL: ${process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com'}`)

  return true
}

async function listPositions() {
  console.log('=== Claimable Positions (from Polymarket API) ===\n')

  // Get winning redeemable positions
  const positions = await getClaimablePositions()

  if (positions.length === 0) {
    console.log('No winning positions to claim.\n')

    // Also show all redeemable (including losses)
    const allRedeemable = await getAllRedeemablePositions()
    if (allRedeemable.length > 0) {
      console.log(`Note: You have ${allRedeemable.length} redeemable positions (all losses worth $0)`)
      console.log('Use "positions --all" to see them.\n')
    }
    return
  }

  console.log(`Found ${positions.length} winning position(s) to claim:\n`)

  let totalValue = 0
  let totalPnl = 0

  for (let i = 0; i < positions.length; i++) {
    printPosition(positions[i], i)
    totalValue += positions[i].currentValue
    totalPnl += positions[i].cashPnl
  }

  console.log('---')
  console.log(`Total value to claim: $${totalValue.toFixed(2)}`)
  console.log(`Total PnL: $${totalPnl.toFixed(2)}`)
}

async function listAllPositions() {
  console.log('=== All Positions (from Polymarket API) ===\n')

  const positions = await getPositions(false)
  const redeemable = positions.filter(p => p.redeemable)
  const open = positions.filter(p => !p.redeemable)

  console.log(`Total: ${positions.length} | Open: ${open.length} | Redeemable: ${redeemable.length}\n`)

  if (redeemable.length > 0) {
    const winners = redeemable.filter(p => p.currentValue > 0)
    const losers = redeemable.filter(p => p.currentValue === 0)

    console.log(`Redeemable: ${winners.length} winners, ${losers.length} losses\n`)

    if (winners.length > 0) {
      console.log('--- Winners ---')
      winners.forEach((p, i) => printPosition(p, i))
    }

    if (losers.length > 0) {
      console.log('--- Losses (worth $0) ---')
      losers.slice(0, 5).forEach((p, i) => printPosition(p, i))
      if (losers.length > 5) {
        console.log(`  ... and ${losers.length - 5} more losses\n`)
      }
    }
  }
}

async function claimSingle(conditionId: string, negRisk: boolean = false) {
  console.log('=== Claiming Single Position ===\n')
  console.log(`ConditionId: ${conditionId}`)
  console.log(`NegRisk: ${negRisk}\n`)

  console.log('Submitting claim transaction...\n')

  const result = await claimPosition(conditionId, negRisk)

  if (result.success) {
    console.log('SUCCESS!')
    console.log(`Transaction Hash: ${result.txHash}`)
    console.log(`View on Polygonscan: https://polygonscan.com/tx/${result.txHash}`)
  } else {
    console.log('FAILED!')
    console.log(`Error: ${result.error}`)
  }
}

async function claimAll() {
  console.log('=== Claiming All Winning Positions ===\n')

  // First show what we're about to claim
  const positions = await getClaimablePositions()

  if (positions.length === 0) {
    console.log('No claimable positions found.')
    return
  }

  console.log(`Found ${positions.length} position(s) to claim:\n`)
  positions.forEach((p, i) => printPosition(p, i))

  console.log('Starting claims...\n')

  const result = await claimAllWinning()

  console.log('\n=== Results ===\n')
  console.log(`Total: ${result.total}`)
  console.log(`Claimed: ${result.claimed}`)
  console.log(`Failed: ${result.failed}`)

  if (result.results.length > 0) {
    console.log('\nDetails:')
    for (const r of result.results) {
      if (r.success) {
        console.log(`  ✓ ${r.conditionId.slice(0, 20)}... - TX: ${r.txHash?.slice(0, 20)}...`)
      } else {
        console.log(`  ✗ ${r.conditionId.slice(0, 20)}... - Error: ${r.error}`)
      }
    }
  }
}

async function testDryRun(conditionId: string) {
  console.log('=== Dry Run Test ===\n')
  console.log(`ConditionId: ${conditionId}\n`)

  console.log('Checking configuration...')

  if (!isClaimingConfigured()) {
    console.log('ERROR: Claiming not configured. Run "status" command for details.')
    return
  }

  console.log('Configuration OK\n')

  // Check if this conditionId exists in our positions via API
  const positions = await getPositions(false)
  const position = positions.find(p => p.conditionId.toLowerCase() === conditionId.toLowerCase())

  if (position) {
    console.log('Position found:')
    printPosition(position, 0)

    if (!position.redeemable) {
      console.log('WARNING: This position is NOT redeemable yet (market still open).')
    } else if (position.currentValue === 0) {
      console.log('NOTE: This is a losing position (worth $0).')
    }
  } else {
    console.log('Position not found in your account.')
  }

  console.log('\nDry run complete. Use "claim <conditionId>" to execute.')
}

async function main() {
  const args = process.argv.slice(2)
  const command = args[0] || 'status'

  console.log('')

  try {
    switch (command) {
      case 'status':
        await checkStatus()
        break

      case 'positions':
        if (args.includes('--all')) {
          await listAllPositions()
        } else {
          await listPositions()
        }
        break

      case 'claim':
        if (!args[1]) {
          console.log('Error: conditionId required')
          console.log('Usage: npx tsx packages/server/src/scripts/test-claiming.ts claim <conditionId> [--neg-risk]')
          process.exit(1)
        }
        const negRisk = args.includes('--neg-risk')
        await claimSingle(args[1], negRisk)
        break

      case 'claim-all':
        await claimAll()
        break

      case 'test':
        if (!args[1]) {
          console.log('Error: conditionId required')
          console.log('Usage: npx tsx packages/server/src/scripts/test-claiming.ts test <conditionId>')
          process.exit(1)
        }
        await testDryRun(args[1])
        break

      default:
        console.log('Unknown command:', command)
        console.log('')
        console.log('Available commands:')
        console.log('  status              - Check if claiming is configured')
        console.log('  positions           - List all claimable positions')
        console.log('  claim <conditionId> - Claim a single position')
        console.log('  claim-all           - Claim all winning positions')
        console.log('  test <conditionId>  - Dry run test')
        process.exit(1)
    }
  } catch (error) {
    console.error('\nError:', (error as Error).message)
    process.exit(1)
  }

  console.log('')
}

main()
