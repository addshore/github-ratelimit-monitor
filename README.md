# GitHub Rate Limit Monitor

A TypeScript web app to monitor GitHub REST API rate limits in real time.

https://github-ratelimit-monitor.addshore.com/

![](https://addshore.com/wp-content/uploads/2026/03/Screenshot-2026-03-31-121249.png)

It provides:
- Live polling of GitHub rate limit resources
- Interactive charts (combined and per-resource)
- Demo mode when not authenticated
- GitHub OAuth login flow
- Local persistence of historical data (compact format)
- CSV export + data cleanup tools
- Optional overlays (reset lines, trend-to-reset)

![](https://addshore.com/wp-content/uploads/2026/03/Screenshot-2026-03-31-121142.png)

## Tech stack

- Vite + TypeScript
- Chart.js
- Cloudflare Pages + Pages Functions (OAuth callback)

## Quick start (local)

1. Install dependencies:

   npm install

2. Create `.env` from `.env.example` and configure:

   - `VITE_GITHUB_CLIENT_ID`
   - `GITHUB_CLIENT_SECRET`

3. Start dev server:

   npm run dev

4. Open the shown local URL (typically `http://localhost:5173`).

## OAuth setup

Create a GitHub OAuth App at:

https://github.com/settings/developers

Use:
- Homepage URL: your app URL
- Authorization callback URL: `https://<your-domain>/api/auth/callback`

For local dev callback, use:
- `http://localhost:5173/api/auth/callback`

## Build

npm run build

## Deploy (Cloudflare Pages)

This repository includes `wrangler.toml` with Pages output set to `dist`.

Deploy:

npm run deploy

Set the following **production secrets** in Cloudflare Pages:
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`

## Scripts

- `npm run dev` — start local dev server
- `npm run build` — type-check + production build
- `npm run preview` — preview built app locally
- `npm run deploy` — build and deploy to Cloudflare Pages

## Data storage notes

- Data is stored in browser `localStorage`
- Uses a compact columnar format to reduce storage size
- Includes UI controls for:
  - clear all data
  - clear data outside current time window

## License

See [LICENCE.md](./LICENCE.md).
