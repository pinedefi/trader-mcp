/**
 * Landing page for the Lavarage Trader MCP server.
 * Explains both hosted and local modes with setup instructions.
 */

export function renderLandingPage(publicUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Lavarage MCP — AI Trading Agent</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: #0a0a0a; color: #e5e5e5;
      line-height: 1.6;
    }
    a { color: #F59E0B; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.85em; }
    .container { max-width: 680px; margin: 0 auto; padding: 3rem 1.5rem; }

    /* Hero */
    .hero { text-align: center; margin-bottom: 3rem; }
    .logo {
      font-size: 2.5rem; font-weight: 800; margin-bottom: 0.25rem;
      background: linear-gradient(135deg, #F56506, #FF8A3D);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    }
    .tagline { font-size: 1.1rem; color: #888; margin-bottom: 1.5rem; }
    .badge {
      display: inline-flex; align-items: center; gap: 0.5rem;
      padding: 0.4rem 1rem; border-radius: 999px;
      background: #1a1a2e; border: 1px solid #333;
      font-size: 0.8rem; color: #aaa;
    }
    .badge-dot { width: 8px; height: 8px; border-radius: 50%; background: #22C55E; }

    /* Sections */
    .section { margin-bottom: 2.5rem; }
    .section h2 {
      font-size: 1.25rem; font-weight: 700; color: #fff;
      margin-bottom: 0.75rem; padding-bottom: 0.5rem;
      border-bottom: 1px solid #1a1a1a;
    }
    .section p { color: #999; margin-bottom: 1rem; font-size: 0.95rem; }

    /* Cards */
    .mode-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem; }
    @media (max-width: 600px) { .mode-grid { grid-template-columns: 1fr; } }
    .mode-card {
      padding: 1.25rem; border-radius: 12px;
      background: #111; border: 1px solid #222;
    }
    .mode-card h3 { font-size: 1rem; color: #fff; margin-bottom: 0.5rem; }
    .mode-card p { font-size: 0.85rem; color: #777; margin-bottom: 0.75rem; }
    .mode-tag {
      display: inline-block; font-size: 0.7rem; padding: 0.2rem 0.5rem;
      border-radius: 4px; font-weight: 600;
    }
    .mode-tag.hosted { background: #F565061a; color: #F56506; border: 1px solid #F5650633; }
    .mode-tag.local { background: #3B82F61a; color: #60A5FA; border: 1px solid #3B82F633; }

    /* Code blocks */
    .code-block {
      background: #111; border: 1px solid #222; border-radius: 10px;
      padding: 1rem 1.25rem; margin-bottom: 1rem;
      overflow-x: auto; font-size: 0.85rem; color: #ccc;
    }
    .code-block .comment { color: #555; }
    .code-block .key { color: #F59E0B; }
    .code-block .str { color: #22C55E; }

    /* Tools table */
    .tools-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin-bottom: 1rem; }
    .tools-table th { text-align: left; color: #666; padding: 0.5rem 0.75rem; border-bottom: 1px solid #1a1a1a; font-weight: 600; }
    .tools-table td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #111; color: #aaa; }
    .tools-table td:first-child { color: #ddd; font-family: 'SF Mono', monospace; font-size: 0.8rem; }

    /* Footer */
    .footer { text-align: center; padding-top: 2rem; border-top: 1px solid #1a1a1a; color: #444; font-size: 0.8rem; }
  </style>
</head>
<body>
  <div class="container">
    <div class="hero">
      <div class="logo">Lavarage MCP</div>
      <p class="tagline">Trade leveraged positions on Solana via your AI agent</p>
      <div class="badge">
        <div class="badge-dot"></div>
        Server online at ${publicUrl}
      </div>
    </div>

    <!-- Modes -->
    <div class="section">
      <h2>Two Ways to Connect</h2>
      <div class="mode-grid">
        <div class="mode-card">
          <h3>Hosted Mode</h3>
          <p>Connect to our server. Log in with email, we handle signing via Privy wallet delegation. Zero setup.</p>
          <span class="mode-tag hosted">OAuth + Privy</span>
        </div>
        <div class="mode-card">
          <h3>Local Mode</h3>
          <p>Run on your machine with your own Solana keypair. Full custody. Transactions returned unsigned for you to sign.</p>
          <span class="mode-tag local">stdio + keypair</span>
        </div>
      </div>
    </div>

    <!-- Hosted Setup -->
    <div class="section">
      <h2>Hosted Mode Setup</h2>
      <p>Add this to your Claude Desktop or Claude Code config:</p>
      <div class="code-block">
        <span class="comment">// Claude Desktop: ~/Library/Application Support/Claude/claude_desktop_config.json</span><br>
        <span class="comment">// Claude Code: .mcp.json in your project root</span><br><br>
        {<br>
        &nbsp;&nbsp;<span class="key">"mcpServers"</span>: {<br>
        &nbsp;&nbsp;&nbsp;&nbsp;<span class="key">"lavarage"</span>: {<br>
        &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="key">"type"</span>: <span class="str">"http"</span>,<br>
        &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="key">"url"</span>: <span class="str">"${publicUrl}/mcp"</span><br>
        &nbsp;&nbsp;&nbsp;&nbsp;}<br>
        &nbsp;&nbsp;}<br>
        }
      </div>
      <p>Your AI agent will open a browser window for you to log in with email. After that, it can trade on your behalf.</p>
    </div>

    <!-- Local Setup -->
    <div class="section">
      <h2>Local Mode Setup</h2>
      <p>Install globally or use npx. Requires Node.js 20+ and a Solana keypair.</p>
      <div class="code-block">
        <span class="comment"># Install</span><br>
        npm install -g @lavarage/trader-mcp
      </div>
      <div class="code-block">
        <span class="comment">// Claude Desktop config</span><br><br>
        {<br>
        &nbsp;&nbsp;<span class="key">"mcpServers"</span>: {<br>
        &nbsp;&nbsp;&nbsp;&nbsp;<span class="key">"lavarage"</span>: {<br>
        &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="key">"command"</span>: <span class="str">"lavarage-trader-mcp-local"</span>,<br>
        &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="key">"env"</span>: {<br>
        &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="key">"LAVARAGE_API_URL"</span>: <span class="str">"https://api.lavarage.xyz"</span>,<br>
        &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="key">"LAVARAGE_API_KEY"</span>: <span class="str">"your-api-key"</span>,<br>
        &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="key">"LAVARAGE_KEYPAIR_PATH"</span>: <span class="str">"~/.config/solana/id.json"</span><br>
        &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;}<br>
        &nbsp;&nbsp;&nbsp;&nbsp;}<br>
        &nbsp;&nbsp;}<br>
        }
      </div>
      <p>Transactions are returned unsigned. Sign them with your keypair or submit via your own tooling.</p>
    </div>

    <!-- Tools -->
    <div class="section">
      <h2>20 Trading Tools</h2>
      <table class="tools-table">
        <thead>
          <tr><th>Tool</th><th>Description</th></tr>
        </thead>
        <tbody>
          <tr><td>lavarage_login</td><td>Check auth status</td></tr>
          <tr><td>lavarage_setup</td><td>Configure trading mode</td></tr>
          <tr><td>lavarage_list_tokens</td><td>Browse supported tokens</td></tr>
          <tr><td>lavarage_get_rates</td><td>Lending rates and liquidity</td></tr>
          <tr><td>lavarage_get_quote</td><td>Preview a leverage trade</td></tr>
          <tr><td>lavarage_open_position</td><td>Open a leveraged position</td></tr>
          <tr><td>lavarage_close_position</td><td>Close a position</td></tr>
          <tr><td>lavarage_close_quote</td><td>Preview close PnL</td></tr>
          <tr><td>lavarage_list_positions</td><td>View your open positions</td></tr>
          <tr><td>lavarage_get_position</td><td>Position details</td></tr>
          <tr><td>lavarage_trade_history</td><td>Past trades and events</td></tr>
          <tr><td>lavarage_set_tp_sl</td><td>Set take-profit or stop-loss</td></tr>
          <tr><td>lavarage_get_orders</td><td>View active TP/SL orders</td></tr>
          <tr><td>lavarage_cancel_order</td><td>Cancel an order</td></tr>
          <tr><td>lavarage_partial_sell</td><td>Take partial profit</td></tr>
          <tr><td>lavarage_repay</td><td>Repay a borrow position</td></tr>
          <tr><td>lavarage_partial_repay</td><td>Partially repay a borrow</td></tr>
          <tr><td>lavarage_split_position</td><td>Split into two positions</td></tr>
          <tr><td>lavarage_merge_positions</td><td>Merge two positions</td></tr>
        </tbody>
      </table>
    </div>

    <!-- Example -->
    <div class="section">
      <h2>Example Prompts</h2>
      <div class="code-block">
        <span class="str">"Show me my open positions"</span><br>
        <span class="str">"Open a 3x long on SOL with 1 SOL collateral"</span><br>
        <span class="str">"Set a stop loss at $140 on my SOL position"</span><br>
        <span class="str">"Close my largest position"</span><br>
        <span class="str">"What are the current lending rates for SOL?"</span><br>
        <span class="str">"Sell 50% of my BTC position"</span>
      </div>
    </div>

    <div class="footer">
      <p>Built by <a href="https://v2.lavarage.xyz">Lavarage</a> — Solana leveraged trading protocol</p>
      <p style="margin-top: 0.5rem;"><a href="https://github.com/pinedefi/trader-mcp">GitHub</a> · <a href="https://docs.lavarage.xyz">API Docs</a></p>
    </div>
  </div>
</body>
</html>`
}
