# Contributing to CricAll

## Prerequisites

- Node.js 18+
- MongoDB (local or Atlas)
- npm

## Quick Start

```bash
# 1. Install dependencies
npm --prefix Backend install
npm --prefix Frontend/User install
npm --prefix Frontend/Admin install

# 2. Configure env files
cp Backend/.env.example Backend/.env
cp Frontend/Admin/.env.example Frontend/Admin/.env
cp Frontend/User/.env.example Frontend/User/.env

# 3. Edit Backend/.env — set MONGO_URL and JWT_SECRET
# 4. Seed default admin + sample data
npm --prefix Backend run seed

# 5. Start all three servers (in separate terminals)
npm --prefix Backend run dev        # API on port 5000
npm --prefix Frontend/User run dev  # User app on port 5173
npm --prefix Frontend/Admin run dev # Admin console on port 5174
```

## Project Structure

```
CricAll/
├── Backend/             # Express API (22 models, 20+ route groups)
│   ├── src/
│   │   ├── controllers/ # Route handlers
│   │   ├── middleware/   # Auth, error handling, validation
│   │   ├── models/      # Mongoose schemas
│   │   ├── routes/      # Express routers
│   │   ├── services/    # Business logic, scoring engine, polling
│   │   ├── socket/      # Socket.IO real-time events
│   │   └── utils/       # JWT, logger, helpers
│   └── test/            # Unit + integration tests (node --test)
├── Frontend/
│   ├── Admin/           # React 18 admin console (Vite 8)
│   ├── User/            # React 19 public app (Vite 7)
│   └── Shared/          # Cross-app components & services
├── api/                 # Vercel serverless entry
├── CONTRIBUTING.md      # This file
├── DEPLOYMENT.md        # Vercel deployment guide
└── README.md            # Full project documentation
```

## Running Tests

### Backend Tests

```bash
npm --prefix Backend test
```

Tests use Node.js built-in `node --test` runner. Located in `Backend/test/`.

| Test File | Type | Description |
|-----------|------|-------------|
| `scoringEngine.test.js` | Unit | Scoring engine delivery processing |
| `auth.test.js` | Unit | Auth validation, JWT, role checks |
| `auth-api.test.js` | Integration | Full auth HTTP flow (login, register, protected routes, role-based) |

### Admin Frontend Tests

```bash
npm --prefix Frontend/Admin test
```

Uses Vitest with jsdom. Located in `Frontend/Admin/src/test/`.

| Test File | Type | Description |
|-----------|------|-------------|
| `AuthFlow.test.jsx` | Unit | Token persistence, logout, route guard, localStorage |
| `StatsTab.test.jsx` | Component | Stats tab rendering |

### User Frontend Tests

```bash
npm --prefix Frontend/User test
```

Uses Vitest with jsdom. Located in `Frontend/User/src/test/`.

| Test File | Type | Description |
|-----------|------|-------------|
| `AuthService.test.jsx` | Unit | Auth service persistence, guest mode, Google login |
| `Teams.test.jsx` | Component | Teams page loading state |
| `WagonWheel.test.jsx` | Component | Wagon wheel chart |
| `WagonWheelTab.test.jsx` | Component | Wagon wheel tab integration |

### Smoke / Integration Tests

```bash
# API smoke test (requires backend on localhost:5000)
node Backend/scripts/api-smoke-test.cjs

# Scoring flow test (requires backend + seeded data)
node Backend/scripts/scoring-flow-test.cjs
```

## Auth System

### How It Works

1. **Admin users** login at `/admin/login` → `POST /api/admin/login` → returns JWT
2. **Regular users** login at `/login` → `POST /api/auth/login` → returns JWT
3. Token stored in `localStorage` under both `bq_token` and `token` keys
4. JWT includes `{ id, email, role }` and expires in 7 days
5. Backend middleware:
   - `protect` — verifies JWT, attaches `req.user`
   - `requireAdmin` — checks `req.user.role === "admin"`

### Auth Middleware Flow

```
Request → protect → requireAdmin (for admin routes) → Controller
              │            │
              │            └─ 403 if role !== "admin"
              │
              └─ 401 if no/invalid/expired token
```

### Frontend Route Guards

- **Admin**: `ProtectedRoute` component checks `state.auth.token` → redirects to `/admin/login` if missing
- **User**: Public routes always accessible; auth pages show login/register/guest options
- **API interceptor**: On 401/403 response, clears localStorage and redirects to login

## CORS Configuration

CORS is configured via `CORS_ORIGINS` env var in `Backend/.env`:

```env
CORS_ORIGINS=http://localhost:5173,http://localhost:5174,https://your-production-domain.com
```

This controls both HTTP CORS and Socket.IO CORS.

## Testing Guidelines

### When to Add Tests

- **New API endpoint**: Add HTTP integration test in `Backend/test/`
- **New frontend component**: Add Vitest test in the respective `src/test/` folder
- **Auth change**: Update `auth.test.js` and `auth-api.test.js`
- **Bug fix**: Add a test that reproduces the bug before fixing

### Test Conventions

- Backend tests use `node:test` and `node:assert/strict`
- Frontend tests use Vitest + `@testing-library/react`
- Tests should be self-contained and not depend on external services (mock where needed)
- API integration tests gracefully skip when backend is not running

## Environment Variables

### Backend

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MONGO_URL` | Yes | — | MongoDB connection string |
| `JWT_SECRET` | Yes | — | JWT signing secret |
| `PORT` | No | `5000` | API server port |
| `NODE_ENV` | No | `development` | Environment |
| `CORS_ORIGINS` | No | Allow all | Comma-separated allowed origins |
| `RAPIDAPI_KEY` | No | — | RapidAPI key for live cricket data |
| `ANTHROPIC_API_KEY` | No | — | Claude API key for AI commentary |

### Admin Frontend

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_API_URL` | No | `http://localhost:5000/api` | Backend API URL |
| `VITE_SOCKET_URL` | No | `http://localhost:5000` | WebSocket server URL |
| `VITE_GOOGLE_CLIENT_ID` | No | — | Google OAuth client ID |

### User Frontend

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_API_URL` | No | `/api` (proxy) | Backend API URL |
| `VITE_SOCKET_URL` | No | — | WebSocket server URL |
| `VITE_GOOGLE_CLIENT_ID` | No | — | Google OAuth client ID |

## Common Issues

| Problem | Solution |
|---------|----------|
| CORS error | Add frontend origin to `CORS_ORIGINS` in backend `.env` |
| MongoDB connection failed | Check `MONGO_URL` and network access (IP whitelist in Atlas) |
| Admin login returns "Invalid credentials" | Use `/admin/login` endpoint (not `/auth/login`) |
| Token lost on refresh | Ensure auth slice initializes from `localStorage` |
| Socket.IO won't connect | Check `VITE_SOCKET_URL` or proxy config in `vite.config.js` |
| Build fails with memory error | Run builds individually: `npm --prefix Frontend/Admin run build` |

## Deployment

See `DEPLOYMENT.md` for Vercel deployment instructions.

## Code Style

- No semicolons (enforced by Prettier if configured)
- Single quotes for strings (JS/JSX)
- 2-space indentation
- Component files use `.jsx` extension
- No `console.log` in production code (use `Backend/src/utils/logger.js` instead)
