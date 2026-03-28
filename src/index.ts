#!/usr/bin/env node

import { startServer } from './server.js'

const PORT = Number(process.env.PORT ?? 3100)
const HOST = process.env.HOST ?? '0.0.0.0'

const API_URL = process.env.LAVARAGE_API_URL
const API_KEY = process.env.LAVARAGE_API_KEY
const PRIVY_APP_ID = process.env.PRIVY_APP_ID
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET
const PRIVY_SIGNING_KEY = process.env.PRIVY_SIGNING_KEY

if (!API_URL || !API_KEY) {
  console.error('LAVARAGE_API_URL and LAVARAGE_API_KEY are required.')
  process.exit(1)
}

if (!PRIVY_APP_ID || !PRIVY_APP_SECRET) {
  console.error('PRIVY_APP_ID and PRIVY_APP_SECRET are required for user authentication.')
  process.exit(1)
}

const PUBLIC_URL = process.env.PUBLIC_URL ?? `http://localhost:${PORT}`
const maxPositionSol = Number(process.env.LAVARAGE_MAX_POSITION_SOL ?? '10')

startServer({
  port: PORT,
  host: HOST,
  publicUrl: PUBLIC_URL,
  apiUrl: API_URL,
  apiKey: API_KEY,
  privyAppId: PRIVY_APP_ID,
  privyAppSecret: PRIVY_APP_SECRET,
  privySigningKey: PRIVY_SIGNING_KEY,
  maxPositionSol,
}).catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
