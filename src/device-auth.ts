/**
 * Device authorization flow for MCP login.
 *
 * Flow:
 * 1. lavarage_login tool creates a device code (short-lived, 5 min)
 * 2. Tool returns a URL: https://mcp.lavarage.xyz/auth/XXXX
 * 3. Trader opens URL in browser, connects wallet via Privy or wallet extension
 * 4. Browser POSTs wallet credentials to /auth/XXXX/complete
 * 5. Server verifies signature, stores wallet on the device auth entry
 * 6. lavarage_login tool polls /auth/XXXX/status until complete
 * 7. Tool creates an MCP session with the authenticated wallet
 */

export interface DeviceAuth {
  code: string
  sessionId: string
  /** Server-generated nonce — must be included in the signed message */
  nonce: string
  createdAt: number
  expiresAt: number
  privyUserId?: string
  walletAddress?: string
}

const CODE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const MAX_CODES = 10_000 // prevent memory exhaustion

const deviceCodes = new Map<string, DeviceAuth>()

export function createDeviceCode(sessionId: string): DeviceAuth {
  if (deviceCodes.size >= MAX_CODES) {
    // Evict expired entries before rejecting
    const now = Date.now()
    for (const [key, val] of deviceCodes) {
      if (now > val.expiresAt) deviceCodes.delete(key)
    }
    if (deviceCodes.size >= MAX_CODES) {
      throw new Error('Too many pending auth codes. Try again later.')
    }
  }

  // Generate code with collision check (#1)
  let code: string
  let attempts = 0
  do {
    code = randomCode(8) // 8 chars = 30^8 ≈ 656 billion combinations
    attempts++
    if (attempts > 10) throw new Error('Failed to generate unique code')
  } while (deviceCodes.has(code))

  // Server-generated nonce for message binding (#4)
  const nonce = crypto.randomUUID()
  const now = Date.now()

  const auth: DeviceAuth = {
    code,
    sessionId,
    nonce,
    createdAt: now,
    expiresAt: now + CODE_TTL_MS,
  }

  deviceCodes.set(code, auth)
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

/** Build the exact message that the wallet must sign */
export function buildChallengeMessage(walletAddress: string, code: string, nonce: string): string {
  return `Sign this message to authenticate with Lavarage MCP.\n\nWallet: ${walletAddress}\nCode: ${code}\nNonce: ${nonce}`
}

function randomCode(length: number): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}
