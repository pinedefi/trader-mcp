import express from 'express'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { LavaApiClient } from './api-client.js'
import { createSession, createTransport, deleteSession, getSession, validateSessionSecret, type TradingMode } from './session.js'
import { createDeviceCode, getDeviceAuth, completeDeviceAuth, deleteDeviceCode, buildChallengeMessage } from './device-auth.js'
import { renderAuthPage } from './auth-page.js'
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

// Lazy-loaded singleton PrivyClient (#8, #11)
let privyClientInstance: any = null
async function getPrivyClient(config: ServerConfig) {
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

  // Request logging (#20)
  app.use((req, _res, next) => {
    if (req.path !== '/health') {
      console.log(`${new Date().toISOString()} ${req.method} ${req.path}`)
    }
    next()
  })

  // CORS (#3) — only allow requests from our own auth page origin
  app.use((req, res, next) => {
    const origin = req.headers.origin
    if (origin) {
      // Allow requests from our public URL (auth page) and localhost (dev)
      const allowed = origin === config.publicUrl || origin.startsWith('http://localhost')
      if (allowed) {
        res.setHeader('Access-Control-Allow-Origin', origin)
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-secret')
      }
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end()
      return
    }
    next()
  })

  // Simple rate limiter (#10) — per-IP, in-memory
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

  // Track active SSE transports
  const sseTransports = new Map<string, SSEServerTransport>()

  // SSE endpoint
  app.get('/sse', (req, res) => {
    const sessionId = crypto.randomUUID()
    const sessionTransport = createTransport(sessionId)
    const transport = new SSEServerTransport('/messages', res)

    sseTransports.set(sessionId, transport)

    res.write(`event: session\ndata: ${JSON.stringify({ sessionId, secret: sessionTransport.secret })}\n\n`)

    const mcpServer = createMcpServer(sessionId, config)

    mcpServer.connect(transport).catch((err) => {
      console.error(`[${sessionId}] Connection error:`, err)
      // Cleanup on failed connect (#23)
      sseTransports.delete(sessionId)
      deleteSession(sessionId)
    })

    res.on('close', () => {
      sseTransports.delete(sessionId)
      deleteSession(sessionId)
    })
  })

  // Message endpoint — validates session secret
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

  // Auth page
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

    res.send(renderAuthPage({
      title: 'Connect Your Wallet',
      showLogin: true,
      privyAppId: config.privyAppId,
      code,
      nonce: auth.nonce,
      publicUrl: config.publicUrl,
    }))
  })

  // Auth completion — wallet signature or Privy token
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

        // Exact message format match (#5) with server-issued nonce (#4)
        const expectedMessage = buildChallengeMessage(walletAddress, code, auth.nonce)
        if (message !== expectedMessage) {
          res.status(400).json({ error: 'Invalid message format' })
          return
        }

        // Verify ed25519 signature
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

        completeDeviceAuth(code, `wallet:${walletAddress}`, walletAddress)
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

        completeDeviceAuth(code, claims.userId, solanaWallet.address)
        res.json({ success: true, wallet: solanaWallet.address })

      } else {
        res.status(400).json({ error: 'Invalid auth type' })
      }
    } catch (err: any) {
      // Sanitized error (#12)
      console.error(`Auth error for code ${code}:`, err)
      res.status(401).json({ error: 'Authentication failed' })
    }
  })

  // Auth status polling
  app.get('/auth/:code/status', (req, res) => {
    const code = req.params.code
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

  // Health check (#18 — minimal public info)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  // Startup validation (#22)
  if (!config.privySigningKey) {
    console.warn('WARNING: PRIVY_SIGNING_KEY not set — server-wallet mode will be unavailable')
  }

  // Graceful shutdown (#14)
  const httpServer = app.listen(config.port, config.host, () => {
    console.log(`Lavarage Trader MCP server running at ${config.publicUrl}`)
    console.log(`  SSE: /sse | Auth: /auth/:code | Health: /health`)
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

function createMcpServer(sessionId: string, config: ServerConfig): McpServer {
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
