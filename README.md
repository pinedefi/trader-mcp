# @lavarage-ai/trader-mcp

MCP server for trading leveraged positions on [Lavarage](https://v2.lavarage.xyz) via AI agents (Claude, Cursor, GPT, custom agents).

Two ways to use it:

| Mode | Who it's for | What you need |
|------|--------------|---------------|
| **Hosted** | Most users — zero setup | Just the URL below |
| **Local** | Self-custody — you sign with your own keypair | A Solana keypair JSON file |

---

## Hosted (recommended)

Point your MCP client at:

```
https://mcp.lavarage.xyz/mcp
```

Example config:

```json
{
  "mcpServers": {
    "lavarage": {
      "url": "https://mcp.lavarage.xyz/mcp"
    }
  }
}
```

Works with any MCP-compatible client (Claude Code, Claude Desktop, Cursor, OpenCode, etc.). The first trading call triggers an OAuth login — sign in with email/Google via Privy, approve wallet delegation, and you're done. Lavarage signs and submits transactions on your behalf.

No API keys, no Privy setup, no env vars.

---

## Local (self-custody)

Run the MCP on your own machine and sign every transaction with your own keypair.

```bash
npm install -g @lavarage-ai/trader-mcp
```

Add to your MCP client config:

```json
{
  "mcpServers": {
    "lavarage": {
      "command": "lavarage-trader-mcp-local",
      "env": {
        "LAVARAGE_KEYPAIR_PATH": "~/.config/solana/id.json"
      }
    }
  }
}
```

The default API key and API URL are built in. Only `LAVARAGE_KEYPAIR_PATH` is required — point it at your Solana keypair JSON. The MCP returns unsigned transactions and signs them locally with your keypair.

---

## Tools

| Tool | Description |
|------|-------------|
| `lavarage_login` | Check auth status |
| `lavarage_setup` | Choose trading mode (unsigned or server-wallet) |
| `lavarage_list_tokens` | Browse supported tokens |
| `lavarage_get_rates` | Lending rates and liquidity |
| `lavarage_get_quote` | Preview a leverage trade |
| `lavarage_open_position` | Open a leveraged position |
| `lavarage_close_position` | Close a position |
| `lavarage_close_quote` | Preview close PnL |
| `lavarage_list_positions` | View open positions |
| `lavarage_get_position` | Position details |
| `lavarage_trade_history` | Past trades and events |
| `lavarage_set_tp_sl` | Set take-profit or stop-loss |
| `lavarage_get_orders` | View active TP/SL orders |
| `lavarage_cancel_order` | Cancel an order |
| `lavarage_partial_sell` | Take partial profit |
| `lavarage_repay` | Repay a borrow position |
| `lavarage_partial_repay` | Partially repay a borrow |
| `lavarage_split_position` | Split into two positions |
| `lavarage_merge_positions` | Merge two positions |
| `lavarage_borrow` | Borrow tokens against collateral |

---

## Security

- **Hosted mode:** authentication via Privy OAuth. Wallet delegation uses Privy's key quorum — Lavarage never holds raw private keys.
- **Local mode:** your keypair stays on your machine. The MCP returns unsigned transactions; your local process signs and submits.
- **API key:** the built-in API key is public (read + trade quote access). Trading requires either a wallet signature (local) or Privy delegation (hosted).
- **Safety guards:** positions above the configurable limit trigger a warning before execution.

---

## Self-host (advanced)

You don't need this unless you're forking the protocol. The hosted server at `mcp.lavarage.xyz` is the canonical deployment — most integrations should point there.

```bash
git clone https://github.com/Lavarage-AI/trader-mcp.git
cd trader-mcp
npm install
cp .env.example .env  # edit with your own Privy app + API keys
npm run build
npm start
```

Required env vars (self-host only):

| Env Var | Description |
|---------|-------------|
| `LAVARAGE_API_URL` | Lavarage API base URL |
| `LAVARAGE_API_KEY` | Your own partner API key |
| `PRIVY_APP_ID` | Your Privy app ID |
| `PRIVY_APP_SECRET` | Your Privy app secret |
| `PRIVY_SIGNING_KEY` | Privy delegation signing key (base64 DER PKCS8) — required for server-wallet mode |
| `LAVARAGE_MAX_POSITION_SOL` | Max position size safety limit (default: 10 SOL) |
| `PORT` | Server port (default: 3100) |

Note: the OAuth flow redirects to a `/mcp-auth` page on `WEB_APP_URL` for Privy login. If you self-host, you'll need to fork the web frontend too.

---

## License

MIT
