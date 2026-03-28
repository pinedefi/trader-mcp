/**
 * Per-user session state for the hosted MCP server.
 * Each SSE connection gets its own session.
 */

export type TradingMode = 'unsigned' | 'server-wallet'

export interface Session {
  /** Privy user ID (from verified auth token) */
  privyUserId: string
  /** Solana wallet address (from Privy linked accounts) */
  walletAddress: string
  /** Trading mode chosen by user during setup */
  mode: TradingMode | null
  /** When the session was created */
  createdAt: Date
}

/**
 * Session transport state — tracks the SSE connection and its auth secret.
 * The secret is sent to the client in the initial SSE handshake and must be
 * included in every POST to /messages. Prevents session hijacking even if
 * the sessionId is intercepted.
 */
export interface SessionTransport {
  /** Random secret sent to client via SSE, required on every /messages POST */
  secret: string
  /** Whether the user has authenticated via device auth */
  authenticated: boolean
}

const sessions = new Map<string, Session>()
const transports = new Map<string, SessionTransport>()

// --- Session (user identity, created after device auth) ---

export function getSession(sessionId: string): Session | undefined {
  return sessions.get(sessionId)
}

export function createSession(sessionId: string, session: Session): void {
  sessions.set(sessionId, session)
}

export function updateSessionMode(sessionId: string, mode: TradingMode): void {
  const session = sessions.get(sessionId)
  if (session) session.mode = mode
}

export function deleteSession(sessionId: string): void {
  sessions.delete(sessionId)
  transports.delete(sessionId)
}

// --- Transport (SSE connection state + secret) ---

export function createTransport(sessionId: string): SessionTransport {
  const secret = generateSecret()
  const transport: SessionTransport = { secret, authenticated: false }
  transports.set(sessionId, transport)
  return transport
}

export function getTransport(sessionId: string): SessionTransport | undefined {
  return transports.get(sessionId)
}

export function validateSessionSecret(sessionId: string, secret: string): boolean {
  const transport = transports.get(sessionId)
  if (!transport) return false
  // Constant-time comparison to prevent timing attacks
  if (secret.length !== transport.secret.length) return false
  let result = 0
  for (let i = 0; i < secret.length; i++) {
    result |= secret.charCodeAt(i) ^ transport.secret.charCodeAt(i)
  }
  return result === 0
}

function generateSecret(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
