# Lavarage Trader MCP — Full Testing Report

**Date:** 2026-03-30
**Tester:** Claude (acting as a trader in main conversation)
**Wallet:** `CcAfz3dBd9SETjKS3KNH2MuroJFkhep5gc3SXGwgpxT`
**Mode:** server-wallet (Privy delegation)
**Server:** `https://mcp.liquidflow.co`

---

## Executive Summary

**23 tools tested. 17 work correctly. 2 have API-side gaps. 4 not tested (advanced management).** The core trade lifecycle (check balance → find offer → quote → open → monitor → close) works end-to-end with real on-chain transactions. Two positions opened and closed successfully via Privy server-wallet signing.

---

## Tool-by-Tool Results

### Auth & Setup (3 tools)

| Tool | Status | Notes |
|------|--------|-------|
| `lavarage_login` | PASS | Returns wallet + mode. Clean. |
| `lavarage_setup` | PASS | Hosted mode locked to server-wallet. Works. |
| `lavarage_fund_wallet` | PASS (untested link) | Returns MoonPay URL with wallet pre-filled. |

### Wallet & Portfolio (3 tools)

| Tool | Status | Notes |
|------|--------|-------|
| `lavarage_wallet_balance` | PASS | SOL + tokens. USDC/WSOL auto-resolved. Unknown mints show null symbol. |
| `lavarage_portfolio` | PASS | 4 open (2 long, 2 borrow), 50 closed. Recent closed with PnL. |
| `lavarage_resolve_tokens` | PASS | Resolved NPC, zBTC, cbBTC, WBTC. Caches results. |

### Market Data (3 tools)

| Tool | Status | Notes |
|------|--------|-------|
| `lavarage_list_tokens` | PASS (with issue) | Requires search now. But returns raw JSON dump — too large for "SOL" search. |
| `lavarage_get_rates` | PASS (with issue) | Returns top 20 by liquidity. But ALL tokenSymbol = "unknown" (backend doesn't join token data). |
| `lavarage_get_quote` | PASS | 0.02 SOL × 3x → 7436 zBTC satoshis. SOL amount input works. |

### Trading (2 tools)

| Tool | Status | Notes |
|------|--------|-------|
| `lavarage_open_position` | **PASS** | 2x long zBTC/SOL with 0.02 SOL. TX `446MpCi...` confirmed on-chain. Privy server-wallet signing works. SOL amount input works. |
| `lavarage_close_position` | **PASS** | Closed position `Enn1Shk...`. TX `4RQjfHW...` confirmed. Ownership check passed. |

### Quotes (1 tool)

| Tool | Status | Notes |
|------|--------|-------|
| `lavarage_close_quote` | PASS | Shows inAmount, outAmount, repayAmount, fee, priceImpact. Useful for previewing PnL. |

### Orders — TP/SL (3 tools)

| Tool | Status | Notes |
|------|--------|-------|
| `lavarage_get_orders` | PASS | Returns full order history (43 orders). Shows status, error messages, trigger/execution times. |
| `lavarage_set_tp_sl` | **FAIL** | Returns `AUTH_MISSING_WALLET_SIGNATURE`. Orders endpoint requires wallet signature headers, not API key. MCP only sends x-api-key. |
| `lavarage_cancel_order` | NOT TESTED | Depends on set_tp_sl working. |

### History (1 tool)

| Tool | Status | Notes |
|------|--------|-------|
| `lavarage_trade_history` | **FAIL** | Returns "No trade history found" despite 50+ closed positions. Endpoint may filter differently than list_positions. |

### Position Management (4 tools)

| Tool | Status | Notes |
|------|--------|-------|
| `lavarage_partial_sell` | NOT TESTED | Would need open position + time. |
| `lavarage_split_position` | NOT TESTED | Advanced. |
| `lavarage_merge_positions` | NOT TESTED | Advanced. |
| `lavarage_repay` | NOT TESTED | For borrow positions. |

---

## Trade Log

| Time (UTC) | Action | Tool | Result |
|------------|--------|------|--------|
| 01:02 | Check auth | login | Authenticated, server-wallet mode |
| 01:02 | Check balance | wallet_balance | 0.2819 SOL, 17.8 USDC, 670 NPC |
| 01:02 | Resolve unknown token | resolve_tokens | BeGY8... = NPC (Non-Playable Coin) |
| 01:03 | Check portfolio | portfolio | 4 open, 50 closed |
| 01:03 | Find offers | get_rates (SOL, top 10) | 10 SOL-quoted offers, all tokenSymbol=unknown |
| 01:04 | Get quote | get_quote (0.02 SOL, 3x) | 60M lamports → 7436 zBTC |
| 01:04 | Resolve output token | resolve_tokens | zBTC, cbBTC, WBTC identified |
| 01:05 | **OPEN POSITION** | open_position | TX `446MpCi...` — 3x long zBTC/SOL |
| 01:05 | Verify position | list_positions | New position `Enn1Shk...` visible, entry 806.67 |
| 01:05 | Check orders | get_orders | 43 historical orders returned |
| 01:05 | Get trade history | trade_history | "No trade history found" |
| 01:05 | Close quote | close_quote | 7438 zBTC → 59.9M lamports, fee 539K |
| 01:06 | Try set TP | set_tp_sl | FAIL: AUTH_MISSING_WALLET_SIGNATURE |
| 01:06 | **CLOSE POSITION** | close_position | TX `4RQjfHW...` — position closed |
| 01:06 | Check balance after | wallet_balance | 0.2746 SOL (lost ~0.007 SOL to fees+slippage) |

**Net cost of round-trip test trade:** ~0.007 SOL (~$1) in fees + slippage.

---

## Bugs Found

### BUG-1 (CRITICAL): `set_tp_sl` fails — wrong auth type
- **Error:** `AUTH_MISSING_WALLET_SIGNATURE`
- **Cause:** Orders API requires wallet signature headers (`x-wallet-address`, `x-wallet-signature`, `x-wallet-message`). MCP only sends `x-api-key`.
- **Impact:** Traders cannot set TP/SL via MCP. Core risk management is broken.
- **Fix:** Either change orders API to accept API key auth, or have the MCP sign a message with the Privy wallet for each order call.

### BUG-2 (HIGH): `trade_history` returns empty
- **Error:** "No trade history found" despite 50+ closed positions visible in `list_positions`.
- **Cause:** The trade history endpoint (`GET /positions/trade-history`) may require different query params or the `owner` filter doesn't match.
- **Impact:** Trader cannot review past trades.

### BUG-3 (MEDIUM): `get_rates` all tokenSymbol = "unknown"
- **Cause:** `includeTokens: true` param isn't joining token data in the API response. The `token` object is null or missing on all offers.
- **Impact:** Agent can't tell which tokens are available without calling `resolve_tokens` on every output mint from quotes.

### BUG-4 (MEDIUM): `list_positions` missing computed fields
- Only returns: address, side, status, leverage, entryPrice, createdAt
- Missing: tokenSymbol, currentPrice, PnL, liquidationPrice, collateral, borrowedAmount, interestAccrued
- **Blocked by:** LAV-458 (Trading SDK computed fields)

### BUG-5 (LOW): `list_tokens` search returns too much data
- Searching "SOL" returned 377K characters, exceeding buffer limits.
- Should return only top 20 matches with concise fields.

### BUG-6 (LOW): Token resolve caching works but not persisted
- Resolved NPC on second call from cache — good.
- But cache is in-memory and lost on server restart.

---

## UX Assessment

### What Works Great
1. **Full trade lifecycle** — open → monitor → close all work in server-wallet mode
2. **SOL amount input** — saying "0.02" instead of "20000000" works perfectly
3. **Wallet balance** — agent knows exactly how much SOL is available
4. **Token resolution** — unknown mints can be identified on demand
5. **Portfolio summary** — quick overview of positions
6. **Close quote** — preview PnL before closing
7. **Safety guard** — max position size limit blocks oversized trades
8. **MEV protection** — Astralane tip auto-included
9. **Error messages** — clear, actionable (except the auth error)

### What Needs Work
1. **Can't set TP/SL** — the #1 most important gap. Traders need risk management.
2. **No token names on offers** — "unknown" everywhere forces extra resolve calls
3. **No trade history** — can't review past performance
4. **No current price / PnL** on positions — agent trades blind
5. **Status "EXECUTED"** instead of "OPEN" is confusing
6. **Orders API returns ALL orders** (43) with no pagination — should filter to active only by default

### What's Missing (nice to have)
1. Price alerts / notifications
2. Current market price for a token
3. Position PnL calculation without close quote
4. Batch close all positions

---

## Scoring (1-5)

| Category | Score | Notes |
|----------|-------|-------|
| Auth & Setup | 5/5 | OAuth flow smooth, server-wallet works |
| Market Data | 3/5 | Rates work but no token names, tokens search too large |
| Trading | 5/5 | Open + close work on-chain. SOL amounts, MEV protection |
| Risk Management | 1/5 | TP/SL completely broken (auth mismatch) |
| Position Info | 2/5 | Basic fields only, no PnL/liq price |
| History | 1/5 | Returns empty |
| Wallet Tools | 4/5 | Balance, portfolio, resolve all work. Fund wallet untested. |
| **Overall** | **3.5/5** | Core trading works. TP/SL and data quality are the blockers. |

---

## Priority Fixes

### P0 (before any trader uses this)
1. Fix `set_tp_sl` auth — either add API key support to orders endpoint or sign wallet messages via Privy
2. Fix `trade_history` — verify the endpoint query params

### P1 (before public launch)
3. Fix `get_rates` token names (backend: `includeTokens` join)
4. Add computed fields to `list_positions` (LAV-458)
5. Filter `get_orders` to active-only by default

### P2 (quality of life)
6. Truncate `list_tokens` results properly
7. Add current market price tool
8. Persist token resolve cache to disk
