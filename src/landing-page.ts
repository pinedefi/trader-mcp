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

    /* Install cards */
    .install-card {
      background: #111; border: 1px solid #222; border-radius: 12px;
      padding: 1.25rem; margin-bottom: 1rem;
    }
    .install-header { margin-bottom: 0.75rem; }
    .install-header h3 { font-size: 1rem; color: #fff; display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem; }
    .install-header p { font-size: 0.85rem; color: #666; }
    .install-prompt {
      background: #0a0a0a; border: 1px solid #1a1a1a; border-radius: 8px;
      padding: 0.75rem 1rem; cursor: pointer; position: relative;
      display: flex; align-items: flex-start; gap: 0.75rem;
      transition: border-color 0.15s;
    }
    .install-prompt:hover { border-color: #333; }
    .install-text { flex: 1; font-size: 0.8rem; color: #aaa; line-height: 1.5; }
    .copy-btn {
      flex-shrink: 0; font-size: 0.7rem; padding: 0.25rem 0.5rem;
      border-radius: 4px; background: #222; color: #888; border: 1px solid #333;
      cursor: pointer; transition: all 0.15s;
    }
    .copy-btn:hover { background: #333; color: #ccc; }
    .copy-btn.copied { background: #22C55E22; color: #22C55E; border-color: #22C55E44; }

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

    <!-- Quick Install -->
    <div class="section">
      <h2>Quick Install</h2>
      <p>Open your AI coding agent and paste one of these. The agent does the rest.</p>

      <div class="install-card">
        <div class="install-header">
          <h3>Hosted Mode <span class="mode-tag hosted">Recommended</span></h3>
          <p>We handle wallet creation and signing. Just log in with email.</p>
        </div>
        <div class="install-prompt" onclick="copyToClipboard(this)">
          <span class="install-text">Install Lavarage MCP: add a "lavarage" MCP server to the project MCP config with type "http" and url "${publicUrl}/mcp". That's it — the OAuth flow will handle authentication when I use any trading tool.</span>
          <span class="copy-btn" title="Click to copy">Copy</span>
        </div>
      </div>

      <div class="install-card">
        <div class="install-header">
          <h3>Local Mode <span class="mode-tag local">Self-custody</span></h3>
          <p>Run on your machine with your own Solana keypair. Full control.</p>
        </div>
        <div class="install-prompt" onclick="copyToClipboard(this)">
          <span class="install-text">Install Lavarage MCP: run \`npm install -g @lavarage/trader-mcp\` then add a "lavarage" MCP server to the project MCP config with command "lavarage-trader-mcp-local" and env var LAVARAGE_KEYPAIR_PATH set to my Solana keypair file path (ask me where mine is). The API key and URL are built in — no configuration needed.</span>
          <span class="copy-btn" title="Click to copy">Copy</span>
        </div>
      </div>
    </div>

    <!-- Manual Config -->
    <div class="section">
      <h2>Manual Config</h2>
      <p>If you prefer to edit the config files directly:</p>

      <h3 style="font-size: 0.9rem; color: #aaa; margin-bottom: 0.5rem;">Hosted — MCP config (e.g. .mcp.json)</h3>
      <div class="code-block">
        {<br>
        &nbsp;&nbsp;<span class="key">"mcpServers"</span>: {<br>
        &nbsp;&nbsp;&nbsp;&nbsp;<span class="key">"lavarage"</span>: {<br>
        &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="key">"type"</span>: <span class="str">"http"</span>,<br>
        &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="key">"url"</span>: <span class="str">"${publicUrl}/mcp"</span><br>
        &nbsp;&nbsp;&nbsp;&nbsp;}<br>
        &nbsp;&nbsp;}<br>
        }
      </div>

      <h3 style="font-size: 0.9rem; color: #aaa; margin-bottom: 0.5rem;">Local — MCP config</h3>
      <div class="code-block">
        {<br>
        &nbsp;&nbsp;<span class="key">"mcpServers"</span>: {<br>
        &nbsp;&nbsp;&nbsp;&nbsp;<span class="key">"lavarage"</span>: {<br>
        &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="key">"command"</span>: <span class="str">"lavarage-trader-mcp-local"</span>,<br>
        &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="key">"env"</span>: {<br>
        &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="key">"LAVARAGE_KEYPAIR_PATH"</span>: <span class="str">"~/.config/solana/id.json"</span><br>
        &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;}<br>
        &nbsp;&nbsp;&nbsp;&nbsp;}<br>
        &nbsp;&nbsp;}<br>
        }
      </div>
      <p style="font-size: 0.85rem;">API key and URL are built in. Just set your keypair path.</p>
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
  <script>
    function copyToClipboard(el) {
      const text = el.querySelector('.install-text').textContent.trim();
      navigator.clipboard.writeText(text).then(() => {
        const btn = el.querySelector('.copy-btn');
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
      });
    }
  </script>
</body>
</html>`
}
