import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { LavaApiClient } from '../api-client.js'

export function registerPositionTools(
  server: McpServer,
  getClient: () => LavaApiClient,
) {
  server.tool(
    'lavarage_list_positions',
    `List your open or closed leveraged positions on Lavarage.

Position sides: LONG (betting price goes up), SHORT (betting price goes down), BORROW (borrowed tokens, no directional bet).
Status: OPEN/EXECUTED = active position, CLOSED = settled.`,
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

        const summary = positions.map((p: any) => {
          // Compute derived fields from raw position data
          const baseDecimals = p.baseTokenDecimals ?? 9
          const quoteDecimals = p.quoteTokenDecimals ?? 9
          const basePrice = p.baseTokenPrice ? Number(p.baseTokenPrice) : null
          const quotePrice = p.quoteTokenPrice ? Number(p.quoteTokenPrice) : null
          const entryPrice = p.entryPrice ? Number(p.entryPrice) : null
          const leverage = p.leverage ? Number(p.leverage) : null
          const collateralRaw = p.collateralAmount ? Number(p.collateralAmount) : null
          const positionSizeRaw = p.positionSize ? Number(p.positionSize) : null
          const apr = p.offerApr ? Number(p.offerApr) : null
          const liqLtv = p.offerLiquidationLtv ? Number(p.offerLiquidationLtv) : (p.liquidationLtv ? Number(p.liquidationLtv) : null)

          // Human-readable amounts
          const collateral = collateralRaw !== null ? collateralRaw / Math.pow(10, quoteDecimals) : null
          const positionSize = positionSizeRaw !== null ? positionSizeRaw / Math.pow(10, baseDecimals) : null

          // Borrowed = (collateral * leverage) - collateral = collateral * (leverage - 1)
          const borrowed = (collateral !== null && leverage !== null) ? collateral * (leverage - 1) : null

          // Current price: use base token price / quote token price (both in USD)
          const currentPrice = (basePrice !== null && quotePrice !== null && quotePrice > 0)
            ? basePrice / quotePrice
            : null

          // PnL: (currentPrice - entryPrice) * positionSize (in quote token terms)
          let unrealizedPnl: number | null = null
          let roiPercent: number | null = null
          if (currentPrice !== null && entryPrice !== null && positionSize !== null && collateral !== null && p.side === 'LONG') {
            unrealizedPnl = (currentPrice - entryPrice) * positionSize
            roiPercent = collateral > 0 ? (unrealizedPnl / collateral) * 100 : null
          }

          // Liquidation price (simplified: entryPrice * (1 - 1/(leverage * liqLtv)))
          let liquidationPrice: number | null = null
          if (entryPrice !== null && leverage !== null && liqLtv !== null && p.side === 'LONG') {
            liquidationPrice = entryPrice * (1 - (1 / (leverage * liqLtv)))
          }

          // Interest: daily cost based on APR
          const dailyInterest = (borrowed !== null && apr !== null) ? (borrowed * apr / 100 / 365) : null

          return {
            address: p.address,
            side: p.side,
            status: p.status,
            baseTokenSymbol: p.baseTokenSymbol ?? null,
            baseTokenName: p.baseTokenName ?? null,
            quoteTokenSymbol: p.quoteTokenSymbol ?? null,
            leverage: p.leverage,
            entryPrice: entryPrice,
            currentPrice: currentPrice,
            collateral: collateral,
            collateralUnit: p.quoteTokenSymbol ?? 'unknown',
            positionSize: positionSize,
            positionSizeUnit: p.baseTokenSymbol ?? 'unknown',
            borrowed: borrowed,
            unrealizedPnl: unrealizedPnl !== null ? Number(unrealizedPnl.toFixed(6)) : null,
            roiPercent: roiPercent !== null ? Number(roiPercent.toFixed(2)) : null,
            liquidationPrice: liquidationPrice !== null ? Number(liquidationPrice.toFixed(6)) : null,
            apr: apr,
            dailyInterest: dailyInterest !== null ? Number(dailyInterest.toFixed(6)) : null,
            closeType: p.closeType ?? null,
            exitPrice: p.exitPrice ? Number(p.exitPrice) : null,
            realizedPnl: p.realizedPnl ? Number(p.realizedPnl) : null,
            createdAt: p.createdAt,
          }
        })

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
