import express from 'express'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { LavaApiClient } from './api-client.js'
import { createSession, deleteSession, getSession, type TradingMode } from './session.js'
import {
  registerClient, getClient as getOAuthClient,
  createAuthCode, getAuthCode, completeAuthCode, consumeAuthCode,
  createAccessToken, validateAccessToken, verifyPKCE,
  getAuthServerMetadata, getProtectedResourceMetadata,
} from './oauth.js'
import { renderAuthPage, renderAuthorizeCallbackPage } from './auth-page.js'
import { renderLandingPage } from './landing-page.js'
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
  // Parse JSON for all routes EXCEPT /mcp — StreamableHTTPServerTransport handles its own parsing
  app.use((req, res, next) => {
    if (req.path === '/mcp') return next()
    express.json()(req, res, next)
  })
  app.use((req, res, next) => {
    if (req.path === '/mcp') return next()
    express.urlencoded({ extended: true })(req, res, next)
  })

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
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, Mcp-Session-Id')
        res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id')
      }
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end()
      return
    }
    next()
  })

  // Rate limiter
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

  // =============================================
  // OAuth 2.1 Endpoints
  // =============================================

  // Protected Resource Metadata (RFC 9728)
  app.get('/.well-known/oauth-protected-resource', (_req, res) => {
    res.json(getProtectedResourceMetadata(config.publicUrl))
  })

  // Authorization Server Metadata (RFC 8414)
  app.get('/.well-known/oauth-authorization-server', (_req, res) => {
    res.json(getAuthServerMetadata(config.publicUrl))
  })

  // Dynamic Client Registration (RFC 7591)
  app.post('/register', (req, res) => {
    const { client_name, redirect_uris } = req.body
    const client = registerClient(client_name, redirect_uris)
    res.status(201).json({
      client_id: client.clientId,
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
    })
  })

  // Authorization Endpoint — redirects to web app for Privy login
  app.get('/authorize', (req, res) => {
    console.log('GET /authorize params:', JSON.stringify(req.query))

    const {
      client_id, redirect_uri, response_type, state,
      code_challenge, code_challenge_method, scope,
    } = req.query as Record<string, string>

    // Validate required params
    if (response_type && response_type !== 'code') {
      res.status(400).json({ error: 'unsupported_response_type', received: response_type })
      return
    }
    if (!client_id || !redirect_uri || !code_challenge) {
      res.status(400).json({ error: 'invalid_request', error_description: 'Missing required parameters' })
      return
    }

    const client = getOAuthClient(client_id)
    if (!client) {
      res.status(400).json({ error: 'invalid_client' })
      return
    }

    // Create an auth code (pending — will be completed after Privy login)
    const authCode = createAuthCode({
      clientId: client_id,
      redirectUri: redirect_uri,
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method || 'S256',
    })

    // Redirect to web app's /mcp-auth page for Privy login + delegation
    const mcpAuthUrl = new URL(`${config.webAppUrl}/mcp-auth`)
    mcpAuthUrl.searchParams.set('code', authCode.code)
    mcpAuthUrl.searchParams.set('callback', config.publicUrl)
    mcpAuthUrl.searchParams.set('state', state || '')
    mcpAuthUrl.searchParams.set('redirect_uri', redirect_uri)

    res.redirect(302, mcpAuthUrl.toString())
  })

  // Authorization completion — called by the web app after Privy login
  app.post('/authorize/complete', async (req, res) => {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown'
    if (!rateLimit(ip, 30, 60_000)) {
      res.status(429).json({ error: 'Too many attempts' })
      return
    }

    const { code, privyToken, mode, walletId } = req.body

    if (!code || !privyToken) {
      res.status(400).json({ error: 'invalid_request', error_description: 'code and privyToken required' })
      return
    }

    const authCode = getAuthCode(code)
    if (!authCode) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'Code expired or invalid' })
      return
    }

    try {
      // Verify Privy token and extract wallet
      const privyClient = await getPrivyClient(config)
      const claims = await privyClient.verifyAuthToken(privyToken)
      const user = await privyClient.getUser(claims.userId)

      const solanaWallet = user.linkedAccounts.find(
        (a: any) => a.type === 'wallet' && a.chainType === 'solana',
      )

      if (!solanaWallet || !('address' in solanaWallet)) {
        res.status(400).json({ error: 'invalid_grant', error_description: 'No Solana wallet linked' })
        return
      }

      // Complete the auth code with wallet info
      completeAuthCode(code, solanaWallet.address, claims.userId, mode, walletId)

      // Build the redirect URL back to the MCP client
      const redirectUrl = new URL(authCode.redirectUri)
      redirectUrl.searchParams.set('code', code)
      if (req.body.state) redirectUrl.searchParams.set('state', req.body.state)

      // Return the redirect URL for the browser to follow
      res.json({
        success: true,
        wallet: solanaWallet.address,
        redirectUrl: redirectUrl.toString(),
      })
    } catch (err: any) {
      console.error('Auth error:', err)
      res.status(401).json({ error: 'invalid_grant', error_description: 'Authentication failed' })
    }
  })

  // Token Endpoint — exchanges auth code for access token
  app.post('/token', (req, res) => {
    const { grant_type, code, redirect_uri, client_id, code_verifier } = req.body

    if (grant_type !== 'authorization_code') {
      res.status(400).json({ error: 'unsupported_grant_type' })
      return
    }

    if (!code || !code_verifier || !client_id) {
      res.status(400).json({ error: 'invalid_request' })
      return
    }

    // Consume the auth code (one-time use)
    const authCode = consumeAuthCode(code)
    if (!authCode) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'Code expired or already used' })
      return
    }

    // Verify client
    if (authCode.clientId !== client_id) {
      res.status(400).json({ error: 'invalid_client' })
      return
    }

    // Verify redirect_uri matches
    if (redirect_uri && authCode.redirectUri !== redirect_uri) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' })
      return
    }

    // Verify PKCE
    if (!verifyPKCE(code_verifier, authCode.codeChallenge, authCode.codeChallengeMethod)) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' })
      return
    }

    // Auth code must have been completed (user logged in via Privy)
    if (!authCode.walletAddress || !authCode.privyUserId) {
      res.status(400).json({ error: 'authorization_pending', error_description: 'User has not completed authentication yet' })
      return
    }

    // Issue access token
    const token = createAccessToken(
      authCode.walletAddress,
      authCode.privyUserId,
      authCode.mode,
      authCode.walletId,
    )

    res.json({
      access_token: token,
      token_type: 'Bearer',
      expires_in: 86400, // 24h
      scope: 'trade read',
    })
  })

  // =============================================
  // MCP Endpoint (Streamable HTTP)
  // =============================================

  const mcpTransports = new Map<string, StreamableHTTPServerTransport>()

  // Helper: extract and validate Bearer token
  function authenticateRequest(req: express.Request): { walletAddress: string; privyUserId: string; mode?: string; walletId?: string } | null {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) return null
    const token = authHeader.slice(7)
    const tokenData = validateAccessToken(token)
    if (!tokenData) return null
    return tokenData
  }

  app.post('/mcp', async (req, res) => {
    try {
      const auth = authenticateRequest(req)
      const sessionId = req.headers['mcp-session-id'] as string | undefined

      console.log(`POST /mcp sessionId=${sessionId ?? 'NEW'} auth=${auth ? auth.walletAddress : 'none'}`)

      if (sessionId && mcpTransports.has(sessionId)) {
        const transport = mcpTransports.get(sessionId)!

        if (auth && !getSession(sessionId)) {
          createSession(sessionId, {
            privyUserId: auth.privyUserId,
            walletAddress: auth.walletAddress,
            mode: (auth.mode as TradingMode) ?? null,
            createdAt: new Date(),
          })
        }

        await transport.handleRequest(req, res)
        return
      }

      // New session
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
      })

      transport.onclose = () => {
        const sid = transport.sessionId
        if (sid) {
          mcpTransports.delete(sid)
          deleteSession(sid)
        }
      }

      const mcpServer = createMcpServer(transport, config)
      await mcpServer.connect(transport)
      await transport.handleRequest(req, res)

      if (transport.sessionId) {
        console.log(`MCP session created: ${transport.sessionId} wallet=${auth?.walletAddress ?? 'none'}`)
        mcpTransports.set(transport.sessionId, transport)

        if (auth) {
          createSession(transport.sessionId, {
            privyUserId: auth.privyUserId,
            walletAddress: auth.walletAddress,
            mode: (auth.mode as TradingMode) ?? null,
            createdAt: new Date(),
          })
        }
      }
    } catch (err: any) {
      console.error('POST /mcp error:', err)
      if (!res.headersSent) {
        res.status(500).json({ error: 'internal_error', message: err.message })
      }
    }
  })

  app.get('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string
    const transport = mcpTransports.get(sessionId)
    if (!transport) {
      res.status(404).json({ error: 'Session not found' })
      return
    }
    await transport.handleRequest(req, res)
  })

  app.delete('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string
    const transport = mcpTransports.get(sessionId)
    if (transport) {
      await transport.handleRequest(req, res)
      mcpTransports.delete(sessionId)
      deleteSession(sessionId)
    } else {
      res.status(404).json({ error: 'Session not found' })
    }
  })

  // =============================================
  // Landing + Health
  // =============================================

  app.get('/', (_req, res) => {
    res.send(renderLandingPage(config.publicUrl))
  })

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  // Startup
  if (!config.privySigningKey) {
    console.warn('WARNING: PRIVY_SIGNING_KEY not set — server-wallet mode will be unavailable')
  }

  const httpServer = app.listen(config.port, config.host, () => {
    console.log(`Lavarage Trader MCP server running at ${config.publicUrl}`)
    console.log(`  MCP: /mcp | OAuth: /authorize, /token | Health: /health`)
  })

  process.on('SIGTERM', () => { httpServer.close(() => process.exit(0)) })
  process.on('SIGINT', () => { httpServer.close(() => process.exit(0)) })
}

// =============================================
// MCP Server Factory
// =============================================

function createMcpServer(transport: StreamableHTTPServerTransport, config: ServerConfig): McpServer {
  function getSessionId(): string {
    const sid = transport.sessionId
    if (!sid) throw new Error('No session established')
    return sid
  }

  function getClient(): LavaApiClient {
    const session = getSession(getSessionId())
    if (!session) throw new Error('Not authenticated. Complete the OAuth login flow first.')
    return new LavaApiClient(config.apiUrl, config.apiKey, session.walletAddress)
  }

  function getWallet(): string {
    const session = getSession(getSessionId())
    if (!session) throw new Error('Not authenticated.')
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
