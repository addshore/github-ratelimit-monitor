// Cloudflare Pages Function — handles the GitHub OAuth code→token exchange.
//
// TODO: Configure these as secrets in the Cloudflare Pages dashboard:
//   Settings → Environment variables →
//     GITHUB_CLIENT_ID     = <your OAuth App client ID>
//     GITHUB_CLIENT_SECRET = <your OAuth App client secret>

interface Env {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
}

interface TokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const code = url.searchParams.get('code');

  if (!code) {
    return new Response('Missing authorization code', { status: 400 });
  }

  const tokenRes = await fetch(
    'https://github.com/login/oauth/access_token',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: context.env.GITHUB_CLIENT_ID,
        client_secret: context.env.GITHUB_CLIENT_SECRET,
        code,
      }),
    }
  );

  const tokenData: TokenResponse = await tokenRes.json();

  if (tokenData.error || !tokenData.access_token) {
    return new Response(
      `Authentication failed: ${tokenData.error_description || tokenData.error || 'unknown error'}`,
      { status: 400 }
    );
  }

  // Safely embed the token in the response page.
  // JSON.stringify escapes all special chars; we also escape < and > to
  // prevent any possibility of breaking out of the <script> tag.
  const safeToken = JSON.stringify(tokenData.access_token)
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
    window.opener.postMessage(
      { type: 'github-oauth-token', token: token },
      location.origin
    );
    window.close();
  } else {
    localStorage.setItem('gh_token', token);
    window.location.href = '/';
  }
</script>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html;charset=UTF-8' },
  });
};
