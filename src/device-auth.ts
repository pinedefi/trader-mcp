/**
 * Device authorization flow for MCP login.
 *
 * Flow:
 * 1. lavarage_login tool creates a device code (short-lived, 5 min)
 * 2. Tool returns a URL: https://mcp.lavarage.xyz/auth/XXXX
 * 3. Trader opens URL in browser, connects wallet via Privy
 * 4. Browser POSTs the Privy token to /auth/XXXX/complete
 * 5. Server verifies token, extracts wallet, stores on the device auth entry
 * 6. lavarage_login tool polls /auth/XXXX/status until complete
 * 7. Tool creates an MCP session with the authenticated wallet
 */

export interface DeviceAuth {
  code: string
  sessionId: string
  createdAt: number
  expiresAt: number
  privyUserId?: string
  walletAddress?: string
}

const CODE_TTL_MS = 5 * 60 * 1000 // 5 minutes

const deviceCodes = new Map<string, DeviceAuth>()

export function createDeviceCode(sessionId: string): DeviceAuth {
  // Generate a short, human-readable code (6 chars)
  const code = randomCode(6)
  const now = Date.now()

  const auth: DeviceAuth = {
    code,
    sessionId,
    createdAt: now,
    expiresAt: now + CODE_TTL_MS,
  }

  deviceCodes.set(code, auth)

  // Auto-cleanup after expiry
  setTimeout(() => deviceCodes.delete(code), CODE_TTL_MS)

  return auth
}

export function getDeviceAuth(code: string): DeviceAuth | undefined {
  const auth = deviceCodes.get(code)
  if (!auth) return undefined
  if (Date.now() > auth.expiresAt) {
    deviceCodes.delete(code)
    return undefined
  }
  return auth
}

export function completeDeviceAuth(code: string, privyUserId: string, walletAddress: string): void {
  const auth = deviceCodes.get(code)
  if (auth) {
    auth.privyUserId = privyUserId
    auth.walletAddress = walletAddress
  }
}

export function deleteDeviceCode(code: string): void {
  deviceCodes.delete(code)
}

function randomCode(length: number): string {
  // Uppercase + digits, no ambiguous chars (0/O, 1/I/L)
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}
