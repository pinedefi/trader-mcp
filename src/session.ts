import { timingSafeEqual } from 'node:crypto'

/**
 * Per-user session state for the hosted MCP server.
 * Each SSE connection gets its own session.
 */

export type TradingMode = 'unsigned' | 'server-wallet'

export interface Session {
  privyUserId: string
  walletAddress: string
  mode: TradingMode | null
  createdAt: Date
}

export interface SessionTransport {
  /** Random secret sent to client via SSE, required on every /messages POST */
  secret: string
}

const sessions = new Map<string, Session>()
const transports = new Map<string, SessionTransport>()

// --- Session ---

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

// --- Transport ---

export function createTransport(sessionId: string): SessionTransport {
  const secret = generateSecret()
  const transport: SessionTransport = { secret }
  transports.set(sessionId, transport)
  return transport
}

export function getTransport(sessionId: string): SessionTransport | undefined {
  return transports.get(sessionId)
}

export function validateSessionSecret(sessionId: string, secret: string): boolean {
  const transport = transports.get(sessionId)
  if (!transport) return false
  try {
    return timingSafeEqual(Buffer.from(secret, 'utf-8'), Buffer.from(transport.secret, 'utf-8'))
  } catch {
    // timingSafeEqual throws if lengths differ — that means mismatch
    return false
  }
}

function generateSecret(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
