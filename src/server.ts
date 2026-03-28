import express from 'express'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { LavaApiClient } from './api-client.js'
import { createSession, createTransport, deleteSession, getSession, validateSessionSecret, type TradingMode } from './session.js'
import { createDeviceCode, getDeviceAuth, completeDeviceAuth, deleteDeviceCode, type DeviceAuth } from './device-auth.js'
import { registerSetupTool } from './tools/setup.js'
import { registerLoginTool } from './tools/login.js'
import { registerMarketTools } from './tools/market.js'
import { registerPositionTools } from './tools/positions.js'
import { registerTradeTools } from './tools/trade.js'

export interface ServerConfig {
  port: number
  host: string
  publicUrl: string
  apiUrl: string
  apiKey: string
  privyAppId: string
  privyAppSecret: string
  privySigningKey?: string
  maxPositionSol: number
}

export async function startServer(config: ServerConfig) {
  const app = express()
  app.use(express.json())

  // Track active SSE transports for message routing
  const sseTransports = new Map<string, SSEServerTransport>()

  // SSE endpoint — each connection is a new session
  app.get('/sse', (req, res) => {
    const sessionId = crypto.randomUUID()
    const sessionTransport = createTransport(sessionId)
    const transport = new SSEServerTransport('/messages', res)

    sseTransports.set(sessionId, transport)

    // Send the session secret as the first SSE event so the client
    // can include it in subsequent /messages POSTs
    res.write(`event: session\ndata: ${JSON.stringify({ sessionId, secret: sessionTransport.secret })}\n\n`)

    // Create MCP server instance per session
    const mcpServer = createMcpServer(sessionId, config)

    mcpServer.connect(transport).catch((err) => {
      console.error(`[${sessionId}] Connection error:`, err)
    })

    // Cleanup on disconnect
    res.on('close', () => {
      sseTransports.delete(sessionId)
      deleteSession(sessionId)
    })
  })

  // Message endpoint — validates session secret before forwarding
  app.post('/messages', (req, res) => {
    const sessionId = req.query.sessionId as string
    const secret = req.headers['x-session-secret'] as string

    if (!sessionId || !secret) {
      res.status(401).json({ error: 'Missing sessionId or x-session-secret' })
      return
    }

    if (!validateSessionSecret(sessionId, secret)) {
      res.status(403).json({ error: 'Invalid session secret' })
      return
    }

    const transport = sseTransports.get(sessionId)
    if (!transport) {
      res.status(404).json({ error: 'Session not found' })
      return
    }
    transport.handlePostMessage(req, res)
  })

  // --- Device Auth Flow ---

  // Step 1: lavarage_login tool calls this internally to create a device code
  // (handled in device-auth.ts, no HTTP endpoint needed)

  // Step 2: Trader opens this page in their browser to authenticate
  app.get('/auth/:code', (_req, res) => {
    const code = _req.params.code
    const auth = getDeviceAuth(code)

    if (!auth) {
      res.status(404).send(authPage('Link Expired', 'This login link has expired or is invalid. Go back to your AI agent and run lavarage_login again.', false))
      return
    }

    if (auth.walletAddress) {
      res.send(authPage('Already Connected', `Wallet ${auth.walletAddress} is already connected. You can close this tab.`, false))
      return
    }

    // Serve the Privy login page
    res.send(authPage('Connect Your Wallet', '', true, config.privyAppId, code, config.publicUrl))
  })

  // Step 3: After Privy login, the browser posts the wallet address back
  app.post('/auth/:code/complete', async (req, res) => {
    const code = req.params.code
    const { privyToken } = req.body

    if (!privyToken) {
      res.status(400).json({ error: 'privyToken is required' })
      return
    }

    const auth = getDeviceAuth(code)
    if (!auth) {
      res.status(404).json({ error: 'Code expired or invalid' })
      return
    }

    try {
      // Verify the Privy token and extract wallet
      const { PrivyClient } = await import('@privy-io/server-auth')
      const client = new PrivyClient(config.privyAppId, config.privyAppSecret)
      const claims = await client.verifyAuthToken(privyToken)
      const user = await client.getUser(claims.userId)

      const solanaWallet = user.linkedAccounts.find(
        (a: any) => a.type === 'wallet' && a.chainType === 'solana',
      )

      if (!solanaWallet || !('address' in solanaWallet)) {
        res.status(400).json({ error: 'No Solana wallet linked to this Privy account' })
        return
      }

      completeDeviceAuth(code, claims.userId, solanaWallet.address)
      res.json({ success: true, wallet: solanaWallet.address })
    } catch (err: any) {
      res.status(401).json({ error: `Auth failed: ${err.message}` })
    }
  })

  // Step 4: lavarage_login tool polls this to check if the user completed auth
  app.get('/auth/:code/status', (_req, res) => {
    const code = _req.params.code
    const auth = getDeviceAuth(code)

    if (!auth) {
      res.json({ status: 'expired' })
      return
    }

    if (auth.walletAddress) {
      res.json({ status: 'complete', wallet: auth.walletAddress, userId: auth.privyUserId })
    } else {
      res.json({ status: 'pending' })
    }
  })

  // Health check
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      sessions: sseTransports.size,
      version: '0.1.0',
    })
  })

  app.listen(config.port, config.host, () => {
    console.log(`Lavarage Trader MCP server running at ${config.publicUrl}`)
    console.log(`  SSE endpoint: /sse`)
    console.log(`  Auth page: /auth/:code`)
    console.log(`  Health: /health`)
  })
}

function authPage(title: string, message: string, showLogin: boolean, privyAppId?: string, code?: string, publicUrl?: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Lavarage - ${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, system-ui, sans-serif; background: #0a0a0a; color: #e5e5e5; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .container { text-align: center; max-width: 400px; padding: 2rem; }
    h1 { font-size: 1.5rem; margin-bottom: 1rem; }
    p { color: #999; margin-bottom: 1.5rem; line-height: 1.5; }
    .btn { background: #7c3aed; color: white; border: none; padding: 12px 24px; border-radius: 8px; font-size: 1rem; cursor: pointer; }
    .btn:hover { background: #6d28d9; }
    .success { color: #22c55e; }
    #status { margin-top: 1rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>${title}</h1>
    ${message ? `<p>${message}</p>` : ''}
    ${showLogin ? `
    <p>Connect your Solana wallet to start trading with your AI agent.</p>
    <div id="privy-login">
      <button class="btn" onclick="startLogin()">Connect Wallet</button>
    </div>
    <div id="status"></div>
    <script src="https://unpkg.com/@privy-io/js-sdk-core@latest/dist/umd/index.js"></script>
    <script>
      const CODE = '${code}';
      const PUBLIC_URL = '${publicUrl}';
      const PRIVY_APP_ID = '${privyAppId}';

      async function startLogin() {
        document.getElementById('status').innerHTML = '<p>Opening wallet connection...</p>';
        try {
          // Use Privy's headless SDK to authenticate
          const privy = new window.PrivyJs.PrivyClient({ appId: PRIVY_APP_ID });
          // Redirect to Privy's hosted login
          window.location.href = 'https://auth.privy.io/login?app_id=' + PRIVY_APP_ID + '&redirect_uri=' + encodeURIComponent(PUBLIC_URL + '/auth/' + CODE + '/callback');
        } catch (err) {
          document.getElementById('status').innerHTML = '<p style="color:#ef4444">Error: ' + err.message + '</p>';
        }
      }
    </script>
    ` : ''}
  </div>
</body>
</html>`
}


function createMcpServer(sessionId: string, config: ServerConfig): McpServer {
  // Factory functions that tools use to get session-scoped resources
  function getClient(): LavaApiClient {
    const session = getSession(sessionId)
    if (!session) throw new Error('Not authenticated. Call lavarage_login first.')
    return new LavaApiClient(config.apiUrl, config.apiKey, session.walletAddress)
  }

  function getWallet(): string {
    const session = getSession(sessionId)
    if (!session) throw new Error('Not authenticated. Call lavarage_login first.')
    return session.walletAddress
  }

  function getMode(): TradingMode | null {
    const session = getSession(sessionId)
    return session?.mode ?? null
  }

  const server = new McpServer({
    name: 'lavarage-trader',
    version: '0.1.0',
  })

  registerLoginTool(server, sessionId, config)
  registerSetupTool(server, sessionId)
  registerMarketTools(server, getClient)
  registerPositionTools(server, getClient)
  registerTradeTools(server, getClient, getWallet, getMode, config)

  return server
}
