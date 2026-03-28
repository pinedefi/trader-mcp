import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createSession, getSession } from '../session.js'
import { createDeviceCode, getDeviceAuth, deleteDeviceCode } from '../device-auth.js'
import type { ServerConfig } from '../server.js'

export function registerLoginTool(
  server: McpServer,
  sessionId: string,
  config: ServerConfig,
) {
  server.tool(
    'lavarage_login',
    `Authenticate with your Solana wallet to start trading on Lavarage.

This starts a device authorization flow:
1. You'll get a login URL
2. Open it in your browser and connect your wallet
3. Come back here — you'll be automatically logged in

Call this tool again after opening the URL to check if login is complete.`,
    {
      checkCode: z.string().optional().describe('If you already have a pending login code, pass it here to check the status instead of creating a new one'),
    },
    async ({ checkCode }) => {
      try {
        // Already logged in?
        const existing = getSession(sessionId)
        if (existing) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                status: 'authenticated',
                wallet: existing.walletAddress,
                mode: existing.mode,
                message: `Already logged in as ${existing.walletAddress}. ${existing.mode ? `Mode: ${existing.mode}` : 'Run lavarage_setup to choose your trading mode.'}`,
              }, null, 2),
            }],
          }
        }

        // Checking status of an existing code?
        if (checkCode) {
          const auth = getDeviceAuth(checkCode)
          if (!auth) {
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({
                  status: 'expired',
                  message: 'Login code expired. Call lavarage_login again to get a new one.',
                }, null, 2),
              }],
            }
          }

          if (auth.walletAddress && auth.privyUserId) {
            // Auth complete — create the session
            createSession(sessionId, {
              privyUserId: auth.privyUserId,
              walletAddress: auth.walletAddress,
              mode: null,
              createdAt: new Date(),
            })
            deleteDeviceCode(checkCode)

            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({
                  status: 'authenticated',
                  wallet: auth.walletAddress,
                  message: `Authenticated as ${auth.walletAddress}. Now run lavarage_setup to choose your trading mode ("unsigned" or "server-wallet").`,
                }, null, 2),
              }],
            }
          }

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                status: 'pending',
                code: checkCode,
                url: `${config.publicUrl}/auth/${checkCode}`,
                message: `Still waiting... Open this URL in your browser to connect your wallet: ${config.publicUrl}/auth/${checkCode}`,
              }, null, 2),
            }],
          }
        }

        // Create a new device code
        const auth = createDeviceCode(sessionId)
        const url = `${config.publicUrl}/auth/${auth.code}`

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              status: 'awaiting_login',
              code: auth.code,
              url,
              expiresIn: '5 minutes',
              message: `Open this URL in your browser to connect your wallet:\n\n${url}\n\nAfter connecting, call lavarage_login again with checkCode: "${auth.code}" to complete login.`,
            }, null, 2),
          }],
        }
      } catch (err: any) {
        return {
          content: [{
            type: 'text' as const,
            text: `Login failed: ${err.message}`,
          }],
          isError: true,
        }
      }
    },
  )
}
