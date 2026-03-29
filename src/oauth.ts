import { randomUUID, createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

/**
 * OAuth 2.1 + PKCE implementation for MCP server.
 *
 * Flow:
 * 1. Claude Code calls POST /register (Dynamic Client Registration)
 * 2. Claude Code opens GET /authorize in browser (with PKCE code_challenge)
 * 3. User logs in via Privy on the authorize page
 * 4. Server redirects back with authorization code
 * 5. Claude Code exchanges code for access token at POST /token
 * 6. Claude Code includes Bearer token on all POST /mcp requests
 */

// --- Types ---

interface OAuthClient {
  clientId: string
  clientName?: string
  redirectUris: string[]
  createdAt: number
}

interface AuthCode {
  code: string
  clientId: string
  redirectUri: string
  codeChallenge: string
  codeChallengeMethod: string
  walletAddress?: string
  privyUserId?: string
  mode?: 'unsigned' | 'server-wallet'
  walletId?: string
  expiresAt: number
}

interface AccessToken {
  walletAddress: string
  privyUserId: string
  mode?: 'unsigned' | 'server-wallet'
  walletId?: string
  expiresAt: number
}

// --- Storage (in-memory, short-lived) ---

const clients = new Map<string, OAuthClient>()
const authCodes = new Map<string, AuthCode>()
const accessTokens = new Map<string, AccessToken>()

const AUTH_CODE_TTL = 5 * 60 * 1000 // 5 min
const ACCESS_TOKEN_TTL = 24 * 60 * 60 * 1000 // 24h
const TOKEN_PERSIST_PATH = process.env.TOKEN_PERSIST_PATH ?? '/tmp/lavarage-mcp-tokens.json'

// Restore tokens from disk on startup
try {
  const saved = JSON.parse(readFileSync(TOKEN_PERSIST_PATH, 'utf-8'))
  const now = Date.now()
  for (const [k, v] of Object.entries(saved)) {
    const token = v as AccessToken
    if (token.expiresAt > now) accessTokens.set(k, token)
  }
  console.log(`Restored ${accessTokens.size} access tokens from disk`)
} catch { /* no file or invalid — start fresh */ }

function persistTokens() {
  try {
    const obj: Record<string, AccessToken> = {}
    for (const [k, v] of accessTokens) obj[k] = v
    writeFileSync(TOKEN_PERSIST_PATH, JSON.stringify(obj))
  } catch { /* best-effort */ }
}

// --- Client Registration ---

export function registerClient(clientName?: string, redirectUris?: string[]): OAuthClient {
  const clientId = randomUUID()
  const client: OAuthClient = {
    clientId,
    clientName,
    redirectUris: redirectUris ?? [],
    createdAt: Date.now(),
  }
  clients.set(clientId, client)
  return client
}

export function getClient(clientId: string): OAuthClient | undefined {
  return clients.get(clientId)
}

// --- Authorization Codes ---

export function createAuthCode(opts: {
  clientId: string
  redirectUri: string
  codeChallenge: string
  codeChallengeMethod: string
}): AuthCode {
  const code = randomUUID()
  const authCode: AuthCode = {
    code,
    ...opts,
    expiresAt: Date.now() + AUTH_CODE_TTL,
  }
  authCodes.set(code, authCode)
  setTimeout(() => authCodes.delete(code), AUTH_CODE_TTL)
  return authCode
}

export function getAuthCode(code: string): AuthCode | undefined {
  const ac = authCodes.get(code)
  if (!ac) return undefined
  if (Date.now() > ac.expiresAt) {
    authCodes.delete(code)
    return undefined
  }
  return ac
}

export function completeAuthCode(code: string, walletAddress: string, privyUserId: string, mode?: string, walletId?: string): void {
  const ac = authCodes.get(code)
  if (ac) {
    ac.walletAddress = walletAddress
    ac.privyUserId = privyUserId
    ac.mode = mode as any
    ac.walletId = walletId
  }
}

export function consumeAuthCode(code: string): AuthCode | undefined {
  const ac = authCodes.get(code)
  if (!ac) return undefined
  authCodes.delete(code)
  if (Date.now() > ac.expiresAt) return undefined
  return ac
}

// --- Access Tokens ---

export function createAccessToken(walletAddress: string, privyUserId: string, mode?: string, walletId?: string): string {
  const token = randomUUID()
  accessTokens.set(token, {
    walletAddress,
    privyUserId,
    mode: mode as any,
    walletId,
    expiresAt: Date.now() + ACCESS_TOKEN_TTL,
  })
  setTimeout(() => { accessTokens.delete(token); persistTokens() }, ACCESS_TOKEN_TTL)
  persistTokens()
  return token
}

export function validateAccessToken(token: string): AccessToken | undefined {
  const at = accessTokens.get(token)
  if (!at) return undefined
  if (Date.now() > at.expiresAt) {
    accessTokens.delete(token)
    return undefined
  }
  return at
}

// --- PKCE ---

export function verifyPKCE(codeVerifier: string, codeChallenge: string, method: string): boolean {
  if (method === 'S256') {
    const hash = createHash('sha256').update(codeVerifier).digest('base64url')
    return hash === codeChallenge
  }
  // plain method (not recommended but spec allows it)
  return codeVerifier === codeChallenge
}

// --- OAuth Server Metadata ---

export function getAuthServerMetadata(publicUrl: string) {
  return {
    issuer: publicUrl,
    authorization_endpoint: `${publicUrl}/authorize`,
    token_endpoint: `${publicUrl}/token`,
    registration_endpoint: `${publicUrl}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['trade', 'read'],
  }
}

export function getProtectedResourceMetadata(publicUrl: string) {
  return {
    resource: publicUrl,
    authorization_servers: [publicUrl],
    scopes_supported: ['trade', 'read'],
    bearer_methods_supported: ['header'],
  }
}
