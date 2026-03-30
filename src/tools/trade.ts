import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { VersionedTransaction } from '@solana/web3.js'
import type { LavaApiClient } from '../api-client.js'
import type { TradingMode } from '../session.js'
import { getPrivyClient, type ServerConfig } from '../server.js'
import { toSmallestUnits } from './market.js'

export function registerTradeTools(
  server: McpServer,
  getClient: () => LavaApiClient,
  getWallet: () => string,
  getMode: () => TradingMode | null,
  config: ServerConfig,
) {
  server.tool(
    'lavarage_open_position',
    `Open a new leveraged trading position on Lavarage. THIS EXECUTES A REAL TRADE.

Preconditions: Must be authenticated + mode set. Need offerPublicKey from lavarage_get_rates.
Recommended: Call lavarage_get_quote first with the same params to preview the trade.

Position types (determined by the offer):
- LONG: Price up = profit. Deposit quote token (SOL/USDC), borrow more, buy base token.
- SHORT: Price down = profit. Deposit base token, borrow, sell.
- BORROW: No directional bet. Borrow tokens against collateral.

Collateral = initial margin in quote token (SOL or USDC). 

Outputs:
- server-wallet mode: returns { signature } — the on-chain TX signature. Trade is done.
- unsigned mode: returns { transaction } — base58-encoded TX to sign externally.
- If position size exceeds safety limit: returns error (BLOCKED).

Warnings: Trades with MEV protection via Astralane. Fees deducted from collateral.`,
    {
      offerPublicKey: z.string().describe('The offer/pool public key (get from lavarage_get_rates)'),
      collateral: z.string().describe('Collateral in quote token smallest units: lamports for SOL (e.g. "50000000" = 0.05 SOL), micro-USDC for USDC (e.g. "5000000" = 5 USDC). '),
      leverage: z.number().min(1.1).max(10).describe('Leverage multiplier (e.g. 3 for 3x)'),
      slippageBps: z.number().optional().default(50).describe('Slippage tolerance in bps (default: 50 = 0.5%)'),
    },
    async ({ offerPublicKey, collateral, leverage, slippageBps }) => {
      try {
        const mode = requireMode(getMode())
        const wallet = getWallet()
        const client = getClient()

        const collateralAmount = toSmallestUnits(collateral)

        const { tipLamports } = await client.getTipFloor()

        const result = await client.buildOpenTx({
          offerPublicKey,
          userPublicKey: wallet,
          collateralAmount,
          leverage,
          slippageBps,
          astralaneTipLamports: tipLamports,
        })

        if (mode === 'unsigned') {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                mode: 'unsigned',
                transaction: result.transaction,
                lastValidBlockHeight: result.lastValidBlockHeight,
                message: 'Transaction built. Sign this base58-encoded transaction with your wallet and submit it.',
              }, null, 2),
            }],
          }
        }

        const txSig = await signAndSubmitViaPrivy(result.transaction, wallet, config)

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              mode: 'server-wallet',
              signature: txSig,
              message: `Position opened! TX: ${txSig}`,
            }, null, 2),
          }],
        }
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: formatError(err) }],
          isError: true,
        }
      }
    },
  )

  server.tool(
    'lavarage_close_position',
    `Close an existing leveraged position. THIS EXECUTES A REAL TRADE.

Preconditions: Must be authenticated + mode set. Position must belong to your wallet.
Recommended: Call lavarage_close_quote first to preview PnL, fees, and proceeds.

What happens:
- LONG: Sells base tokens back to quote, repays borrow, returns remaining collateral + profit (or minus loss).
- SHORT: Buys base tokens back, returns them, keeps the difference.
- BORROW: Use lavarage_repay instead (this tool won't work for borrows).

Input: positionAddress (base58) — get from lavarage_list_positions.

Outputs:
- server-wallet mode: returns { signature } — on-chain TX signature. Position is closed.
- unsigned mode: returns { transaction } — base58-encoded TX to sign externally.

Includes MEV protection via Astralane.`,
    {
      positionAddress: z.string().describe('The on-chain position account address (base58)'),
      slippageBps: z.number().optional().default(50).describe('Slippage tolerance in bps (default: 50 = 0.5%)'),
    },
    async ({ positionAddress, slippageBps }) => {
      try {
        const mode = requireMode(getMode())
        const wallet = getWallet()
        const client = getClient()

        // Ownership check (#7 — defense in depth)
        const position = await client.getPosition(positionAddress)
        if (position.owner !== wallet) {
          return {
            content: [{
              type: 'text' as const,
              text: `BLOCKED: Position ${positionAddress} does not belong to your wallet (${wallet}).`,
            }],
            isError: true,
          }
        }

        const { tipLamports } = await client.getTipFloor()

        const result = await client.buildCloseTx({
          positionAddress,
          userPublicKey: wallet,
          slippageBps,
          astralaneTipLamports: tipLamports,
        })

        if (mode === 'unsigned') {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                mode: 'unsigned',
                transaction: result.transaction,
                lastValidBlockHeight: result.lastValidBlockHeight,
                message: 'Close transaction built. Sign and submit to close your position.',
              }, null, 2),
            }],
          }
        }

        const txSig = await signAndSubmitViaPrivy(result.transaction, wallet, config)

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              mode: 'server-wallet',
              signature: txSig,
              message: `Position closed! TX: ${txSig}`,
            }, null, 2),
          }],
        }
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: formatError(err) }],
          isError: true,
        }
      }
    },
  )

  server.tool(
    'lavarage_borrow',
    `Borrow tokens against collateral on Lavarage. No directional bet — just access to liquidity.

Use this when you want to borrow tokens without taking a leveraged position. For example:
- Borrow USDC against your SOL (keep SOL exposure, get liquid USDC)
- Borrow SOL against USDC
- Borrow any supported token

How it works:
1. You deposit collateral (quote token: SOL or USDC)
2. Lavarage lends you tokens from its lending pools
3. You receive the borrowed tokens in your wallet
4. Repay anytime with lavarage_repay or lavarage_partial_repay

The leverage parameter controls your loan-to-value ratio:
- 2x = borrow equal to your collateral (50% LTV)
- 3x = borrow 2x your collateral (67% LTV)
- Higher = more borrowed, closer to liquidation

Preconditions: Must be authenticated + mode set. Need an offerPublicKey from lavarage_get_rates.
Recommended: Call lavarage_get_rates to find borrow offers, then lavarage_get_quote to preview.

Outputs:
- server-wallet mode: returns { signature } — on-chain TX. Borrowed tokens are in your wallet.
- unsigned mode: returns { transaction } — base58-encoded TX to sign externally.`,
    {
      offerPublicKey: z.string().describe('The offer/pool public key (get from lavarage_get_rates — look for BORROW side offers)'),
      collateral: z.string().describe('Collateral in quote token smallest units: lamports for SOL (e.g. "50000000" = 0.05 SOL), micro-USDC for USDC (e.g. "5000000" = 5 USDC). '),
      leverage: z.number().min(1.1).max(10).describe('Borrow ratio — 2x = borrow equal to collateral, 3x = borrow 2x collateral'),
      slippageBps: z.number().optional().default(50).describe('Slippage tolerance in bps (default: 50)'),
    },
    async ({ offerPublicKey, collateral, leverage, slippageBps }) => {
      try {
        const mode = requireMode(getMode())
        const wallet = getWallet()
        const client = getClient()

        const collateralAmount = toSmallestUnits(collateral)

        const { tipLamports } = await client.getTipFloor()

        const result = await client.buildOpenTx({
          offerPublicKey,
          userPublicKey: wallet,
          collateralAmount,
          leverage,
          slippageBps,
          astralaneTipLamports: tipLamports,
        })

        if (mode === 'unsigned') {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                mode: 'unsigned',
                transaction: result.transaction,
                lastValidBlockHeight: result.lastValidBlockHeight,
                message: 'Borrow transaction built. Sign and submit to receive borrowed tokens.',
              }, null, 2),
            }],
          }
        }

        const txSig = await signAndSubmitViaPrivy(result.transaction, wallet, config)

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              mode: 'server-wallet',
              signature: txSig,
              message: `Borrow complete! Tokens are in your wallet. TX: ${txSig}. Use lavarage_repay when ready to return them.`,
            }, null, 2),
          }],
        }
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: formatError(err) }],
          isError: true,
        }
      }
    },
  )
}

function requireMode(mode: TradingMode | null): TradingMode {
  if (!mode) {
    throw new Error('Trading mode not set. Call lavarage_setup first to choose "unsigned" or "server-wallet" mode.')
  }
  return mode
}

async function signAndSubmitViaPrivy(
  transactionBase58: string,
  walletAddress: string,
  config: ServerConfig,
): Promise<string> {
  if (!config.privySigningKey) {
    throw new Error('Server-wallet mode requires PRIVY_SIGNING_KEY to be configured.')
  }

  const privyClient = await getPrivyClient(config)

  // API returns base58-encoded transactions
  const bs58 = await import('bs58')
  const txBuffer = Buffer.from(bs58.default.decode(transactionBase58))
  const tx = VersionedTransaction.deserialize(txBuffer)

  // Timeout after 30 seconds to prevent infinite hangs
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Privy signing timed out after 30s. The wallet may not have delegated to the MCP key quorum. Try reconnecting or use unsigned mode.')), 30_000),
  )

  try {
    const result = await Promise.race([
      privyClient.walletApi.solana.signAndSendTransaction({
        address: walletAddress,
        caip2: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        chainType: 'solana',
        transaction: tx,
      }),
      timeout,
    ])

    return result.hash
  } catch (err: any) {
    console.error(`Privy sign error for ${walletAddress}:`, err.message ?? err)
    throw err
  }
}

function formatError(err: any): string {
  if (err.code && err.message) {
    return `API Error [${err.code}]: ${err.message}${err.detail ? ` — ${err.detail}` : ''}`
  }
  return `Error: ${err.message ?? String(err)}`
}
