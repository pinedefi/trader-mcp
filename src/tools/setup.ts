import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getSession, updateSessionMode, type TradingMode } from '../session.js'

export function registerSetupTool(
  server: McpServer,
  getSessionId: () => string,
  isHosted: boolean = true,
) {
  server.tool(
    'lavarage_setup',
    isHosted
      ? `Check or confirm the trading mode for this session. On the hosted server, mode is always "server-wallet" — all transactions are signed and submitted automatically via Privy wallet delegation.

Preconditions: Must be authenticated (call lavarage_login first).
Per-session: Mode is set once per SSE connection. Reconnecting starts a new session.
Returns: wallet address, active mode.`
      : `Choose the trading mode for this session. Call once after connecting.

Mode "unsigned": Lavarage builds the transaction and returns it as base58. You sign and submit it externally. Full key custody.
Mode "server-wallet": Lavarage signs and submits via Privy wallet delegation. Hands-off trading.

Preconditions: Must be authenticated (call lavarage_login first).
Per-session: Mode persists until you disconnect. Call again to change mid-session.
Returns: wallet address, active mode.`,
    isHosted
      ? {}
      : {
          mode: z.enum(['unsigned', 'server-wallet']).describe(
            'Trading mode: "unsigned" = returns unsigned TXs for you to sign, "server-wallet" = Lavarage signs via Privy delegation',
          ),
        },
    async (args: any) => {
      try {
        const session = getSession(getSessionId())
        if (!session) {
          return {
            content: [{
              type: 'text' as const,
              text: 'Not authenticated. Call lavarage_login first.',
            }],
            isError: true,
          }
        }

        // Hosted mode: always server-wallet
        const mode = isHosted ? 'server-wallet' : (args.mode ?? 'unsigned')
        updateSessionMode(getSessionId(), mode as TradingMode)

        const modeDesc = mode === 'unsigned'
          ? 'Transactions will be returned unsigned (base58). Your agent signs and submits them.'
          : 'Transactions will be signed and submitted automatically via Privy wallet delegation.'

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              status: 'configured',
              wallet: session.walletAddress,
              mode,
              message: `Trading mode: "${mode}". ${modeDesc}`,
            }, null, 2),
          }],
        }
      } catch (err: any) {
        return {
          content: [{
            type: 'text' as const,
            text: `Setup failed: ${err.message}`,
          }],
          isError: true,
        }
      }
    },
  )
}
