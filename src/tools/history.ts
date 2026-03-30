import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { LavaApiClient } from '../api-client.js'

export function registerHistoryTools(
  server: McpServer,
  getClient: () => LavaApiClient,
) {
  server.tool(
    'lavarage_trade_history',
    `Get your trade history — every open, close, liquidation, split, merge, and repay event.

Preconditions: Must be authenticated.

Each event includes: token symbols, entry/exit price, PnL, protocol fee, gas fee, Jito tip, swap amounts, TX signature, and timestamp.

Use this to review past performance, audit fees, or find specific transactions.`,
    {
      positionAddress: z.string().optional().describe('Filter by specific position address'),
      eventType: z.string().optional().describe('Filter by event type (e.g. OPEN, CLOSE, LIQUIDATION)'),
      limit: z.number().optional().default(20).describe('Max records (default: 20)'),
      offset: z.number().optional().default(0).describe('Pagination offset'),
    },
    async ({ positionAddress, eventType, limit, offset }) => {
      try {
        const result = await getClient().getTradeHistory({
          positionAddress,
          eventType,
          limit,
          offset,
        })

        // API returns { rows: [...], total: N }
        const rows = result?.rows ?? (Array.isArray(result) ? result : [])
        const total = result?.total ?? rows.length

        if (rows.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: 'No trade history found.',
            }],
          }
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ total, showing: rows.length, events: rows }, null, 2),
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
    'lavarage_close_quote',
    `Preview the result of closing a position BEFORE committing. Does NOT execute anything.

Preconditions: Must be authenticated. Position must be open and belong to your wallet.
Input: positionAddress (base58) — get from lavarage_list_positions.

Key outputs: outAmount (quote tokens you'd receive), repayAmount (borrow repaid), fee (protocol fee), priceImpactPct.
Use this before calling lavarage_close_position to know what you'll get.`,
    {
      positionAddress: z.string().describe('The position account address (base58)'),
      slippageBps: z.number().optional().default(50).describe('Slippage tolerance in bps (default: 50 = 0.5%)'),
    },
    async ({ positionAddress, slippageBps }) => {
      try {
        const client = getClient()
        const quote = await client.getCloseQuote({
          positionAddress,
          userPublicKey: client.getWalletAddress(),
          slippageBps,
        })

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(quote, null, 2),
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

function formatError(err: any): string {
  if (err.code && err.message) {
    return `API Error [${err.code}]: ${err.message}${err.detail ? ` — ${err.detail}` : ''}`
  }
  return `Error: ${err.message ?? String(err)}`
}
