import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { LavaApiClient } from '../api-client.js'

export function registerMarketTools(
  server: McpServer,
  getClient: () => LavaApiClient,
) {
  server.tool(
    'lavarage_list_tokens',
    'List all supported tokens on Lavarage with current prices and metadata.',
    { search: z.string().optional().describe('Optional search filter by token name or symbol') },
    async ({ search }) => {
      try {
        const tokens = await getClient().getTokens(search)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(tokens, null, 2),
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
    'lavarage_get_rates',
    'Get current lending rates and available liquidity for leverage trading. Shows APR, max leverage, and pool size for each offer.',
    { tokenMint: z.string().optional().describe('Filter by specific token mint address') },
    async ({ tokenMint }) => {
      try {
        const offers = await getClient().getOffers()
        let filtered = offers
        if (tokenMint) {
          filtered = offers.filter((o: any) =>
            o.tokenMint === tokenMint ||
            o.quoteTokenMint === tokenMint,
          )
        }

        const summary = filtered.map((o: any) => ({
          offerPublicKey: o.publicKey,
          tokenSymbol: o.token?.symbol ?? 'unknown',
          quoteSymbol: o.quoteToken?.symbol ?? 'unknown',
          maxLeverage: o.maxLeverage,
          borrowApr: o.borrowApr,
          availableLiquidity: o.availableLiquidity,
          tags: o.tags,
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
    'lavarage_get_quote',
    'Get a leverage trade quote. Shows expected position size, borrowed amount, fees, and liquidation price before opening a position.',
    {
      offerPublicKey: z.string().describe('The offer/pool public key to trade against (get from lavarage_get_rates)'),
      collateralAmount: z.string().describe('Collateral amount in lamports (1 SOL = 1000000000 lamports)'),
      leverage: z.number().min(1.1).max(10).describe('Leverage multiplier (e.g. 3 for 3x)'),
      slippageBps: z.number().optional().default(50).describe('Slippage tolerance in basis points (default: 50 = 0.5%)'),
    },
    async ({ offerPublicKey, collateralAmount, leverage, slippageBps }) => {
      try {
        const client = getClient()
        const quote = await client.getOpenQuote({
          offerPublicKey,
          userPublicKey: client['wallet'],
          collateralAmount,
          leverage,
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
