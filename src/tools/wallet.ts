import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import type { LavaApiClient } from '../api-client.js'

export function registerWalletTools(
  server: McpServer,
  getClient: () => LavaApiClient,
  rpcUrl: string,
) {
  const connection = new Connection(rpcUrl)

  server.tool(
    'lavarage_wallet_balance',
    'Check your wallet balance — SOL and top token holdings. Use this before trading to know how much you can spend.',
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
            return {
              mint: info.mint,
              amount,
              decimals: info.tokenAmount?.decimals,
            }
          })
          .filter(Boolean)
          .sort((a: any, b: any) => b.amount - a.amount)
          .slice(0, 10) // Top 10 by amount

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
    'lavarage_portfolio',
    'Get a summary of your trading portfolio — open positions count, sides, and recent activity.',
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
}
