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

Returns tradeable tokens with their best offer, price, max leverage, and available liquidity. Use lavarage_get_rates for more detailed offer data.

Examples: "SOL", "BONK", "JUP", "BTC", "cbBTC"`,
    { search: z.string().min(1).max(200).describe('Search by token name or symbol (required)') },
    async ({ search }) => {
      try {
        // Use the offers endpoint with search — it has proper token search + join
        const offers = await getClient().getOffers({ search, limit: 40 })
        const arr = Array.isArray(offers) ? offers : []

        // Deduplicate by traded token, keep best offer
        const seen = new Map<string, any>()
        for (const o of arr) {
          const mint = o.tradedTokenAddress ?? o.tokenMint
          if (!mint) continue
          const existing = seen.get(mint)
          if (!existing || Number(o.availableForOpen ?? 0) > Number(existing.availableForOpen ?? 0)) {
            seen.set(mint, o)
          }
        }

        const results = Array.from(seen.values()).slice(0, 20).map((o: any) => ({
          symbol: o.baseToken?.symbol ?? o.token?.symbol ?? 'unknown',
          name: o.baseToken?.name ?? o.token?.name ?? null,
          mint: o.tradedTokenAddress ?? o.tokenMint,
          price: o.baseToken?.price ?? o.token?.price ?? null,
          maxLeverage: o.maxLeverage,
          quoteSymbol: o.quoteToken?.symbol ?? 'unknown',
          availableLiquidity: o.availableForOpen ?? o.availableLiquidity,
          bestOfferKey: o.publicKey,
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
    `Get available offers for leverage trading, sorted by liquidity. Each offer represents a lending pool you can trade against.

An offer defines: the token pair (e.g. SOL→cbBTC), max leverage, borrow APR, and available liquidity. Pass the offerPublicKey to lavarage_get_quote or lavarage_open_position.

To go LONG on a token: find an offer where that token is the output (tokenSymbol). You deposit the quote currency (SOL/USDC) and receive the token.
To go SHORT: find an offer where the token you want to short is the input.

Search examples: "BTC", "SOL", "BONK", "JUP". The search matches token name and symbol.`,
    {
      search: z.string().optional().describe('Search by token name or symbol (e.g. "BTC", "BONK")'),
      tokenMint: z.string().optional().describe('Filter by base token mint address'),
      quoteCurrency: z.enum(['SOL', 'USDC', 'all']).optional().default('all').describe('Filter by quote currency (default: all)'),
      limit: z.number().optional().default(20).describe('Max results (default: 20, max: 50)'),
    },
    async ({ search, tokenMint, quoteCurrency, limit }) => {
      try {
        // Use server-side search when available
        const quoteTokenMap: Record<string, string> = {
          SOL: 'So11111111111111111111111111111111111111112',
          USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        }

        const offers = await getClient().getOffers({
          search: search || undefined,
          quoteToken: (quoteCurrency && quoteCurrency !== 'all') ? quoteTokenMap[quoteCurrency] : undefined,
          limit: Math.min(limit ?? 20, 50),
        })

        let filtered = Array.isArray(offers) ? offers : []

        if (tokenMint) {
          filtered = filtered.filter((o: any) =>
            o.tokenMint === tokenMint || o.tradedTokenAddress === tokenMint || o.quoteTokenMint === tokenMint,
          )
        }

        // Deduplicate: keep best offer per traded token + quote token pair
        const seen = new Map<string, any>()
        for (const o of filtered) {
          const key = `${o.tradedTokenAddress ?? o.tokenMint}:${o.quoteTokenAddress ?? o.quoteTokenMint}`
          const existing = seen.get(key)
          if (!existing || Number(o.availableLiquidity ?? o.availableForOpen ?? 0) > Number(existing.availableLiquidity ?? existing.availableForOpen ?? 0)) {
            seen.set(key, o)
          }
        }

        const deduped = Array.from(seen.values()).slice(0, Math.min(limit ?? 20, 50))

        const summary = deduped.map((o: any) => ({
          offerPublicKey: o.publicKey,
          tokenSymbol: o.baseToken?.symbol ?? o.token?.symbol ?? o.tokenSymbol ?? 'unknown',
          tokenName: o.baseToken?.name ?? o.token?.name ?? null,
          tokenMint: o.tradedTokenAddress ?? o.tokenMint,
          quoteSymbol: o.quoteToken?.symbol ?? o.quoteSymbol ?? 'unknown',
          maxLeverage: o.maxLeverage,
          borrowApr: o.apr ?? o.borrowApr,
          availableLiquidity: o.availableForOpen ?? o.availableLiquidity ?? o.vaultBalance,
          side: o.side,
          price: o.baseToken?.price ?? o.token?.price ?? null,
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
    `Preview a trade BEFORE opening. Shows expected swap output, price impact, and fees. Does NOT execute anything.

Preconditions: Must be authenticated. Need an offerPublicKey from lavarage_get_rates.
Workflow: get_rates → get_quote → (user confirms) → open_position (same params).
The offerPublicKey, collateral, leverage, and slippageBps are reused in open_position.

Collateral = initial margin in quote token (SOL or USDC depending on the offer).
Collateral accepts two formats: "5 USDC" or "0.05 SOL" (auto-converted), or raw smallest units like "5000000".

Key outputs: inAmount, outAmount (base tokens you'd receive), priceImpactPct, slippageBps.`,
    {
      offerPublicKey: z.string().describe('Offer/pool public key — get this from lavarage_get_rates'),
      collateral: z.string().describe('Collateral amount. Two formats: with token name (e.g. "5 USDC", "0.05 SOL") or raw smallest units (e.g. "5000000"). If you include SOL/USDC/WSOL suffix, the amount is auto-converted. '),
      leverage: z.number().min(1.1).max(100).describe('Leverage multiplier (e.g. 3 for 3x)'),
      slippageBps: z.number().optional().default(50).describe('Slippage tolerance in bps (default: 50 = 0.5%)'),
    },
    async ({ offerPublicKey, collateral, leverage, slippageBps }) => {
      try {
        const client = getClient()
        const collateralLamports = toSmallestUnits(collateral)

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

/**
 * Pass through collateral amount. Must be in the quote token's smallest units:
 * - SOL: lamports (1 SOL = 1,000,000,000 lamports)
 * - USDC: micro-USDC (1 USDC = 1,000,000)
 *
 * The agent must convert human amounts to smallest units based on the quote token.
 */
/**
 * Parse collateral amount to smallest units. Accepts:
 *   "5000000"       → 5000000 (already smallest units, no token suffix)
 *   "3 USDC"        → 3000000 (human amount × 1e6)
 *   "3USDC"         → 3000000
 *   "0.05 SOL"      → 50000000 (human amount × 1e9)
 *   "0.05SOL"       → 50000000
 *   "0.05 WSOL"     → 50000000
 *
 * Rule: if a token suffix is present, convert from human units.
 *       if no suffix, pass through as-is (already smallest units).
 */
export function toSmallestUnits(amount: string): string {
  const trimmed = amount.trim()
  const match = trimmed.match(/^([0-9]*\.?[0-9]+)\s*(SOL|WSOL|USDC|usdc|sol|wsol)?$/i)
  if (!match) throw new Error(`Invalid collateral: "${amount}". Use "5 USDC", "0.05 SOL", or raw units like "5000000".`)

  const num = Number(match[1])
  if (isNaN(num) || num <= 0) throw new Error(`Invalid amount: ${amount}`)

  const token = (match[2] ?? '').toUpperCase()
  if (token === 'SOL' || token === 'WSOL') return Math.round(num * 1e9).toString()
  if (token === 'USDC') return Math.round(num * 1e6).toString()
  // No suffix = already in smallest units
  return Math.round(num).toString()
}

function formatError(err: any): string {
  if (err.code && err.message) {
    return `API Error [${err.code}]: ${err.message}${err.detail ? ` — ${err.detail}` : ''}`
  }
  return `Error: ${err.message ?? String(err)}`
}
