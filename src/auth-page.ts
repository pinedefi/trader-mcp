/**
 * Renders HTML pages for the OAuth authorization flow.
 *
 * Two pages:
 * 1. renderAuthPage — error/status pages (expired, already connected)
 * 2. renderAuthorizePage — the main login page shown during OAuth /authorize
 *    Redirects to the web app's /mcp-auth for Privy login + delegation,
 *    then the web app POSTs back to /authorize/complete
 */

export function renderAuthPage(opts: {
  title: string
  message?: string
  showLogin: boolean
}): string {
  return renderShell(opts.title, opts.message ? `<p class="msg">${opts.message}</p>` : '')
}

/**
 * Renders the authorize callback page — shown briefly while the auth code
 * is redirected back to the MCP client.
 */
export function renderAuthorizeCallbackPage(redirectUrl: string): string {
  return renderShell('Authorized!', `
    <div class="success-box">
      <div class="check-icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#22C55E" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
      </div>
      <p class="success">Wallet Connected</p>
      <p class="msg">Redirecting back to your AI agent...</p>
    </div>
    <script>
      // Auto-redirect after a brief pause
      setTimeout(() => { window.location.href = ${JSON.stringify(redirectUrl)}; }, 1500);
    </script>
  `)
}

function renderShell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Lavarage - ${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: #0a0a0a; color: #e5e5e5;
      display: flex; align-items: center; justify-content: center; min-height: 100vh;
    }
    .container {
      text-align: center; max-width: 420px; padding: 2.5rem;
      background: #141414; border-radius: 16px; border: 1px solid #222;
    }
    .logo {
      font-size: 1.75rem; font-weight: 700; margin-bottom: 0.5rem;
      background: linear-gradient(135deg, #F56506, #FF8A3D);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    }
    h1 { font-size: 1.25rem; margin-bottom: 0.75rem; color: #fff; }
    .msg { color: #888; margin-bottom: 1.5rem; line-height: 1.6; font-size: 0.9rem; }
    .success { color: #22C55E; font-size: 1.1rem; font-weight: 600; margin-bottom: 0.5rem; }
    .success-box { padding: 1.5rem; background: #0a1a0a; border-radius: 12px; border: 1px solid #1a3a1a; }
    .check-icon { margin-bottom: 1rem; }
    .error { color: #EF4444; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">Lavarage</div>
    <h1>${title}</h1>
    ${body}
  </div>
</body>
</html>`
}
