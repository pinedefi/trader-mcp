import express from 'express'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { LavaApiClient } from './api-client.js'
import { createSession, createTransport, deleteSession, getSession, validateSessionSecret, type TradingMode } from './session.js'
import { createDeviceCode, getDeviceAuth, completeDeviceAuth, deleteDeviceCode } from './device-auth.js'
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

  // Step 2: Trader opens this page in their browser to authenticate
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
      publicUrl: config.publicUrl,
    }))
  })

  // Step 3: Browser posts wallet credentials after auth
  // Supports two auth types:
  //   { type: "wallet", walletAddress, signature, message }  — direct wallet connect
  //   { type: "privy", privyToken }                          — Privy OAuth
  app.post('/auth/:code/complete', async (req, res) => {
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
        // Direct wallet signature verification
        const { walletAddress, signature, message } = req.body

        if (!walletAddress || !signature || !message) {
          res.status(400).json({ error: 'walletAddress, signature, and message are required' })
          return
        }

        // Verify the message contains the correct code
        if (!message.includes(`Code: ${code}`)) {
          res.status(400).json({ error: 'Message does not match this auth code' })
          return
        }

        // Verify ed25519 signature using Node's native crypto
        const { PublicKey } = await import('@solana/web3.js')
        const crypto = await import('node:crypto')

        const pubkey = new PublicKey(walletAddress)
        const msgBytes = Buffer.from(message, 'utf-8')
        const sigBytes = Buffer.from(signature, 'base64')

        // Create an ed25519 public key object from raw bytes
        const keyObject = crypto.createPublicKey({
          key: Buffer.concat([
            // ed25519 DER prefix (ASN.1 header for 32-byte ed25519 public key)
            Buffer.from('302a300506032b6570032100', 'hex'),
            Buffer.from(pubkey.toBytes()),
          ]),
          format: 'der',
          type: 'spki',
        })

        const valid = crypto.verify(null, msgBytes, keyObject, sigBytes)

        if (!valid) {
          res.status(401).json({ error: 'Invalid wallet signature' })
          return
        }

        completeDeviceAuth(code, `wallet:${walletAddress}`, walletAddress)
        res.json({ success: true, wallet: walletAddress })

      } else if (type === 'privy') {
        // Privy token verification
        const { privyToken } = req.body

        if (!privyToken) {
          res.status(400).json({ error: 'privyToken is required' })
          return
        }

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

      } else {
        res.status(400).json({ error: 'Invalid auth type. Use "wallet" or "privy".' })
      }
    } catch (err: any) {
      res.status(401).json({ error: `Auth failed: ${err.message}` })
    }
  })

  // Step 4: lavarage_login tool polls this to check if auth completed
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
