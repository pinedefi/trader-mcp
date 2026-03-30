import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { VersionedTransaction } from '@solana/web3.js'
import type { LavaApiClient } from '../api-client.js'
import type { TradingMode } from '../session.js'
import { getPrivyClient, type ServerConfig } from '../server.js'
import { toLamports } from './market.js'

export function registerTradeTools(
  server: McpServer,
  getClient: () => LavaApiClient,
  getWallet: () => string,
  getMode: () => TradingMode | null,
  config: ServerConfig,
) {
  server.tool(
    'lavarage_open_position',
    `Open a new leveraged trading position on Lavarage.

Position types (determined by the offer you choose):
- LONG: Bet the token price goes UP. You deposit SOL/USDC as collateral, borrow more, and buy the token. Profit if price rises.
- SHORT: Bet the token price goes DOWN. You deposit the token, borrow against it, and sell. Profit if price falls.
- BORROW: Simply borrow tokens against collateral. No directional bet — used for yield strategies.

The offer determines the side and token pair. Use lavarage_get_rates to find offers.

In "unsigned" mode: returns the unsigned transaction (base64) for you to sign and submit.
In "server-wallet" mode: signs and submits the transaction automatically, returns the tx signature.

Collateral can be in SOL (e.g. "0.5") or lamports (e.g. "500000000"). Values under 1000 are treated as SOL.`,
    {
      offerPublicKey: z.string().describe('The offer/pool public key (get from lavarage_get_rates)'),
      collateral: z.string().describe('Collateral — in SOL (e.g. "0.5") or lamports (e.g. "500000000")'),
      leverage: z.number().min(1.1).max(10).describe('Leverage multiplier (e.g. 3 for 3x)'),
      slippageBps: z.number().optional().default(50).describe('Slippage tolerance in bps (default: 50 = 0.5%)'),
    },
    async ({ offerPublicKey, collateral, leverage, slippageBps }) => {
      try {
        const mode = requireMode(getMode())
        const wallet = getWallet()
        const client = getClient()

        const collateralAmount = toLamports(collateral)

        // Safety guard (#13 — block, not warn)
        const collateralSol = Number(collateralAmount) / 1e9
        if (collateralSol * leverage > config.maxPositionSol) {
          return {
            content: [{
              type: 'text' as const,
              text: `BLOCKED: Position size (${collateralSol} SOL x ${leverage}x = ${(collateralSol * leverage).toFixed(1)} SOL) exceeds safety limit of ${config.maxPositionSol} SOL. Reduce collateral or leverage.`,
            }],
            isError: true,
          }
        }

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
                message: 'Transaction built. Sign this base64-encoded transaction with your wallet and submit it.',
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
    `Close an existing leveraged position on Lavarage.

For LONG positions: sells the token back, repays the borrow, returns remaining collateral + profit (or minus loss).
For SHORT positions: buys the token back, returns it, keeps the difference.
For BORROW positions: use lavarage_repay instead.

Tip: call lavarage_close_quote first to preview PnL before closing.

In "unsigned" mode: returns the unsigned transaction (base64) for you to sign and submit.
In "server-wallet" mode: signs and submits the transaction automatically, returns the tx signature.`,
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
}

function requireMode(mode: TradingMode | null): TradingMode {
  if (!mode) {
    throw new Error('Trading mode not set. Call lavarage_setup first to choose "unsigned" or "server-wallet" mode.')
  }
  return mode
}

async function signAndSubmitViaPrivy(
  transactionBase64: string,
  walletAddress: string,
  config: ServerConfig,
): Promise<string> {
  if (!config.privySigningKey) {
    throw new Error('Server-wallet mode requires PRIVY_SIGNING_KEY to be configured.')
  }

  const privyClient = await getPrivyClient(config)

  const txBuffer = Buffer.from(transactionBase64, 'base64')
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
