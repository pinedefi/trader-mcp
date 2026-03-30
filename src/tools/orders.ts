import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { LavaApiClient } from '../api-client.js'
import { getPrivyClient, type ServerConfig } from '../server.js'

export function registerOrderTools(
  server: McpServer,
  getClient: () => LavaApiClient,
  config: ServerConfig,
) {
  server.tool(
    'lavarage_set_tp_sl',
    `Set a take-profit or stop-loss order on a position. The order auto-executes when the trigger price is hit.

TAKE_PROFIT: closes the position when price reaches your target (locks in profit).
  - For LONG: set trigger ABOVE entry price (e.g. entry $100, TP at $120)
  - For SHORT: set trigger BELOW entry price (e.g. entry $100, TP at $80)

STOP_LOSS: closes the position to limit losses.
  - For LONG: set trigger BELOW entry price (e.g. entry $100, SL at $90)
  - For SHORT: set trigger ABOVE entry price (e.g. entry $100, SL at $110)`,
    {
      positionAddress: z.string().describe('The position account address (base58)'),
      orderType: z.enum(['TAKE_PROFIT', 'STOP_LOSS']).describe('Order type'),
      triggerPrice: z.string().describe('Price at which to trigger (e.g. "150.50")'),
      side: z.enum(['LONG', 'SHORT']).describe('Position side'),
    },
    async ({ positionAddress, orderType, triggerPrice, side }) => {
      try {
        const client = getClient()
        const wallet = client.getWalletAddress()

        // Sign a wallet message for the orders API (requires WalletSignatureGuard)
        const sigHeaders = await signWalletMessage(wallet, config)

        // Get Privy walletId for server-side TP/SL auto-execution
        const privyClient = await getPrivyClient(config)
        const user = await privyClient.getUserByWalletAddress(wallet)
        const embeddedWallet = user?.linkedAccounts?.find(
          (a: any) => a.type === 'wallet' && a.walletClientType === 'privy' && a.chainType === 'solana',
        )
        const walletId = embeddedWallet?.id ?? ''

        const result = await client.createOrder({
          positionAddress,
          walletId,
          userPublicKey: wallet,
          orderType,
          triggerPrice,
          side,
        }, sigHeaders)

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              ...result,
              message: `${orderType === 'TAKE_PROFIT' ? 'Take-profit' : 'Stop-loss'} set at $${triggerPrice} for position ${positionAddress.slice(0, 8)}...`,
            }, null, 2),
          }],
        }
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: formatError(err) }],
          isError: true,
        }
      }
    },
  )

  server.tool(
    'lavarage_get_orders',
    'List active take-profit and stop-loss orders. Optionally filter by position.',
    {
      positionAddress: z.string().optional().describe('Filter orders for a specific position'),
    },
    async ({ positionAddress }) => {
      try {
        const orders = await getClient().getOrders(positionAddress)

        if (!Array.isArray(orders) || orders.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: 'No active orders found.',
            }],
          }
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(orders, null, 2),
          }],
        }
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: formatError(err) }],
          isError: true,
        }
      }
    },
  )

  server.tool(
    'lavarage_cancel_order',
    'Cancel an active take-profit or stop-loss order.',
    {
      orderId: z.string().describe('The order ID to cancel'),
    },
    async ({ orderId }) => {
      try {
        const client = getClient()
        const wallet = client.getWalletAddress()
        const sigHeaders = await signWalletMessage(wallet, config)

        await client.cancelOrder(orderId, sigHeaders)
        return {
          content: [{
            type: 'text' as const,
            text: `Order ${orderId} cancelled.`,
          }],
        }
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: formatError(err) }],
          isError: true,
        }
      }
    },
  )
}

/**
 * Sign a wallet message via Privy for the WalletSignatureGuard.
 * Message format: "lavarage:<walletAddress>:<timestamp>"
 */
async function signWalletMessage(
  walletAddress: string,
  config: ServerConfig,
): Promise<Record<string, string>> {
  const privyClient = await getPrivyClient(config)
  const bs58 = await import('bs58')
  const timestamp = Date.now().toString()
  const message = `lavarage:${walletAddress}:${timestamp}`

  const result = await privyClient.walletApi.solana.signMessage({
    address: walletAddress,
    chainType: 'solana',
    message,
  })

  // Privy returns { signature: Uint8Array (64 bytes) } — encode to base58 for the header
  const sigBytes = result.signature instanceof Uint8Array
    ? result.signature
    : new Uint8Array(Object.values(result.signature))
  const sigBase58 = bs58.default.encode(sigBytes)

  return {
    'x-wallet-address': walletAddress,
    'x-wallet-signature': sigBase58,
    'x-wallet-message': message,
  }
}

function formatError(err: any): string {
  if (err.code && err.message) {
    return `API Error [${err.code}]: ${err.message}${err.detail ? ` — ${err.detail}` : ''}`
  }
  return `Error: ${err.message ?? String(err)}`
}
