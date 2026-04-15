# @lavarage-ai/trader-mcp

Hosted MCP server for trading leveraged positions on [Lavarage](https://v2.lavarage.xyz) via AI agents (Claude, Cursor, GPT, custom agents).

## How It Works

The MCP server runs as a hosted service. Traders connect via SSE and authenticate with Privy. Two trading modes are available:

- **Unsigned TX mode** — Lavarage builds the transaction and returns it unsigned. Your agent or app signs and submits externally. Full key custody.
- **Server wallet mode** — Lavarage signs and submits via Privy wallet delegation. Fully hands-off AI trading.

Users choose their mode on first connection via the `lavarage_setup` tool.

## Tools

| Tool | Description |
|------|-------------|
| `lavarage_login` | Authenticate with Privy token |
| `lavarage_setup` | Choose trading mode (unsigned or server-wallet) |
| `lavarage_list_tokens` | List supported tokens with prices |
| `lavarage_get_rates` | Lending rates and available liquidity |
| `lavarage_get_quote` | Get a leverage trade quote |
| `lavarage_open_position` | Open a leveraged position |
| `lavarage_close_position` | Close a position |
| `lavarage_list_positions` | List your positions |
| `lavarage_get_position` | Get position details |

## Setup

```bash
git clone https://github.com/pinedefi/trader-mcp.git
cd trader-mcp
npm install
cp .env.example .env  # edit with your keys
npm run build
npm start
```

The server starts at `http://localhost:3100` with:
- `GET /sse` — MCP SSE endpoint (connect your AI agent here)
- `POST /messages` — MCP message handler
- `GET /health` — Health check

## Configuration

| Env Var | Required | Description |
|---------|----------|-------------|
| `LAVARAGE_API_URL` | Yes | Lavarage API base URL |
| `LAVARAGE_API_KEY` | Yes | MCP partner API key |
| `PRIVY_APP_ID` | Yes | Privy app ID for user auth |
| `PRIVY_APP_SECRET` | Yes | Privy app secret |
| `PRIVY_SIGNING_KEY` | For server-wallet mode | Privy delegation signing key (base64 DER PKCS8) |
| `LAVARAGE_MAX_POSITION_SOL` | No | Max position size safety limit (default: 10 SOL) |
| `PORT` | No | Server port (default: 3100) |

## Connecting Your AI Agent

Server URL (Streamable HTTP transport with OAuth):
```
https://mcp.lavarage.xyz/mcp
```

Example MCP config (adapt for your client):
```json
{
  "mcpServers": {
    "lavarage": {
      "url": "https://mcp.lavarage.xyz/mcp"
    }
  }
}
```

Works with any MCP-compatible client: Claude Code, Claude Desktop, OpenCode, Cursor, etc.

## Security

- **API key**: The MCP's partner API key can read any wallet's positions but cannot trade without the wallet's signature. Read-only exposure risk is acceptable.
- **Privy tokens**: Verified server-side. Never logged or stored beyond the session.
- **Server wallet mode**: Uses Privy's key quorum delegation. The MCP never holds private keys directly.
- **Safety guards**: Positions above the configurable limit trigger a warning before execution.

## License

MIT
