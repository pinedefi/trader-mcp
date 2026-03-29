import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getSession, updateSessionMode, type TradingMode } from '../session.js'

export function registerSetupTool(
  server: McpServer,
  getSessionId: () => string,
) {
  server.tool(
    'lavarage_setup',
    `Choose your trading mode. Call this after lavarage_login.

Mode "unsigned": Lavarage builds the transaction and returns it unsigned (base64). Your agent or app signs and submits it externally. You keep full custody of your keys.

Mode "server-wallet": Lavarage signs and submits transactions on your behalf using Privy wallet delegation. Fully hands-off trading via AI agent. Requires Privy wallet with delegation enabled.`,
    {
      mode: z.enum(['unsigned', 'server-wallet']).describe(
        'Trading mode: "unsigned" = returns unsigned TXs for you to sign, "server-wallet" = Lavarage signs via Privy delegation',
      ),
    },
    async ({ mode }) => {
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

        updateSessionMode(getSessionId(), mode as TradingMode)

        const modeDesc = mode === 'unsigned'
          ? 'Transactions will be returned unsigned (base64). Your agent signs and submits them.'
          : 'Transactions will be signed and submitted automatically via Privy wallet delegation.'

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              status: 'configured',
              wallet: session.walletAddress,
              mode,
              message: `Trading mode set to "${mode}". ${modeDesc} You're ready to trade!`,
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
