import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { LavaApiClient } from '../api-client.js'

export function registerHistoryTools(
  server: McpServer,
  getClient: () => LavaApiClient,
) {
  server.tool(
    'lavarage_trade_history',
    'Get your trade history — past opens, closes, liquidations, and other events.',
    {
      positionAddress: z.string().optional().describe('Filter by specific position address'),
      eventType: z.string().optional().describe('Filter by event type (e.g. OPEN, CLOSE, LIQUIDATION)'),
      limit: z.number().optional().default(20).describe('Max records (default: 20)'),
      offset: z.number().optional().default(0).describe('Pagination offset'),
    },
    async ({ positionAddress, eventType, limit, offset }) => {
      try {
        const events = await getClient().getTradeHistory({
          positionAddress,
          eventType,
          limit,
          offset,
        })

        if (!Array.isArray(events) || events.length === 0) {
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
            text: JSON.stringify(events, null, 2),
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
    'Preview the result of closing a position — shows expected PnL, fees, and amount received before you commit.',
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
