const http = require('http');
const { URL } = require('url');

class BridgeServer {
  constructor(options) {
    this.options = options;
    this.server = null;
  }

  start() {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        // Handle CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        const parsedUrl = new URL(req.url || '/', `http://127.0.0.1:${this.options.port}`);
        const pathname = parsedUrl.pathname;

        // Health / Status Endpoint
        if (req.method === 'GET' && (pathname === '/' || pathname === '/api/status')) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            app: 'debate-companion-desk',
            status: 'online',
            version: '1.0.0',
            ...this.options.getStatus()
          }));
          return;
        }

        // Web Handoff Callback Endpoint (GET /auth/callback?token=...&user=...)
        if (req.method === 'GET' && pathname === '/auth/callback') {
          const token = parsedUrl.searchParams.get('token');
          const userId = parsedUrl.searchParams.get('user_id') || 'researcher';
          const email = parsedUrl.searchParams.get('email') || '';
          const accessToken = parsedUrl.searchParams.get('access_token') || '';
          const refreshToken = parsedUrl.searchParams.get('refresh_token') || '';
          const expiresAt = Number(parsedUrl.searchParams.get('expires_at')) || 0;

          if (token) {
            const session = {
              userId,
              userName: decodeURIComponent(parsedUrl.searchParams.get('name') || 'Debate Researcher'),
              userEmail: decodeURIComponent(email),
              token,
              accessToken,
              refreshToken,
              expiresAt,
              role: 'researcher',
              authorizedAt: Date.now()
            };
            this.options.onAuthTokenReceived(session);

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
              <html>
                <body style="font-family: system-ui, sans-serif; text-align: center; padding: 50px; background: #F1ECE2; color: #1D1B17;">
                  <h2 style="color: #B9472B;">✓ 模擬庭提問陪伴台帳 · 驗證成功</h2>
                  <p>身分已成功連通桌面端，請返回陪伴視窗開始練習。</p>
                  <script>setTimeout(function(){ window.close(); }, 2000);</script>
                </body>
              </html>
            `);
            return;
          }
        }

        // Web Handoff POST Endpoint
        if (req.method === 'POST' && pathname === '/auth/handoff') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try {
              const data = JSON.parse(body);
              if (data && data.token) {
                this.options.onAuthTokenReceived(data);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
                return;
              }
            } catch (_) {}
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid auth payload' }));
          });
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      });

      this.server.on('error', (err) => {
        console.warn('Bridge server port in use or error:', err);
        resolve(this.options.port);
      });

      this.server.listen(this.options.port, '127.0.0.1', () => {
        console.log(`Bridge server listening on http://127.0.0.1:${this.options.port}`);
        resolve(this.options.port);
      });
    });
  }

  stop() {
    if (this.server) {
      try { this.server.close(); } catch (_) {}
    }
  }
}

module.exports = { BridgeServer };
