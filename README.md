# BQ-PLAY

BQ-PLAY is a cricket scoring and tournament platform with a public user app, an admin scoring console, and a Node/Express API.

## Applications

- `Frontend/User` - public cricket experience built with React, Vite, Tailwind CSS, and Socket.IO client.
- `Frontend/Admin` - admin console for matches, teams, tournaments, scoring, squads, and sync tools.
- `Backend` - Express API with MongoDB, Socket.IO, scoring services, live cricket provider integrations, news, highlights, and admin routes.

## Local Development

Install dependencies in each workspace:

```bash
npm --prefix Backend install
npm --prefix Frontend/User install
npm --prefix Frontend/Admin install
```

Run the backend:

```bash
npm --prefix Backend run dev
```

Run the user frontend:

```bash
npm --prefix Frontend/User run dev
```

Run the admin frontend:

```bash
npm --prefix Frontend/Admin run dev
```

## Environment

Create `Backend/.env` with:

```env
PORT=5000
MONGO_URL=
JWT_SECRET=
RAPIDAPI_KEY=
RAPIDAPI_CRICKET_HOST=free-cricbuzz-cricket-api.p.rapidapi.com
ENABLE_FREE_CRICBUZZ=false
ENABLE_EXTERNAL_SYNC=false
```

For production frontend builds, set:

```env
VITE_API_URL=/api/
```

## Production Build

```bash
npm run build
```

The root build script installs User and Backend dependencies, then builds `Frontend/User/dist`.

## Deployment

This repo includes `vercel.json` and `api/index.js` so Vercel can serve:

- `/api/*` through the Express API entry
- all other routes through the User SPA

Socket.IO works best on a persistent Node host. Vercel serverless can serve HTTP API routes, but real-time sockets should be moved to a persistent backend if production live rooms are required.
