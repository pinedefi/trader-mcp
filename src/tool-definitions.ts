/**
 * Shared tool definitions for Lavarage trading tools.
 *
 * Exported for use by:
 * - MCP server (this package)
 * - Solana Agent Kit plugin (@solana-agent-kit/plugin-lavarage)
 * - LangChain, Vercel AI SDK, or any other framework
 *
 * Each definition contains: name, description, and Zod input schema.
 * Handlers are NOT included — each framework wires its own execution context.
 */

import { z } from 'zod'

export interface ToolDefinition {
  name: string
  description: string
  schema: z.ZodType<any>
}

// ── Auth & Setup ──

export const login: ToolDefinition = {
  name: 'lavarage_login',
  description: `Check your authentication status and wallet address.

Preconditions: None — this is the first tool you should call.
Returns: wallet address, trading mode (server-wallet or unsigned), auth status.
If not authenticated: reconnect to the MCP server — the OAuth flow will prompt login.

Call this at the start of any session to confirm who you're trading as.`,
  schema: z.object({}),
}

export const setup: ToolDefinition = {
  name: 'lavarage_setup',
  description: `Check or set the trading mode for this session.

Mode "unsigned": Lavarage builds the transaction and returns it as base58. You sign and submit externally.
Mode "server-wallet": Lavarage signs and submits via Privy wallet delegation.

Preconditions: Must be authenticated (call lavarage_login first).
Per-session: Mode persists until you disconnect.`,
  schema: z.object({
    mode: z.enum(['unsigned', 'server-wallet']).optional().describe('Trading mode'),
  }),
}

// ── Market Data ──

export const listTokens: ToolDefinition = {
  name: 'lavarage_list_tokens',
  description: `Search for tokens available on Lavarage. You MUST provide a search term — this tool does not dump all tokens.

Returns tradeable tokens with their best offer, price, max leverage, and available liquidity. Use lavarage_get_rates for more detailed offer data.

Examples: "SOL", "BONK", "JUP", "BTC", "cbBTC"`,
  schema: z.object({
    search: z.string().min(1).max(200).describe('Search by token name or symbol (required)'),
  }),
}

export const getRates: ToolDefinition = {
  name: 'lavarage_get_rates',
  description: `Get available offers for leverage trading, sorted by liquidity. Each offer represents a lending pool you can trade against.

An offer defines: the token pair (e.g. SOL→cbBTC), max leverage, borrow APR, and available liquidity. Pass the offerPublicKey to lavarage_get_quote or lavarage_open_position.

To go LONG on a token: find an offer where that token is the output (tokenSymbol).
To go SHORT: find an offer where the token you want to short is the input.

Search examples: "BTC", "SOL", "BONK". The search matches token name and symbol.`,
  schema: z.object({
    search: z.string().optional().describe('Search by token name or symbol (e.g. "BTC", "BONK")'),
    tokenMint: z.string().optional().describe('Filter by base token mint address'),
    quoteCurrency: z.enum(['SOL', 'USDC', 'all']).optional().default('all').describe('Filter by quote currency (default: all)'),
    limit: z.number().optional().default(20).describe('Max results (default: 20, max: 50)'),
  }),
}

export const getQuote: ToolDefinition = {
  name: 'lavarage_get_quote',
  description: `Preview a trade BEFORE opening. Shows expected swap output, price impact, and fees. Does NOT execute anything.

Preconditions: Must be authenticated. Need an offerPublicKey from lavarage_get_rates.
Workflow: get_rates → get_quote → (user confirms) → open_position (same params).
The offerPublicKey, collateral, leverage, and slippageBps are reused in open_position.

Collateral = initial margin in quote token (SOL or USDC depending on the offer).
Collateral accepts two formats: "5 USDC" or "0.05 SOL" (auto-converted), or raw smallest units like "5000000".

Key outputs: inAmount, outAmount (base tokens you'd receive), priceImpactPct, slippageBps.`,
  schema: z.object({
    offerPublicKey: z.string().describe('Offer/pool public key — get this from lavarage_get_rates'),
    collateral: z.string().describe('Collateral amount. Two formats: with token name (e.g. "5 USDC", "0.05 SOL") or raw smallest units (e.g. "5000000"). If you include SOL/USDC/WSOL suffix, the amount is auto-converted. '),
    leverage: z.number().min(1.1).max(10).describe('Leverage multiplier (e.g. 3 for 3x)'),
    slippageBps: z.number().optional().default(50).describe('Slippage tolerance in bps (default: 50 = 0.5%)'),
  }),
}

export const closeQuote: ToolDefinition = {
  name: 'lavarage_close_quote',
  description: `Preview the result of closing a position BEFORE committing. Does NOT execute anything.

Preconditions: Must be authenticated. Position must be open and belong to your wallet.
Input: positionAddress (base58) — get from lavarage_list_positions.

Key outputs: outAmount (quote tokens you'd receive), repayAmount (borrow repaid), fee (protocol fee), priceImpactPct.
Use this before calling lavarage_close_position to know what you'll get.`,
  schema: z.object({
    positionAddress: z.string().describe('Position account address (base58) — get from lavarage_list_positions'),
    slippageBps: z.number().optional().default(50).describe('Slippage tolerance in bps (default: 50 = 0.5%)'),
  }),
}

// ── Trading ──

export const openPosition: ToolDefinition = {
  name: 'lavarage_open_position',
  description: `Open a new leveraged trading position on Lavarage. THIS EXECUTES A REAL TRADE.

Preconditions: Must be authenticated + mode set. Need offerPublicKey from lavarage_get_rates.
Recommended: Call lavarage_get_quote first with the same params to preview the trade.

Position types (determined by the offer):
- LONG: Price up = profit. Deposit quote token (SOL/USDC), borrow more, buy base token.
- SHORT: Price down = profit. Deposit base token, borrow, sell.
- BORROW: No directional bet. Borrow tokens against collateral.

Collateral = initial margin in quote token (SOL or USDC). 

Outputs:
- server-wallet mode: returns { signature } — the on-chain TX signature. Trade is done.
- unsigned mode: returns { transaction } — base58-encoded TX to sign externally.
- If position size exceeds safety limit: returns error (BLOCKED).

Warnings: Trades with MEV protection via Astralane. Fees deducted from collateral.`,
  schema: z.object({
    offerPublicKey: z.string().describe('The offer/pool public key (get from lavarage_get_rates)'),
    collateral: z.string().describe('Collateral amount. Two formats: with token name (e.g. "5 USDC", "0.05 SOL") or raw smallest units (e.g. "5000000"). '),
    leverage: z.number().min(1.1).max(10).describe('Leverage multiplier (e.g. 3 for 3x)'),
    slippageBps: z.number().optional().default(50).describe('Slippage tolerance in bps (default: 50 = 0.5%)'),
  }),
}

export const closePosition: ToolDefinition = {
  name: 'lavarage_close_position',
  description: `Close an existing leveraged position. THIS EXECUTES A REAL TRADE.

Preconditions: Must be authenticated + mode set. Position must belong to your wallet.
Recommended: Call lavarage_close_quote first to preview PnL, fees, and proceeds.

What happens:
- LONG: Sells base tokens back to quote, repays borrow, returns remaining collateral + profit (or minus loss).
- SHORT: Buys base tokens back, returns them, keeps the difference.
- BORROW: Use lavarage_repay instead (this tool won't work for borrows).

Input: positionAddress (base58) — get from lavarage_list_positions.

Outputs:
- server-wallet mode: returns { signature } — on-chain TX signature. Position is closed.
- unsigned mode: returns { transaction } — base58-encoded TX to sign externally.

Includes MEV protection via Astralane.`,
  schema: z.object({
    positionAddress: z.string().describe('Position account address (base58) — get from lavarage_list_positions'),
    slippageBps: z.number().optional().default(50).describe('Slippage tolerance in bps (default: 50 = 0.5%)'),
  }),
}

export const borrow: ToolDefinition = {
  name: 'lavarage_borrow',
  description: `Borrow tokens against collateral on Lavarage. No directional bet — just access to liquidity.

Use this when you want to borrow tokens without taking a leveraged position. For example:
- Borrow USDC against your SOL (keep SOL exposure, get liquid USDC)
- Borrow SOL against USDC
- Borrow any supported token

The leverage parameter controls your loan-to-value ratio:
- 2x = borrow equal to your collateral (50% LTV)
- 3x = borrow 2x your collateral (67% LTV)

Preconditions: Must be authenticated + mode set. Need offerPublicKey from lavarage_get_rates.
Repay anytime with lavarage_repay or lavarage_partial_repay.`,
  schema: z.object({
    offerPublicKey: z.string().describe('Offer/pool public key (look for BORROW offers in lavarage_get_rates)'),
    collateral: z.string().describe('Collateral amount. Two formats: with token name (e.g. "5 USDC", "0.05 SOL") or raw smallest units (e.g. "5000000"). If you include SOL/USDC/WSOL suffix, the amount is auto-converted. '),
    leverage: z.number().min(1.1).max(10).describe('Borrow ratio — 2x = borrow equal to collateral'),
    slippageBps: z.number().optional().default(50).describe('Slippage in bps'),
  }),
}

// ── Positions ──

export const listPositions: ToolDefinition = {
  name: 'lavarage_list_positions',
  description: `List your leveraged positions with full computed data — PnL, liquidation price, interest, token names.

Preconditions: Must be authenticated (call lavarage_login first).

Key outputs per position:
- baseTokenSymbol/quoteTokenSymbol (e.g. "WBTC / USDC")
- collateral (initial margin in quote token) + positionSize (base tokens held)
- currentPrice, unrealizedPnl, roiPercent, liquidationPrice
- borrowed amount, apr, dailyInterest
- For closed: exitPrice, realizedPnl, closeType (SOLD/TP/SL/LIQUIDATED)

Position sides: LONG (price up = profit), SHORT (price down = profit), BORROW (no directional bet).
Status: EXECUTED = open/active, CLOSED/CLOSED_EXECUTED = settled, LIQUIDATED = liquidated.`,
  schema: z.object({
    status: z.enum(['OPEN', 'CLOSED', 'ALL']).optional().default('OPEN').describe('Filter by position status (default: OPEN)'),
  }),
}

export const getPosition: ToolDefinition = {
  name: 'lavarage_get_position',
  description: `Get detailed information about a specific position.

Preconditions: Must be authenticated. Position must belong to your wallet.
Input: The on-chain position account address (base58 string, 32-44 chars). Get this from lavarage_list_positions.
Returns: Same fields as list_positions — PnL, liquidation price, token names, etc.`,
  schema: z.object({
    positionAddress: z.string().describe('Position account address (base58) — get this from lavarage_list_positions'),
  }),
}

// ── Orders (TP/SL) ──

export const setTpSl: ToolDefinition = {
  name: 'lavarage_set_tp_sl',
  description: `Set a take-profit or stop-loss order on a position. The order auto-executes when the trigger price is hit.

Preconditions: Must be authenticated. Position must be open and belong to your wallet.

TAKE_PROFIT: closes the position when price reaches your target (locks in profit).
  - For LONG: set trigger ABOVE entry price (e.g. entry $100, TP at $120)
  - For SHORT: set trigger BELOW entry price (e.g. entry $100, TP at $80)

STOP_LOSS: closes the position to limit losses.
  - For LONG: set trigger BELOW entry price (e.g. entry $100, SL at $90)
  - For SHORT: set trigger ABOVE entry price (e.g. entry $100, SL at $110)`,
  schema: z.object({
    positionAddress: z.string().describe('The position account address (base58)'),
    orderType: z.enum(['TAKE_PROFIT', 'STOP_LOSS']).describe('Order type'),
    triggerPrice: z.string().describe('Price at which to trigger (e.g. "150.50")'),
    side: z.enum(['LONG', 'SHORT']).describe('Position side'),
  }),
}

export const getOrders: ToolDefinition = {
  name: 'lavarage_get_orders',
  description: `List active take-profit and stop-loss orders. Optionally filter by position.

Preconditions: Must be authenticated.`,
  schema: z.object({
    positionAddress: z.string().optional().describe('Filter orders for a specific position'),
  }),
}

export const cancelOrder: ToolDefinition = {
  name: 'lavarage_cancel_order',
  description: `Cancel an active take-profit or stop-loss order.

Preconditions: Must be authenticated. Order must belong to your wallet.`,
  schema: z.object({
    orderId: z.string().describe('The order ID to cancel'),
  }),
}

// ── Position Management ──

export const partialSell: ToolDefinition = {
  name: 'lavarage_partial_sell',
  description: `Sell a portion of a position (take partial profit). Specify what percentage to sell.

This is a two-step operation: split the position, then close the split portion.

In "unsigned" mode: returns both unsigned transactions (split + close). Submit them sequentially — split first, then close.
In "server-wallet" mode: signs and submits as an atomic Jito bundle.

If the close step fails after the split succeeds, you will have two separate positions. This is safe — no funds are lost. Call lavarage_close_position on the split portion to complete the sale.`,
  schema: z.object({
    positionAddress: z.string().describe('The position account address (base58)'),
    sellPercent: z.number().min(1).max(99).describe('Percentage of position to sell (e.g. 50 = sell half)'),
    slippageBps: z.number().optional().default(50).describe('Slippage tolerance in bps'),
  }),
}

export const repay: ToolDefinition = {
  name: 'lavarage_repay',
  description: `Fully repay a borrow position (return borrowed tokens to the lender).

Preconditions: Must be authenticated + mode set. Position must be a BORROW position.`,
  schema: z.object({
    positionAddress: z.string().describe('The borrow position account address (base58)'),
  }),
}

export const partialRepay: ToolDefinition = {
  name: 'lavarage_partial_repay',
  description: `Partially repay a borrow position. Specify what percentage to repay.

Preconditions: Must be authenticated + mode set. Position must be a BORROW position.`,
  schema: z.object({
    positionAddress: z.string().describe('The borrow position account address (base58)'),
    repayPercent: z.number().min(1).max(100).describe('Percentage of borrow to repay (e.g. 50 = repay half)'),
  }),
}

export const splitPosition: ToolDefinition = {
  name: 'lavarage_split_position',
  description: `Split a position into two. The new position gets the specified percentage.

Preconditions: Must be authenticated + mode set.`,
  schema: z.object({
    positionAddress: z.string().describe('The position account address (base58)'),
    splitPercent: z.number().min(1).max(99).describe('Percentage for the new position (e.g. 50 = split in half)'),
  }),
}

export const mergePositions: ToolDefinition = {
  name: 'lavarage_merge_positions',
  description: `Merge two positions into one. Both must be the same token pair and side.

Preconditions: Must be authenticated + mode set.`,
  schema: z.object({
    firstPositionAddress: z.string().describe('First position address (base58)'),
    secondPositionAddress: z.string().describe('Second position address (base58) — merges into first'),
  }),
}

export const increaseBorrow: ToolDefinition = {
  name: 'lavarage_increase_borrow',
  description: `Increase leverage on an existing position. Two modes:

- "withdraw": Borrow more quote tokens (SOL/USDC) and receive them in your wallet. Increases LTV but gives you liquid funds.
- "compound": Borrow more quote tokens AND swap them into the base token, adding to your position size. Like increasing leverage.

Use lavarage_increase_borrow_quote first to see max borrowable and projected LTV.

Preconditions: Must be authenticated + mode set.`,
  schema: z.object({
    positionAddress: z.string().describe('The position account address (base58)'),
    additionalBorrowAmount: z.string().describe('Amount to borrow in quote token smallest units (lamports for SOL)'),
    mode: z.enum(['withdraw', 'compound']).describe('"withdraw" = receive tokens, "compound" = swap into more base token'),
    slippageBps: z.number().optional().default(50).describe('Slippage tolerance in bps (compound mode only)'),
  }),
}

export const increaseBorrowQuote: ToolDefinition = {
  name: 'lavarage_increase_borrow_quote',
  description: `Preview the impact of increasing borrow. Shows max borrowable, current/projected LTV, fee, and swap quote (compound mode). Does NOT execute anything.

Preconditions: Must be authenticated.`,
  schema: z.object({
    positionAddress: z.string().describe('The position account address (base58)'),
    mode: z.enum(['withdraw', 'compound']).describe('"withdraw" or "compound"'),
    additionalBorrowAmount: z.string().optional().describe('Amount to borrow (omit to see max borrowable)'),
    slippageBps: z.number().optional().default(50).describe('Slippage in bps (compound only)'),
  }),
}

export const addCollateral: ToolDefinition = {
  name: 'lavarage_add_collateral',
  description: `Add more of the traded token (base token) to an existing position. Reduces LTV and moves liquidation price further away.

IMPORTANT: This adds the BASE token (the token you're long on), NOT the quote token.
For example, on a WBTC/USDC position, you add WBTC (in satoshis). You must hold the base token in your wallet.

Preconditions: Must be authenticated + mode set. Must hold the base token.`,
  schema: z.object({
    positionAddress: z.string().describe('The position account address (base58)'),
    collateralAmount: z.string().describe('Amount of base token to add, in smallest units (e.g. satoshis for WBTC)'),
  }),
}

export const addCollateralQuote: ToolDefinition = {
  name: 'lavarage_add_collateral_quote',
  description: `Preview the impact of adding base token to a position. Shows current and projected LTV. Does NOT execute anything.

Preconditions: Must be authenticated.`,
  schema: z.object({
    positionAddress: z.string().describe('The position account address (base58)'),
    collateralAmount: z.string().describe('Amount of base token to add, in smallest units'),
  }),
}

// ── History ──

export const tradeHistory: ToolDefinition = {
  name: 'lavarage_trade_history',
  description: `Get your trade history — every open, close, liquidation, split, merge, and repay event.

Preconditions: Must be authenticated.

Each event includes: token symbols, entry/exit price, PnL, protocol fee, gas fee, Jito tip, swap amounts, TX signature, and timestamp.`,
  schema: z.object({
    positionAddress: z.string().optional().describe('Filter by specific position address'),
    eventType: z.string().optional().describe('Filter by event type (e.g. OPEN, CLOSE, LIQUIDATION)'),
    limit: z.number().optional().default(20).describe('Max records (default: 20)'),
    offset: z.number().optional().default(0).describe('Pagination offset'),
  }),
}

// ── Wallet ──

export const walletBalance: ToolDefinition = {
  name: 'lavarage_wallet_balance',
  description: `Check your wallet balance — SOL and top 10 token holdings.

Preconditions: Must be authenticated.
Returns: SOL balance, top 10 tokens with amounts and symbols.

Call this before trading to confirm you have enough quote token (SOL/USDC) for the collateral.`,
  schema: z.object({}),
}

export const portfolio: ToolDefinition = {
  name: 'lavarage_portfolio',
  description: `Get a summary of your trading portfolio — open position count by side, total closed, and 5 most recent closed positions with PnL.

Preconditions: Must be authenticated.`,
  schema: z.object({}),
}

export const resolveTokens: ToolDefinition = {
  name: 'lavarage_resolve_tokens',
  description: `Resolve token mint addresses to symbols and names. Pass one or more mint addresses and get back their symbols.

Useful after lavarage_wallet_balance or lavarage_list_positions returns unknown mints.`,
  schema: z.object({
    mints: z.array(z.string()).min(1).max(20).describe('Array of token mint addresses to resolve'),
  }),
}

export const fundWallet: ToolDefinition = {
  name: 'lavarage_fund_wallet',
  description: `Get a link to buy SOL for your wallet. Use when the trader has no SOL or needs more to open a position.

Returns a MoonPay link pre-filled with the trader's wallet address.`,
  schema: z.object({}),
}

// ── All definitions ──

export const allTools: ToolDefinition[] = [
  login, setup,
  listTokens, getRates, getQuote, closeQuote,
  openPosition, closePosition, borrow,
  listPositions, getPosition,
  setTpSl, getOrders, cancelOrder,
  partialSell, repay, partialRepay, splitPosition, mergePositions,
  increaseBorrow, increaseBorrowQuote, addCollateral, addCollateralQuote,
  tradeHistory,
  walletBalance, portfolio, resolveTokens, fundWallet,
]
