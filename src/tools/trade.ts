import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Keypair, VersionedTransaction } from '@solana/web3.js'
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
  getLocalKeypair?: () => Keypair | null,
) {
  const submitTx = (txBase58: string, wallet: string, mode: TradingMode) =>
    submitTransaction(txBase58, wallet, mode, config, getLocalKeypair)

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

MEV protection:
- In server-wallet mode, submits via Astralane (MEV-protected).
- In unsigned mode, the returned transaction is MEV-protected only if astralaneTipLamports is set; otherwise it's a standard tx the caller must submit themselves.

Fees deducted from collateral.`,
    {
      offerPublicKey: z.string().describe('The offer/pool public key (get from lavarage_get_rates)'),
      collateral: z.string().describe('Collateral amount. Two formats: with token name (e.g. "5 USDC", "0.05 SOL") or raw smallest units (e.g. "5000000"). If you include SOL/USDC/WSOL suffix, the amount is auto-converted. '),
      leverage: z.number().min(1.1).max(100).describe('Leverage multiplier (e.g. 3 for 3x)'),
      slippageBps: z.number().optional().default(50).describe('Slippage tolerance in bps (default: 50 = 0.5%)'),
      astralaneTipLamports: z.number().min(10000).optional().describe('Optional Astralane MEV-protect tip in lamports (min 10000). When set, the built transaction includes a tip instruction; submit it via /api/v1/bundle/submit with mevProtect=true for MEV protection.'),
    },
    async ({ offerPublicKey, collateral, leverage, slippageBps, astralaneTipLamports }) => {
      try {
        const mode = requireMode(getMode())
        const wallet = getWallet()
        const client = getClient()

        const collateralAmount = toSmallestUnits(collateral)

        // In server-wallet/local mode the server submits via Astralane, so we
        // always include a tip. In unsigned mode, only include a tip if the
        // caller explicitly requested MEV protection.
        let tipLamports: number | undefined
        if (mode === 'unsigned') {
          tipLamports = astralaneTipLamports
        } else {
          tipLamports = astralaneTipLamports ?? (await client.getTipFloor()).tipLamports
        }

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

        const txSig = await submitTx(result.transaction, wallet, mode)

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              mode,
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

        const txSig = await submitTx(result.transaction, wallet, mode)

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              mode,
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
3. Receives the borrowed quote tokens directly into your wallet for most offers. Some borrow offers route through a swap depending on the underlying liquidity path.
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
      collateral: z.string().describe('Collateral amount. Two formats: with token name (e.g. "5 USDC", "0.05 SOL") or raw smallest units (e.g. "5000000"). If you include SOL/USDC/WSOL suffix, the amount is auto-converted. '),
      leverage: z.number().min(1.1).max(100).describe('Borrow ratio — 2x = borrow equal to collateral, 3x = borrow 2x collateral'),
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

        const txSig = await submitTx(result.transaction, wallet, mode)

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              mode,
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

async function submitTransaction(
  transactionBase58: string,
  walletAddress: string,
  mode: TradingMode,
  config: ServerConfig,
  getLocalKeypair?: () => Keypair | null,
): Promise<string> {
  if (mode === 'local') {
    const keypair = getLocalKeypair?.()
    if (!keypair) throw new Error('Local mode requires a loaded keypair.')
    return signAndSubmitLocal(transactionBase58, keypair, config.solanaRpcUrl)
  }
  return signAndSubmitViaPrivy(transactionBase58, walletAddress, config)
}

async function signAndSubmitLocal(
  transactionBase58: string,
  keypair: Keypair,
  rpcUrl: string,
): Promise<string> {
  const bs58 = await import('bs58')
  const txBuffer = Buffer.from(bs58.default.decode(transactionBase58))
  const tx = VersionedTransaction.deserialize(txBuffer)
  tx.sign([keypair])

  const { Connection } = await import('@solana/web3.js')
  const conn = new Connection(rpcUrl, 'confirmed')
  return conn.sendRawTransaction(tx.serialize(), { skipPreflight: true })
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

  const bs58 = await import('bs58')
  const txBuffer = Buffer.from(bs58.default.decode(transactionBase58))
  const tx = VersionedTransaction.deserialize(txBuffer)

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Privy signing timed out after 30s. The wallet may not have delegated to the MCP key quorum. Try reconnecting or use unsigned mode.')), 30_000),
  )

  try {
    const signed = await Promise.race([
      privyClient.walletApi.solana.signTransaction({
        address: walletAddress,
        chainType: 'solana',
        transaction: tx,
      }),
      timeout,
    ])

    const signedTx: VersionedTransaction =
      signed.signedTransaction ?? signed.transaction ?? signed
    const rawBytes =
      signedTx instanceof Uint8Array ? signedTx : signedTx.serialize()

    const { Connection } = await import('@solana/web3.js')
    const conn = new Connection(config.solanaRpcUrl, 'confirmed')
    const signature = await conn.sendRawTransaction(rawBytes, {
      skipPreflight: true,
    })
    return signature
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
