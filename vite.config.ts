import { defineConfig, loadEnv } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    build: {
      outDir: 'dist',
      target: 'esnext',
    },
    plugins: [
      {
        name: 'oauth-callback-dev',
        configureServer(server) {
          server.middlewares.use(
            '/api/auth/callback',
            async (req: IncomingMessage, res: ServerResponse) => {
              const fullUrl = `http://localhost${req.url}`;
              const url = new URL(fullUrl);
              const code = url.searchParams.get('code');

              if (!code) {
                res.writeHead(400);
                res.end('Missing authorization code');
                return;
              }

              const clientId = env.VITE_GITHUB_CLIENT_ID;
              const clientSecret = env.GITHUB_CLIENT_SECRET;

              if (!clientSecret) {
                res.writeHead(500);
                res.end(
                  'GITHUB_CLIENT_SECRET is not set in your .env file.\n' +
                  'Add it for local OAuth to work (it stays server-side).'
                );
                return;
              }

              try {
                const tokenRes = await fetch(
                  'https://github.com/login/oauth/access_token',
                  {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      Accept: 'application/json',
                    },
                    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
                  }
                );

                const data = (await tokenRes.json()) as {
                  access_token?: string;
                  error?: string;
                  error_description?: string;
                };

                if (data.error || !data.access_token) {
                  res.writeHead(400);
                  res.end(`Authentication failed: ${data.error_description ?? data.error ?? 'unknown'}`);
                  return;
                }

                const safeToken = JSON.stringify(data.access_token)
                  .replace(/</g, '\\u003c')
                  .replace(/>/g, '\\u003e');

                const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Authenticating…</title>
<style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;background:#0d1117;color:#e6edf3;}</style>
</head>
<body>
<p>Authenticating…</p>
<script>
  var token = ${safeToken};
  if (window.opener) {
    window.opener.postMessage({ type: 'github-oauth-token', token: token }, location.origin);
    window.close();
  } else {
    localStorage.setItem('gh_token', token);
    window.location.href = '/';
  }
<\/script>
</body>
</html>`;

                res.writeHead(200, { 'Content-Type': 'text/html;charset=UTF-8' });
                res.end(html);
              } catch (err: unknown) {
                res.writeHead(500);
                res.end(String(err));
              }
            }
          );
        },
      },
    ],
  };
});
