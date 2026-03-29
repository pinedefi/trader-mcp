import express from 'express'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { LavaApiClient } from './api-client.js'
import { createSession, createTransport, deleteSession, getSession, validateSessionSecret, type TradingMode } from './session.js'
import { createDeviceCode, getDeviceAuth, completeDeviceAuth, deleteDeviceCode, buildChallengeMessage } from './device-auth.js'
import { renderAuthPage } from './auth-page.js'
import { registerSetupTool } from './tools/setup.js'
import { registerLoginTool } from './tools/login.js'
import { registerMarketTools } from './tools/market.js'
import { registerPositionTools } from './tools/positions.js'
import { registerTradeTools } from './tools/trade.js'
import { registerOrderTools } from './tools/orders.js'
import { registerHistoryTools } from './tools/history.js'
import { registerManageTools } from './tools/manage.js'

export interface ServerConfig {
  port: number
  host: string
  publicUrl: string
  webAppUrl: string
  apiUrl: string
  apiKey: string
  privyAppId: string
  privyAppSecret: string
  privySigningKey?: string
  maxPositionSol: number
}

// Lazy-loaded singleton PrivyClient
let privyClientInstance: any = null
export async function getPrivyClient(config: ServerConfig) {
  if (!privyClientInstance) {
    const { PrivyClient } = await import('@privy-io/server-auth')
    const opts = config.privySigningKey
      ? { walletApi: { authorizationPrivateKey: config.privySigningKey } }
      : undefined
    privyClientInstance = new PrivyClient(config.privyAppId, config.privyAppSecret, opts)
  }
  return privyClientInstance
}

export async function startServer(config: ServerConfig) {
  const app = express()
  app.use(express.json())

  // Request logging
  app.use((req, _res, next) => {
    if (req.path !== '/health') {
      console.log(`${new Date().toISOString()} ${req.method} ${req.path}`)
    }
    next()
  })

  // CORS
  app.use((req, res, next) => {
    const origin = req.headers.origin
    if (origin) {
      const allowed = origin === config.publicUrl || origin === config.webAppUrl || origin.startsWith('http://localhost')
      if (allowed) {
        res.setHeader('Access-Control-Allow-Origin', origin)
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id, x-session-secret')
        res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id')
      }
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end()
      return
    }
    next()
  })

  // Simple rate limiter
  const rateLimits = new Map<string, { count: number; resetAt: number }>()
  function rateLimit(ip: string, limit: number, windowMs: number): boolean {
    const now = Date.now()
    const entry = rateLimits.get(ip)
    if (!entry || now > entry.resetAt) {
      rateLimits.set(ip, { count: 1, resetAt: now + windowMs })
      return true
    }
    entry.count++
    return entry.count <= limit
  }

  // --- OAuth endpoints ---
  // Claude Code probes these before connecting. The /mcp endpoint itself
  // never returns 401, so the client should skip auth. But we handle
  // these explicitly to avoid Express HTML error pages.

  app.get('/.well-known/oauth-protected-resource', (_req, res) => {
    res.status(404).json({ error: 'not_found', error_description: 'This server does not require authentication' })
  })

  app.get('/.well-known/oauth-authorization-server', (_req, res) => {
    res.status(404).json({ error: 'not_found' })
  })

  app.post('/register', (_req, res) => {
    res.status(404).json({ error: 'registration_not_supported', error_description: 'This server does not require authentication' })
  })

  // Track active transports by session ID
  const transports = new Map<string, StreamableHTTPServerTransport>()

  // --- Streamable HTTP MCP endpoint ---
  // Single /mcp endpoint handles both POST (messages) and GET (SSE stream)

  app.post('/mcp', async (req, res) => {
    // Check for existing session
    const sessionId = req.headers['mcp-session-id'] as string | undefined

    if (sessionId && transports.has(sessionId)) {
      // Existing session — forward the message
      const transport = transports.get(sessionId)!
      await transport.handleRequest(req, res)
      return
    }

    // New session — create transport + MCP server
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    })

    transport.onclose = () => {
      const sid = transport.sessionId
      if (sid) {
        transports.delete(sid)
        deleteSession(sid)
      }
    }

    const mcpServer = createMcpServer(transport, config)

    await mcpServer.connect(transport)

    // Store transport by its session ID
    await transport.handleRequest(req, res)

    if (transport.sessionId) {
      transports.set(transport.sessionId, transport)
    }
  })

  // GET /mcp — SSE stream for server-to-client notifications
  app.get('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string
    const transport = transports.get(sessionId)
    if (!transport) {
      res.status(404).json({ error: 'Session not found. Send a POST to /mcp first.' })
      return
    }
    await transport.handleRequest(req, res)
  })

  // DELETE /mcp — close session
  app.delete('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string
    const transport = transports.get(sessionId)
    if (transport) {
      await transport.handleRequest(req, res)
      transports.delete(sessionId)
      deleteSession(sessionId)
    } else {
      res.status(404).json({ error: 'Session not found' })
    }
  })

  // --- Device Auth Flow ---

  app.get('/auth/:code', (req, res) => {
    const code = req.params.code
    const auth = getDeviceAuth(code)

    if (!auth) {
      res.send(renderAuthPage({
        title: 'Link Expired',
        message: 'This login link has expired or is invalid. Go back to your AI agent and run lavarage_login again.',
        showLogin: false,
      }))
      return
    }

    if (auth.walletAddress) {
      res.send(renderAuthPage({
        title: 'Already Connected',
        message: `Wallet ${auth.walletAddress} is already connected. You can close this tab.`,
        showLogin: false,
      }))
      return
    }

    // Redirect to the web app's /mcp-auth page for Privy login + delegation
    const redirectUrl = `${config.webAppUrl}/mcp-auth?code=${code}&callback=${encodeURIComponent(config.publicUrl)}&nonce=${auth.nonce}`
    res.redirect(302, redirectUrl)
  })

  app.post('/auth/:code/complete', async (req, res) => {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown'
    if (!rateLimit(ip, 30, 60_000)) {
      res.status(429).json({ error: 'Too many attempts. Try again later.' })
      return
    }

    const code = req.params.code
    const auth = getDeviceAuth(code)

    if (!auth) {
      res.status(404).json({ error: 'Code expired or invalid' })
      return
    }

    if (auth.walletAddress) {
      res.json({ success: true, wallet: auth.walletAddress })
      return
    }

    const { type } = req.body

    try {
      if (type === 'wallet') {
        const { walletAddress, signature, message } = req.body

        if (!walletAddress || !signature || !message) {
          res.status(400).json({ error: 'walletAddress, signature, and message are required' })
          return
        }

        const expectedMessage = buildChallengeMessage(walletAddress, code, auth.nonce)
        if (message !== expectedMessage) {
          res.status(400).json({ error: 'Invalid message format' })
          return
        }

        const { PublicKey } = await import('@solana/web3.js')
        const nodeCrypto = await import('node:crypto')

        const pubkey = new PublicKey(walletAddress)
        const msgBytes = Buffer.from(message, 'utf-8')
        const sigBytes = Buffer.from(signature, 'base64')

        const keyObject = nodeCrypto.createPublicKey({
          key: Buffer.concat([
            Buffer.from('302a300506032b6570032100', 'hex'),
            Buffer.from(pubkey.toBytes()),
          ]),
          format: 'der',
          type: 'spki',
        })

        const valid = nodeCrypto.verify(null, msgBytes, keyObject, sigBytes)

        if (!valid) {
          res.status(401).json({ error: 'Invalid signature' })
          return
        }

        const { mode, walletId } = req.body
        completeDeviceAuth(code, `wallet:${walletAddress}`, walletAddress, mode, walletId)
        res.json({ success: true, wallet: walletAddress })

      } else if (type === 'privy') {
        const { privyToken } = req.body

        if (!privyToken) {
          res.status(400).json({ error: 'privyToken is required' })
          return
        }

        const client = await getPrivyClient(config)
        const claims = await client.verifyAuthToken(privyToken)
        const user = await client.getUser(claims.userId)

        const solanaWallet = user.linkedAccounts.find(
          (a: any) => a.type === 'wallet' && a.chainType === 'solana',
        )

        if (!solanaWallet || !('address' in solanaWallet)) {
          res.status(400).json({ error: 'No Solana wallet linked to this account' })
          return
        }

        const { mode, walletId } = req.body
        completeDeviceAuth(code, claims.userId, solanaWallet.address, mode, walletId)
        res.json({ success: true, wallet: solanaWallet.address })

      } else {
        res.status(400).json({ error: 'Invalid auth type' })
      }
    } catch (err: any) {
      console.error(`Auth error for code ${code}:`, err)
      res.status(401).json({ error: 'Authentication failed' })
    }
  })

  app.get('/auth/:code/status', (req, res) => {
    const code = req.params.code
    const auth = getDeviceAuth(code)

    if (!auth) {
      res.json({ status: 'expired' })
      return
    }

    if (auth.walletAddress) {
      res.json({ status: 'complete', wallet: auth.walletAddress, userId: auth.privyUserId, mode: auth.mode, walletId: auth.walletId })
    } else {
      res.json({ status: 'pending' })
    }
  })

  // Health
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  if (!config.privySigningKey) {
    console.warn('WARNING: PRIVY_SIGNING_KEY not set — server-wallet mode will be unavailable')
  }

  const httpServer = app.listen(config.port, config.host, () => {
    console.log(`Lavarage Trader MCP server running at ${config.publicUrl}`)
    console.log(`  MCP: POST /mcp | Auth: /auth/:code | Health: /health`)
  })

  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down...')
    httpServer.close(() => process.exit(0))
  })
  process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down...')
    httpServer.close(() => process.exit(0))
  })
}

function createMcpServer(transport: StreamableHTTPServerTransport, config: ServerConfig): McpServer {
  // We use the transport's sessionId for session scoping
  // The sessionId is available after the first request is handled
  function getSessionId(): string {
    const sid = transport.sessionId
    if (!sid) throw new Error('No session established')
    return sid
  }

  function getClient(): LavaApiClient {
    const session = getSession(getSessionId())
    if (!session) throw new Error('Not authenticated. Call lavarage_login first.')
    return new LavaApiClient(config.apiUrl, config.apiKey, session.walletAddress)
  }

  function getWallet(): string {
    const session = getSession(getSessionId())
    if (!session) throw new Error('Not authenticated. Call lavarage_login first.')
    return session.walletAddress
  }

  function getMode(): TradingMode | null {
    const session = getSession(getSessionId())
    return session?.mode ?? null
  }

  const server = new McpServer({
    name: 'lavarage-trader',
    version: '0.1.0',
  })

  // Tools use getSessionId() lazily — sessionId is set after first handleRequest
  registerLoginTool(server, () => getSessionId(), config)
  registerSetupTool(server, () => getSessionId())
  registerMarketTools(server, getClient)
  registerPositionTools(server, getClient)
  registerTradeTools(server, getClient, getWallet, getMode, config)
  registerOrderTools(server, getClient)
  registerHistoryTools(server, getClient)
  registerManageTools(server, getClient, getWallet, getMode, config)

  return server
}
