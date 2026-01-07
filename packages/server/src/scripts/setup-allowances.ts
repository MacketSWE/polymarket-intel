/**
 * Setup script for Polymarket token allowances
 *
 * This script sets up the necessary token approvals for trading:
 * 1. Approve USDC.e for CTF Exchange contract
 * 2. Approve USDC.e for Neg Risk Exchange contract
 * 3. Approve CTF tokens (ERC1155) for both Exchange contracts
 * 4. Sync allowances with CLOB API
 *
 * Run once per wallet:
 *   npx tsx packages/server/src/scripts/setup-allowances.ts
 */

import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') })

import { Wallet } from '@ethersproject/wallet'
import { JsonRpcProvider } from '@ethersproject/providers'
import { Contract } from '@ethersproject/contracts'
import { MaxUint256 } from '@ethersproject/constants'
import { parseUnits } from '@ethersproject/units'
import { initializeClobClient, deriveApiCredentials, updateAllowance, getBalances } from '../services/betting.js'

// Contract addresses on Polygon mainnet
const CONTRACTS = {
  // Exchange contracts that need approval to spend USDC and manage CTF tokens
  CTF_EXCHANGE: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E',
  NEG_RISK_EXCHANGE: '0xC5d563A36AE78145C45a50134d48A1215220f80a',

  // Token contracts
  USDC_E: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
  CONDITIONAL_TOKENS: '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045'
}

// Minimal ERC20 ABI for approval
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)'
]

// Minimal ERC1155 ABI for setApprovalForAll
const ERC1155_ABI = [
  'function setApprovalForAll(address operator, bool approved) external',
  'function isApprovedForAll(address account, address operator) external view returns (bool)'
]

// Private key part 2 (part 1 is in .env)
const PRIVATE_KEY_PART2 = '91d067cc47945655f7d9f5614ec'

async function main() {
  console.log('=== Polymarket Allowance Setup ===\n')

  // Check environment
  const privateKeyPart1 = process.env.POLYGON_PRIVATE_KEY_PART1
  const rpcUrl = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com'

  if (!privateKeyPart1 || !PRIVATE_KEY_PART2) {
    console.error('Error: POLYGON_PRIVATE_KEY_PART1 not set in .env or PRIVATE_KEY_PART2 not configured')
    process.exit(1)
  }

  const privateKey = privateKeyPart1 + PRIVATE_KEY_PART2

  console.log('Connecting to Polygon...')
  const provider = new JsonRpcProvider(rpcUrl)
  const wallet = new Wallet(privateKey, provider)
  const address = await wallet.getAddress()

  console.log(`Wallet address: ${address}`)

  // Check MATIC balance for gas
  const maticBalance = await provider.getBalance(address)
  const maticBalanceEth = Number(maticBalance) / 1e18
  console.log(`MATIC balance: ${maticBalanceEth.toFixed(4)} MATIC`)

  if (maticBalanceEth < 0.01) {
    console.warn('Warning: Low MATIC balance. You need MATIC for gas fees.')
  }

  // Check USDC balance
  const usdc = new Contract(CONTRACTS.USDC_E, ERC20_ABI, provider)
  const usdcBalance = await usdc.balanceOf(address)
  const decimals = await usdc.decimals()
  const usdcBalanceFormatted = Number(usdcBalance) / Math.pow(10, Number(decimals))
  console.log(`USDC.e balance: $${usdcBalanceFormatted.toFixed(2)}`)

  // Step 1: Derive API credentials
  console.log('\n--- Step 1: API Credentials ---')
  try {
    const creds = await deriveApiCredentials()
    console.log('API credentials derived successfully')
    console.log(`API Key: ${creds.apiKey.substring(0, 8)}...`)
  } catch (error) {
    console.error('Failed to derive API credentials:', (error as Error).message)
    process.exit(1)
  }

  // Step 2: Approve USDC.e for CTF Exchange
  console.log('\n--- Step 2: USDC.e Approval for CTF Exchange ---')
  await approveERC20(wallet, CONTRACTS.USDC_E, CONTRACTS.CTF_EXCHANGE, 'CTF Exchange')

  // Step 3: Approve USDC.e for Neg Risk Exchange
  console.log('\n--- Step 3: USDC.e Approval for Neg Risk Exchange ---')
  await approveERC20(wallet, CONTRACTS.USDC_E, CONTRACTS.NEG_RISK_EXCHANGE, 'Neg Risk Exchange')

  // Step 4: Approve CTF tokens for CTF Exchange
  console.log('\n--- Step 4: CTF Token Approval for CTF Exchange ---')
  await approveERC1155(wallet, CONTRACTS.CONDITIONAL_TOKENS, CONTRACTS.CTF_EXCHANGE, 'CTF Exchange')

  // Step 5: Approve CTF tokens for Neg Risk Exchange
  console.log('\n--- Step 5: CTF Token Approval for Neg Risk Exchange ---')
  await approveERC1155(wallet, CONTRACTS.CONDITIONAL_TOKENS, CONTRACTS.NEG_RISK_EXCHANGE, 'Neg Risk Exchange')

  // Step 6: Sync allowances with CLOB API
  console.log('\n--- Step 6: Sync Allowances with CLOB ---')
  try {
    await initializeClobClient()
    await updateAllowance()
    console.log('Allowances synced with CLOB API')

    // Verify balances
    const balances = await getBalances()
    console.log(`CLOB USDC balance: $${balances.usdc.toFixed(2)}`)
    console.log(`CLOB collateral allowance: $${balances.collateral.toFixed(2)}`)
  } catch (error) {
    console.error('Failed to sync with CLOB:', (error as Error).message)
  }

  console.log('\n=== Setup Complete ===')
  console.log('Your wallet is now ready for trading on Polymarket.')
}

async function approveERC20(
  wallet: Wallet,
  tokenAddress: string,
  spenderAddress: string,
  spenderName: string
): Promise<void> {
  const token = new Contract(tokenAddress, ERC20_ABI, wallet)

  // Check current allowance
  const currentAllowance = await token.allowance(await wallet.getAddress(), spenderAddress)

  // Check if already has sufficient allowance (at least half of max)
  if (currentAllowance.gte(MaxUint256.div(2))) {
    console.log(`Already approved for ${spenderName}`)
    return
  }

  console.log(`Approving USDC.e for ${spenderName}...`)

  try {
    // Use higher gas price for Polygon (base fee can spike to 500+ gwei)
    const gasOverrides = {
      maxPriorityFeePerGas: parseUnits('50', 'gwei'),
      maxFeePerGas: parseUnits('600', 'gwei'),
      gasLimit: 100000
    }
    const tx = await token.approve(spenderAddress, MaxUint256, gasOverrides)
    console.log(`Transaction sent: ${tx.hash}`)
    console.log('Waiting for confirmation...')

    const receipt = await tx.wait()
    console.log(`Approved! Gas used: ${receipt.gasUsed.toString()}`)
  } catch (error) {
    console.error(`Failed to approve: ${(error as Error).message}`)
    throw error
  }
}

async function approveERC1155(
  wallet: Wallet,
  tokenAddress: string,
  operatorAddress: string,
  operatorName: string
): Promise<void> {
  const token = new Contract(tokenAddress, ERC1155_ABI, wallet)

  // Check current approval
  const isApproved = await token.isApprovedForAll(await wallet.getAddress(), operatorAddress)

  if (isApproved) {
    console.log(`Already approved for ${operatorName}`)
    return
  }

  console.log(`Setting approval for ${operatorName}...`)

  try {
    // Use higher gas price for Polygon (base fee can spike to 500+ gwei)
    const gasOverrides = {
      maxPriorityFeePerGas: parseUnits('50', 'gwei'),
      maxFeePerGas: parseUnits('600', 'gwei'),
      gasLimit: 100000
    }
    const tx = await token.setApprovalForAll(operatorAddress, true, gasOverrides)
    console.log(`Transaction sent: ${tx.hash}`)
    console.log('Waiting for confirmation...')

    const receipt = await tx.wait()
    console.log(`Approved! Gas used: ${receipt.gasUsed.toString()}`)
  } catch (error) {
    console.error(`Failed to approve: ${(error as Error).message}`)
    throw error
  }
}

main().catch(console.error)
