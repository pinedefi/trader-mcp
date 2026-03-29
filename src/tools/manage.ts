import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { VersionedTransaction } from '@solana/web3.js'
import type { LavaApiClient } from '../api-client.js'
import type { TradingMode } from '../session.js'
import { getPrivyClient, type ServerConfig } from '../server.js'

export function registerManageTools(
  server: McpServer,
  getClient: () => LavaApiClient,
  getWallet: () => string,
  getMode: () => TradingMode | null,
  config: ServerConfig,
) {
  server.tool(
    'lavarage_partial_sell',
    `Sell a portion of a position (take partial profit). Specify what percentage to sell.

This is a two-step operation: split the position, then close the split portion.

In "unsigned" mode: returns both unsigned transactions (split + close). Submit them sequentially — split first, then close.
In "server-wallet" mode: signs and submits both transactions sequentially.

If the close step fails after the split succeeds, you will have two separate positions (the original reduced portion and the split portion). This is safe — no funds are lost. Simply call lavarage_close_position on the split portion to complete the sale, or keep it as a separate position.`,
    {
      positionAddress: z.string().describe('The position account address (base58)'),
      sellPercent: z.number().min(1).max(99).describe('Percentage of position to sell (e.g. 50 = sell half)'),
      slippageBps: z.number().optional().default(50).describe('Slippage tolerance in bps'),
    },
    async ({ positionAddress, sellPercent, slippageBps }) => {
      try {
        const mode = requireMode(getMode())
        const wallet = getWallet()
        const client = getClient()

        const result = await client.buildPartialSellTx({
          positionAddress,
          userPublicKey: wallet,
          splitRatioBps: sellPercent * 100,
          slippageBps,
        })

        if (mode === 'unsigned') {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                mode: 'unsigned',
                splitTransaction: result.splitTransaction,
                closeTransaction: result.closeTransaction,
                newPositionAddresses: result.newPositionAddresses,
                message: `Partial sell transactions built (${sellPercent}%). Sign both transactions and submit as a Jito bundle.`,
              }, null, 2),
            }],
          }
        }

        // Server-wallet: sign both and submit as bundle
        const txSig = await signAndSubmitViaPrivy(result.splitTransaction, wallet, config)
        const txSig2 = await signAndSubmitViaPrivy(result.closeTransaction, wallet, config)

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              mode: 'server-wallet',
              splitSignature: txSig,
              closeSignature: txSig2,
              message: `Sold ${sellPercent}% of position. Split TX: ${txSig}, Close TX: ${txSig2}`,
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
    'lavarage_repay',
    `Fully repay a borrow position (return borrowed tokens to the lender).

In "unsigned" mode: returns unsigned transaction.
In "server-wallet" mode: signs and submits automatically.`,
    {
      positionAddress: z.string().describe('The borrow position account address (base58)'),
    },
    async ({ positionAddress }) => {
      try {
        const mode = requireMode(getMode())
        const wallet = getWallet()
        const client = getClient()

        const result = await client.buildRepayTx({
          positionAddress,
          userPublicKey: wallet,
        })

        return handleTxResult(mode, result, 'Repay', wallet, config)
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: formatError(err) }],
          isError: true,
        }
      }
    },
  )

  server.tool(
    'lavarage_partial_repay',
    `Partially repay a borrow position. Specify what percentage to repay.

In "unsigned" mode: returns unsigned transaction.
In "server-wallet" mode: signs and submits automatically.`,
    {
      positionAddress: z.string().describe('The borrow position account address (base58)'),
      repayPercent: z.number().min(1).max(100).describe('Percentage of borrow to repay (e.g. 50 = repay half)'),
    },
    async ({ positionAddress, repayPercent }) => {
      try {
        const mode = requireMode(getMode())
        const wallet = getWallet()
        const client = getClient()

        const result = await client.buildPartialRepayTx({
          positionAddress,
          userPublicKey: wallet,
          repaymentBps: repayPercent * 100,
        })

        return handleTxResult(mode, result, 'Partial repay', wallet, config)
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: formatError(err) }],
          isError: true,
        }
      }
    },
  )

  server.tool(
    'lavarage_split_position',
    `Split a position into two. The new position gets the specified percentage.

In "unsigned" mode: returns unsigned transaction.
In "server-wallet" mode: signs and submits automatically.`,
    {
      positionAddress: z.string().describe('The position account address (base58)'),
      splitPercent: z.number().min(1).max(99).describe('Percentage for the new position (e.g. 50 = split in half)'),
    },
    async ({ positionAddress, splitPercent }) => {
      try {
        const mode = requireMode(getMode())
        const wallet = getWallet()
        const client = getClient()

        const result = await client.buildSplitTx({
          positionAddress,
          userPublicKey: wallet,
          splitRatioBps: splitPercent * 100,
        })

        return handleTxResult(mode, result, 'Split', wallet, config)
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: formatError(err) }],
          isError: true,
        }
      }
    },
  )

  server.tool(
    'lavarage_merge_positions',
    `Merge two positions into one. Both must be the same token pair and side.

In "unsigned" mode: returns unsigned transaction.
In "server-wallet" mode: signs and submits automatically.`,
    {
      firstPositionAddress: z.string().describe('First position address (base58)'),
      secondPositionAddress: z.string().describe('Second position address (base58) — merges into first'),
    },
    async ({ firstPositionAddress, secondPositionAddress }) => {
      try {
        const mode = requireMode(getMode())
        const wallet = getWallet()
        const client = getClient()

        const result = await client.buildMergeTx({
          firstPositionAddress,
          secondPositionAddress,
          userPublicKey: wallet,
        })

        return handleTxResult(mode, result, 'Merge', wallet, config)
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
    throw new Error('Trading mode not set. Call lavarage_setup first.')
  }
  return mode
}

async function handleTxResult(
  mode: TradingMode,
  result: any,
  action: string,
  wallet: string,
  config: ServerConfig,
) {
  if (mode === 'unsigned') {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          mode: 'unsigned',
          transaction: result.transaction,
          lastValidBlockHeight: result.lastValidBlockHeight,
          message: `${action} transaction built. Sign and submit.`,
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
        message: `${action} complete! TX: ${txSig}`,
      }, null, 2),
    }],
  }
}

async function signAndSubmitViaPrivy(
  transactionBase64: string,
  walletAddress: string,
  config: ServerConfig,
): Promise<string> {
  if (!config.privySigningKey) {
    throw new Error('Server-wallet mode requires PRIVY_SIGNING_KEY.')
  }

  const privyClient = await getPrivyClient(config)

  const txBuffer = Buffer.from(transactionBase64, 'base64')
  const tx = VersionedTransaction.deserialize(txBuffer)

  const { hash } = await privyClient.walletApi.solana.signAndSendTransaction({
    address: walletAddress,
    caip2: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    chainType: 'solana',
    transaction: tx,
  })

  return hash
}

function formatError(err: any): string {
  if (err.code && err.message) {
    return `API Error [${err.code}]: ${err.message}${err.detail ? ` — ${err.detail}` : ''}`
  }
  return `Error: ${err.message ?? String(err)}`
}
