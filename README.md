# Retailcloud World Cup Hub

Internal World Cup prediction contest for Retailcloud employees. Mobile-first single-page app with Google Sign-In, match predictions, automatic points, and live leaderboards.

## Quick start

```bash
npm install
cp .env .env   # then set GOOGLE_CLIENT_ID and JWT_SECRET
npm start              # http://localhost:3000
```

### Google OAuth setup (required)

1. Go to [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials).
2. Create an **OAuth 2.0 Client ID** of type **Web application**.
3. Add Authorized JavaScript origins: `http://localhost:3000` and your production URL.
4. Put the client ID in `.env` as `GOOGLE_CLIENT_ID`.

There is no password login, no registration, no guest access — Google Sign-In only.

## Access control

- **Employee allowlist**: `config/employees.json`. Edit and save — no restart needed (re-read every 10s). Emails matched lowercase, verified server-side against the Google ID token.
- **Admin allowlist**: `config/admins.json` (currently `safwan@retailcloud.com`).
- Non-allowlisted users see: *"Access restricted. Your email is not registered for the Retailcloud World Cup Hub."*
- Every API route re-checks the allowlist, so removing an employee locks them out immediately.

## Scoring rules

| Outcome | Points |
|---|---|
| Correct winner or draw | 3 |
| Exact score | +5 bonus |
| Wrong | 0 |

Predictions lock automatically at kickoff (enforced server-side). Editable any time before kickoff.

## Sports data

Service layer in `src/sports/` behind a `SportsProvider` interface (`provider.js`), so the API can be swapped later:

- **Default provider**: TheSportsDB (free key `3`), FIFA World Cup league `4429`, season `2026`.
- **Seed fallback**: the app boots with placeholder teams/fixtures so it works with no API key. Group assignments and fixtures in `src/sports/seed.js` are illustrative — run **Admin → Sync matches** to replace with real data.
- **Live agent** (`src/sports/liveAgent.js`, on by default): adaptive background sync. Polls every `LIVE_POLL_SECONDS` (60s) while any match is live or kickoff is within `KICKOFF_WINDOW_MIN` (10 min); drops to every `IDLE_POLL_MINUTES` (15 min) otherwise. Changed results auto-recalculate points and the leaderboard. Status shown at the top of the Admin panel. Disable with `LIVE_AGENT=off`.
- To add API-Football/Sportmonks: create `src/sports/<name>.js` implementing `fetchTeams()`/`fetchFixtures()` and register it in `provider.js`, then set `SPORTS_PROVIDER=<name>`.

## Admin panel (`#admin`)

Sync matches · view all employees · view all predictions · manually set match results (recalculates points for that match) · recalculate all points · reset leaderboard.

## Stack

Node.js + Express + SQLite (`better-sqlite3`) · Google Identity Services + server-side ID-token verification (`google-auth-library`) · JWT session in an httpOnly cookie · vanilla-JS SPA in `public/` (no build step).

## Security notes

- Google ID token verified server-side with audience check; frontend is never trusted.
- All `/api` routes behind auth middleware; admin routes behind a second admin check.
- Prediction lock, score sanity, and winner/score consistency all validated server-side.
- Set a strong `JWT_SECRET` and `NODE_ENV=production` (enables Secure cookies) in production.
