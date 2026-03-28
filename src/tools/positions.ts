import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { LavaApiClient } from '../api-client.js'

export function registerPositionTools(
  server: McpServer,
  getClient: () => LavaApiClient,
) {
  server.tool(
    'lavarage_list_positions',
    'List your open or closed leveraged positions on Lavarage. Shows PnL, leverage, liquidation price, and more for each position.',
    {
      status: z.enum(['OPEN', 'CLOSED', 'ALL']).optional().default('OPEN')
        .describe('Filter by position status (default: OPEN)'),
    },
    async ({ status }) => {
      try {
        const positions = await getClient().getPositions(status)

        if (!Array.isArray(positions) || positions.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `No ${status?.toLowerCase() ?? 'open'} positions found.`,
            }],
          }
        }

        const summary = positions.map((p: any) => ({
          address: p.address,
          side: p.side,
          status: p.status,
          tokenSymbol: p.tokenSymbol ?? p.baseTokenSymbol,
          quoteSymbol: p.quoteTokenSymbol,
          collateral: p.collateral,
          leverage: p.leverage,
          entryPrice: p.entryPrice,
          currentPrice: p.currentPrice,
          liquidationPrice: p.liquidationPrice,
          unrealizedPnl: p.unrealizedPnl,
          roiPercent: p.roiPercent,
          borrowedAmount: p.borrowedAmount,
          interestAccrued: p.interestAccrued,
          createdAt: p.createdAt,
        }))

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(summary, null, 2),
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
    'lavarage_get_position',
    'Get detailed information about a specific position including PnL, fees, interest, and liquidation price.',
    {
      positionAddress: z.string().describe('The on-chain position account address (base58)'),
    },
    async ({ positionAddress }) => {
      try {
        const position = await getClient().getPosition(positionAddress)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(position, null, 2),
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
