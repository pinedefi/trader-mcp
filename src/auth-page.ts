/**
 * Generates the HTML for the device auth page at /auth/:code.
 *
 * Two login paths:
 * 1. Wallet connect (Phantom/Solflare) — signs a challenge message, no deps
 * 2. Privy login (email/social) — uses Privy's React SDK via a pre-built bundle
 *
 * After auth, the page POSTs credentials to /auth/:code/complete and shows success.
 */

export function renderAuthPage(opts: {
  title: string
  message?: string
  showLogin: boolean
  privyAppId?: string
  code?: string
  nonce?: string
  publicUrl?: string
}): string {
  const { title, message, showLogin, privyAppId, code, nonce, publicUrl } = opts

  if (!showLogin) {
    return renderShell(title, message ? `<p class="msg">${message}</p>` : '')
  }

  return renderShell(title, `
    <p class="msg">Connect your Solana wallet to start trading with your AI agent.</p>

    <div id="auth-buttons">
      <button class="btn btn-primary" id="btn-phantom" onclick="connectWallet('phantom')">
        <img src="https://phantom.app/img/phantom-icon-purple.svg" width="20" height="20" alt="">
        Phantom
      </button>
      <button class="btn btn-primary" id="btn-solflare" onclick="connectWallet('solflare')">
        <img src="https://solflare.com/favicon.svg" width="20" height="20" alt="">
        Solflare
      </button>
    </div>

    <div id="status"></div>

    <script>
      const CODE = ${JSON.stringify(code)};
      const NONCE = ${JSON.stringify(nonce)};
      const PUBLIC_URL = ${JSON.stringify(publicUrl)};
      const PRIVY_APP_ID = ${JSON.stringify(privyAppId)};

      // Exact message format — must match server's buildChallengeMessage()
      function challengeMessage(wallet) {
        return 'Sign this message to authenticate with Lavarage MCP.\\n\\n' +
               'Wallet: ' + wallet + '\\n' +
               'Code: ' + CODE + '\\n' +
               'Nonce: ' + NONCE;
      }

      function setStatus(html) {
        document.getElementById('status').innerHTML = html;
      }

      function setError(msg) {
        setStatus('<p class="error">' + msg + '</p>');
        enableButtons();
      }

      function disableButtons() {
        document.querySelectorAll('.btn').forEach(b => b.disabled = true);
      }

      function enableButtons() {
        document.querySelectorAll('.btn').forEach(b => b.disabled = false);
      }

      async function connectWallet(type) {
        disableButtons();
        setStatus('<p class="pending">Connecting wallet...</p>');

        try {
          let provider;
          if (type === 'phantom') {
            provider = window.phantom?.solana;
            if (!provider) {
              setError('Phantom wallet not found. <a href="https://phantom.app" target="_blank">Install Phantom</a>');
              return;
            }
          } else if (type === 'solflare') {
            provider = window.solflare;
            if (!provider) {
              setError('Solflare wallet not found. <a href="https://solflare.com" target="_blank">Install Solflare</a>');
              return;
            }
          }

          // Connect
          const resp = await provider.connect();
          const walletAddress = resp.publicKey.toString();
          setStatus('<p class="pending">Connected: ' + walletAddress.slice(0,4) + '...' + walletAddress.slice(-4) + '. Signing message...</p>');

          // Sign the server-generated challenge message
          const message = challengeMessage(walletAddress);
          const encoded = new TextEncoder().encode(message);
          const { signature } = await provider.signMessage(encoded, 'utf8');

          // Convert signature to base64
          const sigBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)));

          setStatus('<p class="pending">Verifying...</p>');

          // POST to the server
          const res = await fetch(PUBLIC_URL + '/auth/' + CODE + '/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'wallet',
              walletAddress: walletAddress,
              signature: sigBase64,
              message: message,
            }),
          });

          const data = await res.json();

          if (data.success) {
            document.getElementById('auth-buttons').style.display = 'none';
            setStatus(
              '<div class="success-box">' +
              '<p class="success">Wallet connected!</p>' +
              '<p class="wallet">' + data.wallet + '</p>' +
              '<p class="msg">Go back to your AI agent. It will automatically detect the login.</p>' +
              '</div>'
            );
          } else {
            setError(data.error || 'Authentication failed. Try again.');
          }
        } catch (err) {
          if (err.code === 4001 || err.message?.includes('rejected')) {
            setError('Signature request was rejected. Try again.');
          } else {
            setError('Error: ' + (err.message || err));
          }
        }
      }

      // Auto-detect available wallets
      window.addEventListener('load', () => {
        if (!window.phantom?.solana) {
          document.getElementById('btn-phantom').classList.add('btn-disabled');
          document.getElementById('btn-phantom').title = 'Phantom not installed';
        }
        if (!window.solflare) {
          document.getElementById('btn-solflare').classList.add('btn-disabled');
          document.getElementById('btn-solflare').title = 'Solflare not installed';
        }
      });
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
      background: #0a0a0a;
      color: #e5e5e5;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .container {
      text-align: center;
      max-width: 420px;
      padding: 2.5rem;
      background: #141414;
      border-radius: 16px;
      border: 1px solid #222;
    }
    .logo {
      font-size: 1.75rem;
      font-weight: 700;
      margin-bottom: 0.5rem;
      background: linear-gradient(135deg, #F56506, #FF8A3D);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    h1 { font-size: 1.25rem; margin-bottom: 0.75rem; color: #fff; }
    .msg { color: #888; margin-bottom: 1.5rem; line-height: 1.6; font-size: 0.9rem; }
    #auth-buttons { display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 1rem; }
    .btn {
      display: flex; align-items: center; justify-content: center; gap: 0.5rem;
      background: #1a1a2e; color: #e5e5e5; border: 1px solid #333;
      padding: 14px 24px; border-radius: 12px; font-size: 1rem;
      cursor: pointer; transition: all 0.15s;
    }
    .btn:hover { background: #252540; border-color: #555; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-primary { background: #1a1a2e; }
    .btn-disabled { opacity: 0.4; }
    .pending { color: #F59E0B; font-size: 0.9rem; }
    .error { color: #EF4444; font-size: 0.9rem; }
    .error a { color: #F59E0B; }
    .success { color: #22C55E; font-size: 1.1rem; font-weight: 600; margin-bottom: 0.5rem; }
    .success-box { padding: 1.5rem; background: #0a1a0a; border-radius: 12px; border: 1px solid #1a3a1a; }
    .wallet { font-family: monospace; font-size: 0.75rem; color: #666; word-break: break-all; margin-bottom: 0.75rem; }
    #status { margin-top: 1rem; }
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
