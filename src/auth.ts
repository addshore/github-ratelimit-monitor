const TOKEN_KEY = 'gh_token';
const GITHUB_OAUTH_URL = 'https://github.com/login/oauth/authorize';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function initiateLogin(): void {
  const clientId = import.meta.env.VITE_GITHUB_CLIENT_ID;
  if (!clientId || clientId === 'your_github_oauth_client_id_here') {
    alert(
      'GitHub OAuth Client ID is not configured.\n\n' +
      'Create a .env file from .env.example and set VITE_GITHUB_CLIENT_ID.'
    );
    return;
  }

  const redirectUri = `${window.location.origin}/api/auth/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: '', // No scopes needed — rate_limit endpoint works with any valid token
  });

  const url = `${GITHUB_OAUTH_URL}?${params.toString()}`;

  // Open as popup so the main page keeps running
  const width = 500;
  const height = 700;
  const left = window.screenX + (window.outerWidth - width) / 2;
  const top = window.screenY + (window.outerHeight - height) / 2;
  window.open(
    url,
    'github-oauth',
    `width=${width},height=${height},left=${left},top=${top}`
  );
}

export function listenForAuth(callback: (token: string) => void): void {
  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    if (event.data?.type === 'github-oauth-token' && event.data?.token) {
      setToken(event.data.token);
      callback(event.data.token);
    }
  });
}
