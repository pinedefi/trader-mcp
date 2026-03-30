import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import type { LavaApiClient } from '../api-client.js'

// Well-known mints for instant resolution
const KNOWN_MINTS: Record<string, string> = {
  'So11111111111111111111111111111111111111112': 'WSOL',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': 'mSOL',
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn': 'jitoSOL',
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': 'BONK',
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN': 'JUP',
}

export function registerWalletTools(
  server: McpServer,
  getClient: () => LavaApiClient,
  rpcUrl: string,
) {
  const connection = new Connection(rpcUrl)

  server.tool(
    'lavarage_wallet_balance',
    `Check your wallet balance — SOL and top 10 token holdings.

Preconditions: Must be authenticated.
Returns: SOL balance (in SOL and lamports), top 10 tokens with amounts and symbols (known tokens auto-resolved, unknown show mint address — use lavarage_resolve_tokens to look them up).

Call this before trading to confirm you have enough quote token (SOL/USDC) for the collateral.`,
    {},
    async () => {
      try {
        const wallet = getClient().getWalletAddress()
        const pubkey = new PublicKey(wallet)

        // SOL balance
        const solLamports = await connection.getBalance(pubkey)
        const solBalance = solLamports / LAMPORTS_PER_SOL

        // SPL token accounts
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(pubkey, {
          programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
        })

        const tokens = tokenAccounts.value
          .map((ta) => {
            const info = ta.account.data.parsed?.info
            if (!info) return null
            const amount = Number(info.tokenAmount?.uiAmount ?? 0)
            if (amount === 0) return null
            const mint = info.mint as string
            return {
              mint,
              symbol: KNOWN_MINTS[mint] ?? null,
              amount,
              decimals: info.tokenAmount?.decimals,
            }
          })
          .filter(Boolean)
          .sort((a: any, b: any) => b.amount - a.amount)
          .slice(0, 10)

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              wallet,
              sol: {
                balance: solBalance,
                lamports: solLamports,
              },
              tokens,
              message: `SOL balance: ${solBalance.toFixed(4)} SOL. ${tokens.length} token(s) held.`,
            }, null, 2),
          }],
        }
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err.message}` }],
          isError: true,
        }
      }
    },
  )

  server.tool(
    'lavarage_fund_wallet',
    `Get a link to buy SOL for your wallet. Use this when the trader has no SOL or needs more to open a position.

Returns a MoonPay link pre-filled with the trader's wallet address. The trader opens this in their browser to buy SOL with a credit card or bank transfer.`,
    {},
    async () => {
      try {
        const wallet = getClient().getWalletAddress()
        const moonpayUrl = `https://buy.moonpay.com/?apiKey=pk_live_123&currencyCode=sol&walletAddress=${wallet}&colorCode=%23F56506`

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              wallet,
              fundingUrl: moonpayUrl,
              message: `Your wallet ${wallet} needs SOL to trade. Open this link to buy SOL:\n\n${moonpayUrl}`,
            }, null, 2),
          }],
        }
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err.message}` }],
          isError: true,
        }
      }
    },
  )

  server.tool(
    'lavarage_portfolio',
    `Get a summary of your trading portfolio — open position count by side, total closed, and 5 most recent closed positions with PnL.

Preconditions: Must be authenticated.
Returns: { openPositions, breakdown: { longs, shorts, borrows }, totalClosed, recentClosed[] }

Use this for a quick overview before diving into lavarage_list_positions for details.`,
    {},
    async () => {
      try {
        const client = getClient()
        const [openPositions, closedPositions] = await Promise.all([
          client.getPositions('OPEN'),
          client.getPositions('CLOSED'),
        ])

        const open = Array.isArray(openPositions) ? openPositions : []
        const closed = Array.isArray(closedPositions) ? closedPositions : []

        const longs = open.filter((p: any) => p.side === 'LONG').length
        const shorts = open.filter((p: any) => p.side === 'SHORT').length
        const borrows = open.filter((p: any) => p.side === 'BORROW').length

        // Recent closed (last 5)
        const recentClosed = closed.slice(0, 5).map((p: any) => ({
          address: p.address,
          side: p.side,
          leverage: p.leverage,
          entryPrice: p.entryPrice,
          exitPrice: p.exitPrice,
          realizedPnl: p.realizedPnl,
        }))

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              openPositions: open.length,
              breakdown: { longs, shorts, borrows },
              totalClosed: closed.length,
              recentClosed,
              message: `${open.length} open position(s): ${longs} long, ${shorts} short, ${borrows} borrow. ${closed.length} total closed.`,
            }, null, 2),
          }],
        }
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err.message}` }],
          isError: true,
        }
      }
    },
  )

  server.tool(
    'lavarage_resolve_tokens',
    `Resolve token mint addresses to symbols and names. Pass one or more mint addresses and get back their symbols.

Useful after lavarage_wallet_balance or lavarage_list_positions returns unknown mints. Checks Lavarage's token database first, falls back to well-known mints.`,
    {
      mints: z.array(z.string()).min(1).max(20).describe('Array of token mint addresses to resolve'),
    },
    async ({ mints }) => {
      try {
        const client = getClient()
        const resolved: Record<string, { symbol: string | null; name: string | null }> = {}

        // Resolve from known mints first
        const unknown: string[] = []
        for (const mint of mints) {
          if (KNOWN_MINTS[mint]) {
            resolved[mint] = { symbol: KNOWN_MINTS[mint], name: KNOWN_MINTS[mint] }
          } else {
            unknown.push(mint)
          }
        }

        // Look up remaining from Lavarage token database
        if (unknown.length > 0) {
          try {
            const allTokens = await client.getTokens()
            const tokenMap = new Map<string, any>()
            if (Array.isArray(allTokens)) {
              for (const t of allTokens) {
                const addr = t.address ?? t.mint
                if (addr) tokenMap.set(addr, t)
              }
            }
            for (const mint of unknown) {
              const t = tokenMap.get(mint)
              if (t) {
                resolved[mint] = { symbol: t.symbol ?? null, name: t.name ?? null }
                // Cache for future lookups
                if (t.symbol) KNOWN_MINTS[mint] = t.symbol
              } else {
                resolved[mint] = { symbol: null, name: null }
              }
            }
          } catch {
            // If token lookup fails, mark all as unresolved
            for (const mint of unknown) {
              resolved[mint] = { symbol: null, name: null }
            }
          }
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(resolved, null, 2),
          }],
        }
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err.message}` }],
          isError: true,
        }
      }
    },
  )
}
