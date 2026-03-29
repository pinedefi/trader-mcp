import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { LavaApiClient } from '../api-client.js'

export function registerMarketTools(
  server: McpServer,
  getClient: () => LavaApiClient,
) {
  server.tool(
    'lavarage_list_tokens',
    `Search for tokens available on Lavarage. You MUST provide a search term — this tool does not dump all tokens.

Examples: "SOL", "BONK", "JUP", "USDC"`,
    { search: z.string().min(1).max(200).describe('Search by token name or symbol (required)') },
    async ({ search }) => {
      try {
        const tokens = await getClient().getTokens(search)
        const arr = Array.isArray(tokens) ? tokens : []

        // Return concise summary, not raw dump
        const results = arr.slice(0, 20).map((t: any) => ({
          symbol: t.symbol,
          name: t.name,
          mint: t.address ?? t.mint,
          price: t.price,
          priceChange24h: t.priceChange24h,
          logoUri: t.logoUri,
        }))

        if (results.length === 0) {
          return {
            content: [{ type: 'text' as const, text: `No tokens found matching "${search}".` }],
          }
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(results, null, 2),
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
    `Get lending rates and available liquidity for leverage trading. Returns the top 20 offers sorted by available liquidity.

Optionally filter by token mint address or quote currency.`,
    {
      tokenMint: z.string().optional().describe('Filter by base token mint address'),
      quoteCurrency: z.enum(['SOL', 'USDC', 'all']).optional().default('all').describe('Filter by quote currency (default: all)'),
      limit: z.number().optional().default(20).describe('Max results (default: 20, max: 50)'),
    },
    async ({ tokenMint, quoteCurrency, limit }) => {
      try {
        const offers = await getClient().getOffers()
        let filtered = Array.isArray(offers) ? offers : []

        if (tokenMint) {
          filtered = filtered.filter((o: any) =>
            o.tokenMint === tokenMint || o.quoteTokenMint === tokenMint,
          )
        }

        if (quoteCurrency && quoteCurrency !== 'all') {
          filtered = filtered.filter((o: any) => {
            const qs = (o.quoteToken?.symbol ?? o.quoteSymbol ?? '').toUpperCase()
            return qs === quoteCurrency.toUpperCase() || (quoteCurrency === 'SOL' && qs === 'WSOL')
          })
        }

        // Sort by available liquidity (descending), take top N
        const cap = Math.min(limit ?? 20, 50)
        const sorted = filtered
          .sort((a: any, b: any) => {
            const la = Number(a.availableLiquidity ?? a.vaultBalance ?? 0)
            const lb = Number(b.availableLiquidity ?? b.vaultBalance ?? 0)
            return lb - la
          })
          .slice(0, cap)

        const summary = sorted.map((o: any) => ({
          offerPublicKey: o.publicKey,
          tokenSymbol: o.token?.symbol ?? o.tokenSymbol ?? 'unknown',
          tokenMint: o.tokenMint,
          quoteSymbol: o.quoteToken?.symbol ?? o.quoteSymbol ?? 'unknown',
          maxLeverage: o.maxLeverage,
          borrowApr: o.borrowApr,
          availableLiquidity: o.availableLiquidity ?? o.vaultBalance,
          tags: o.tags,
        }))

        if (summary.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No offers found matching your filters.' }],
          }
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              total: filtered.length,
              showing: summary.length,
              offers: summary,
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
    'lavarage_get_quote',
    `Get a leverage trade quote before opening a position. Shows expected swap output, fees, and price impact.

Collateral can be specified in SOL (e.g. "0.5") or lamports (e.g. "500000000"). If the value is less than 1000, it's treated as SOL and auto-converted to lamports.`,
    {
      offerPublicKey: z.string().describe('The offer/pool public key (get from lavarage_get_rates)'),
      collateral: z.string().describe('Collateral amount — in SOL (e.g. "0.5") or lamports (e.g. "500000000")'),
      leverage: z.number().min(1.1).max(10).describe('Leverage multiplier (e.g. 3 for 3x)'),
      slippageBps: z.number().optional().default(50).describe('Slippage tolerance in basis points (default: 50 = 0.5%)'),
    },
    async ({ offerPublicKey, collateral, leverage, slippageBps }) => {
      try {
        const client = getClient()
        const collateralLamports = toLamports(collateral)

        const quote = await client.getOpenQuote({
          offerPublicKey,
          userPublicKey: client.getWalletAddress(),
          collateralAmount: collateralLamports,
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

/** Convert a string amount to lamports. If < 1000, treat as SOL and multiply by 1e9. */
export function toLamports(amount: string): string {
  const num = Number(amount)
  if (isNaN(num) || num <= 0) throw new Error(`Invalid amount: ${amount}`)
  // If it looks like SOL (small number), convert to lamports
  if (num < 1000) {
    return Math.round(num * 1e9).toString()
  }
  return Math.round(num).toString()
}

function formatError(err: any): string {
  if (err.code && err.message) {
    return `API Error [${err.code}]: ${err.message}${err.detail ? ` — ${err.detail}` : ''}`
  }
  return `Error: ${err.message ?? String(err)}`
}
