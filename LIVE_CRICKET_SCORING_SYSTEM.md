# BQ-PLAY Live Cricket Scoring System

BQ-PLAY is a full-stack cricket scoring and tournament platform for local matches, series, tournaments, live score views, and admin scoring workflows.

## Architecture

- **User app:** React, Vite, Tailwind CSS, Socket.IO client.
- **Admin app:** React, Vite, Tailwind CSS, scoring and management tools.
- **Backend:** Node.js, Express, MongoDB, Mongoose, Socket.IO.
- **Live data:** External provider adapters with caching, graceful empty states, and quota-aware status messages.

## Core User Features

- Live match center with score, scorecard, commentary, match info, stats, overs, playing XI, photos, news, and videos when the provider returns those feeds.
- Series and tournament pages for local BQ-PLAY events.
- International pages backed by configured live cricket APIs.
- Highlights and news sections with neutral BQ-PLAY presentation.
- Dark/light theme support.

## Admin Features

- Match, team, player, event, series, and tournament management.
- Ball-by-ball scoring controls.
- Scorecard and innings management.
- Optional AI-assisted commentary generation.
- Real-time updates to user match pages.

## Local Development

```bash
npm --prefix Backend install
npm --prefix Frontend/User install
npm --prefix Frontend/Admin install
```

Run the apps:

```bash
npm --prefix Backend run dev
npm --prefix Frontend/User run dev
npm --prefix Frontend/Admin run dev
```

Default local URLs:

- Backend API: `http://localhost:5000/api`
- User app: `http://localhost:5173`
- Admin app: `http://localhost:5174`

## Environment

Backend `.env` minimum:

```env
PORT=5000
MONGO_URL=
JWT_SECRET=
RAPIDAPI_KEY=
RAPIDAPI_CRICKET_HOST=
ENABLE_FREE_CRICBUZZ=false
ENABLE_EXTERNAL_SYNC=false
ENABLE_DEMO_CRICKET_DATA=false
```

User frontend production build:

```env
VITE_API_URL=/api/
```

## Live Data Rules

- BQ-PLAY does not show demo international data unless `ENABLE_DEMO_CRICKET_DATA=true`.
- If the provider quota is exhausted, the UI shows a clear live-data notice instead of fake scores.
- Old completed series matches require a provider endpoint that exposes historical fixtures/results for that series.
- Photos, videos, commentary, playing XI, and live stats only appear when the configured provider returns them.

## Deployment Notes

This repo includes Vercel support through `vercel.json` and `api/index.js`.

- `/api/*` routes are handled by the Express serverless entry.
- User frontend routes are served from `Frontend/User/dist`.
- Socket.IO live rooms work best on a persistent Node host. Vercel serverless is fine for HTTP APIs, but production real-time sockets should be hosted on a persistent backend.

## Quality Checks

```bash
npm --prefix Frontend/User run build
npm --prefix Frontend/Admin run build
node --check Backend/src/index.js
```
