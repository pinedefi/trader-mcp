import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getSession } from '../session.js'
import type { ServerConfig } from '../server.js'

export function registerLoginTool(
  server: McpServer,
  getSessionId: () => string,
  _config: ServerConfig,
) {
  server.tool(
    'lavarage_login',
    `Check your authentication status and wallet address.

Preconditions: None — this is the first tool you should call.
Returns: wallet address, trading mode (server-wallet or unsigned), auth status.
If not authenticated: reconnect to the MCP server — the OAuth flow will prompt login.

Call this at the start of any session to confirm who you're trading as.`,
    {},
    async () => {
      try {
        const session = getSession(getSessionId())
        if (session) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                status: 'authenticated',
                wallet: session.walletAddress,
                mode: session.mode,
                message: `Authenticated as ${session.walletAddress}. ${session.mode ? `Mode: ${session.mode}` : 'Run lavarage_setup to choose your trading mode.'}`,
              }, null, 2),
            }],
          }
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              status: 'not_authenticated',
              message: 'Not authenticated. Reconnect to the MCP server — the OAuth flow will prompt you to log in via your browser.',
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
