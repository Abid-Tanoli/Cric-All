# CricAll Legacy Vercel Deployment Guide

## Recommended topology

- Vercel project `cricall-user` for `Frontend/User`
- Vercel project `cricall-admin` for `Frontend/Admin`
- One persistent Node service for `Backend` (Render, Railway, or Fly.io)

The backend currently owns the Express server, Socket.IO rooms, and live-update
processes. Do not deploy the existing `api/index.js` adapter as the production
backend: it exports only the Express app, while Socket.IO is attached to a
separate HTTP server.

## Vercel team

Select the team `abid-ali-tanolis-projects` before creating or linking either
frontend project.

## User frontend

```text
Project Name: cricall-user
Root Directory: Frontend/User
Framework Preset: Vite
Install Command: npm ci
Build Command: npm run build
Output Directory: dist
```

Enable **Include source files outside of the Root Directory in the Build Step**
because this app imports `Frontend/Shared`.

Required Production and Preview environment variables:

```env
VITE_API_URL=https://your-backend.example/api
VITE_SOCKET_URL=https://your-backend.example
```

Optional:

```env
VITE_GOOGLE_CLIENT_ID=
VITE_CRICAPI_KEY=
```

## Admin frontend

```text
Project Name: cricall-admin
Root Directory: Frontend/Admin
Framework Preset: Vite
Install Command: npm ci
Build Command: npm run build
Output Directory: dist
```

Enable **Include source files outside of the Root Directory in the Build Step**
because this app imports `Frontend/Shared`.

Required Production and Preview environment variables:

```env
VITE_API_URL=https://your-backend.example/api
VITE_SOCKET_URL=https://your-backend.example
```

Optional:

```env
VITE_GOOGLE_CLIENT_ID=
VITE_GOOGLE_MAPS_KEY=
```

Both frontend directories contain a minimal `vercel.json` SPA fallback so
refreshing a React Router URL serves `index.html`.

## Persistent backend

Use the following service settings:

```text
Root Directory: Backend
Runtime: Node
Build Command: npm ci
Start Command: npm start
Health Check Path: /api/health
```

Required production environment variables:

```env
NODE_ENV=production
MONGO_URL=mongodb+srv://.../cric-all
REQUIRE_MONGO_DB_NAME=true
JWT_SECRET=...
CORS_ORIGINS=https://your-user-domain,https://your-admin-domain
ALLOW_DESTRUCTIVE_DB_SEED=false
ALLOW_PRODUCTION_DB_RESET=false
ALLOW_DB_RESET=false
```

Add exact Vercel preview origins to `CORS_ORIGINS` while preview-testing. Local
development origins may remain in the comma-separated list if needed:

```text
http://localhost:5173,http://localhost:5174
```

Optional backend variables are documented in `Backend/.env.example`. Never copy
real secret values into source control or `vercel.json`.

## Release order

1. Deploy the backend and verify `/api/health`.
2. Configure both Vercel projects with the backend API and Socket.IO URLs.
3. Deploy Vercel previews and test login, admin scoring, live score updates,
   scorecard, commentary, and direct route refreshes.
4. Promote/deploy production only after both preview builds and smoke checks
   succeed.
