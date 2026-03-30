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

        const result = await client.createOrder({
          positionAddress,
          walletId: '', // Server-side signing uses the quorum, not walletId
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
  const timestamp = Date.now().toString()
  const message = `lavarage:${walletAddress}:${timestamp}`

  const result = await privyClient.walletApi.solana.signMessage({
    address: walletAddress,
    chainType: 'solana',
    message,
  })

  // Privy returns { signature: string } — the signature is base58 encoded
  return {
    'x-wallet-address': walletAddress,
    'x-wallet-signature': result.signature,
    'x-wallet-message': message,
  }
}

function formatError(err: any): string {
  if (err.code && err.message) {
    return `API Error [${err.code}]: ${err.message}${err.detail ? ` — ${err.detail}` : ''}`
  }
  return `Error: ${err.message ?? String(err)}`
}
