#!/usr/bin/env node

/**
 * Local mode — runs the MCP server via stdio transport.
 * User provides their own Solana keypair. No OAuth, no Privy.
 *
 * Usage:
 *   LAVARAGE_API_URL=https://api.lavarage.xyz \
 *   LAVARAGE_API_KEY=your-key \
 *   LAVARAGE_KEYPAIR_PATH=~/.config/solana/id.json \
 *   npx @lavarage-ai/trader-mcp --local
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Keypair } from '@solana/web3.js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { LavaApiClient } from './api-client.js'
import { createSession } from './session.js'
import { registerSetupTool } from './tools/setup.js'
import { registerMarketTools } from './tools/market.js'
import { registerPositionTools } from './tools/positions.js'
import { registerTradeTools } from './tools/trade.js'
import { registerOrderTools } from './tools/orders.js'
import { registerHistoryTools } from './tools/history.js'
import { registerManageTools } from './tools/manage.js'
import type { ServerConfig } from './server.js'

// Default public API key — same one the web app uses. Not a secret.
// Rate limiting is per-IP, positions are scoped by wallet.
const DEFAULT_API_KEY = '0590c5d8d17d1dc5aca3066db92d0ea0fde4ecb5a6b0fffff73bb36b224e'
const DEFAULT_API_URL = 'https://api.lavarage.xyz'

const API_URL = process.env.LAVARAGE_API_URL ?? DEFAULT_API_URL
const API_KEY = process.env.LAVARAGE_API_KEY ?? DEFAULT_API_KEY
const KEYPAIR_PATH = process.env.LAVARAGE_KEYPAIR_PATH

if (!KEYPAIR_PATH) {
  console.error('LAVARAGE_KEYPAIR_PATH is required. Set it to your Solana keypair JSON file path.')
  console.error('Example: LAVARAGE_KEYPAIR_PATH=~/.config/solana/id.json')
  process.exit(1)
}

// Load keypair
const resolvedPath = KEYPAIR_PATH.startsWith('~')
  ? resolve(homedir(), KEYPAIR_PATH.slice(2))
  : resolve(KEYPAIR_PATH)

const raw = readFileSync(resolvedPath, 'utf-8')
const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)))
const walletAddress = keypair.publicKey.toBase58()

console.error(`Lavarage MCP (local mode) — wallet: ${walletAddress}`)

const maxPositionSol = Number(process.env.LAVARAGE_MAX_POSITION_SOL ?? '10')
const sessionId = 'local'

// Create session immediately (no OAuth needed)
createSession(sessionId, {
  privyUserId: `local:${walletAddress}`,
  walletAddress,
  mode: 'unsigned', // Local mode defaults to unsigned (user signs with their keypair)
  createdAt: new Date(),
})

// Config stub for tools that need it
const config: ServerConfig = {
  port: 0,
  host: '',
  publicUrl: '',
  webAppUrl: '',
  solanaRpcUrl: process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com',
  apiUrl: API_URL,
  apiKey: API_KEY,
  privyAppId: '',
  privyAppSecret: '',
  maxPositionSol,
}

function getClient(): LavaApiClient {
  return new LavaApiClient(API_URL!, API_KEY!, walletAddress)
}

const server = new McpServer({
  name: 'lavarage-trader',
  version: '0.1.0',
})

// Login tool just reports status in local mode
server.tool(
  'lavarage_login',
  'Check authentication status.',
  {},
  async () => ({
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        status: 'authenticated',
        wallet: walletAddress,
        mode: 'unsigned',
        message: `Local mode — authenticated as ${walletAddress}. Transactions are returned unsigned for you to sign with your keypair.`,
      }, null, 2),
    }],
  }),
)

registerSetupTool(server, () => sessionId, false)
registerMarketTools(server, getClient)
registerPositionTools(server, getClient)
registerTradeTools(server, getClient, () => walletAddress, () => 'unsigned', config)
registerOrderTools(server, getClient, config)
registerHistoryTools(server, getClient)
registerManageTools(server, getClient, () => walletAddress, () => 'unsigned', config)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
