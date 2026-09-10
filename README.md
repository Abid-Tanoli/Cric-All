# CricAll

CricAll is a full-stack live cricket scoring and tournament platform with a public user app, an admin scoring console, and a Node/Express API.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **User Frontend** | React 19, Vite 7, Tailwind CSS 4, Redux Toolkit, React Query 5, Socket.IO Client |
| **Admin Console** | React 18, Vite 8, Tailwind CSS 4, Redux Toolkit 2, Socket.IO Client |
| **Backend API** | Node.js, Express 5, Mongoose 9, Socket.IO 4, JWT, bcryptjs |
| **Database** | MongoDB (Mongoose ODM) |
| **Real-time** | Socket.IO (WebSocket transport) |
| **External APIs** | RapidAPI (Cricbuzz), CricAPI, YouTube Data API, RSS |
| **AI Commentary** | Anthropic Claude API |
| **Deployment** | Vercel (serverless-ready) |

## Project Structure

```
CricAll/
├── Frontend/
│   ├── User/            # Public cricket experience (25 pages)
│   ├── Admin/           # Admin scoring console (20 pages)
│   └── Shared/          # 6 reusable components + services
├── Backend/             # Express API (20+ route groups, 22 models)
├── api/index.js         # Vercel serverless entry
├── README.md            # This file
├── DEPLOYMENT.md        # Vercel deployment guide
└── vercel.json          # Vercel config
```

## Features

### User App
- Live match scores with real-time WebSocket updates
- Match detail page with Live, Scorecard, Commentary, Partnerships, Graphs, Info tabs
- Match summary with MVP impact list, key moments, top performers
- Series/tournament listings
- Team & player profiles
- Rankings (batting, bowling, all-rounder, fielding, wicket-keeper)
- Points table for tournaments/leagues
- International cricket data (via external providers)
- News, videos, highlights pages
- Player registration and profile creation
- Dark/light theme toggle

### Admin Console
- Dashboard with match overview
- Ball-by-ball live scoring with full controls
- Match setup wizard (format, playing XI, toss, openers)
- Wagon wheel, pitch map, shot diagram, cricket field map
- AI-powered commentary (via Anthropic Claude)
- DRS review system, super over, tie resolution
- Team, player, event, tournament, series management
- Bulk import for players/teams
- Blog management
- Synchronization panel for external data
- Dark/light mode, mobile-responsive layout

### Backend API
- Full match lifecycle (CRUD, scoring, innings, toss, playing XI)
- Ball-by-ball scoring engine with extras, wickets, partnerships
- Real-time Socket.IO events (ball recorded, score update, over complete, innings end, match end)
- Player & team management with rankings
- Tournament/event management with points table
- External cricket data polling (RapidAPI Cricbuzz)
- AI commentary generation
- Multi-category team system (International/League/Incubation)
- File uploads for team logos

## Local Development

### Prerequisites
- Node.js 18+
- MongoDB (local or Atlas)
- npm

### Install Dependencies

```bash
npm --prefix Backend install
npm --prefix Frontend/User install
npm --prefix Frontend/Admin install
```

### Environment Variables

Create `Backend/.env` (see `Backend/.env.example` for all options):

```env
PORT=5000
MONGO_URL=mongodb://localhost:27017/cric-all
JWT_SECRET=your-secret-key
CORS_ORIGINS=http://localhost:5173,http://localhost:5174
RAPIDAPI_KEY=
RAPIDAPI_CRICKET_HOST=free-cricbuzz-cricket-api.p.rapidapi.com
ENABLE_FREE_CRICBUZZ=false
ENABLE_EXTERNAL_SYNC=false
ANTHROPIC_API_KEY=
```

Create `Frontend/Admin/.env`:

```env
VITE_API_URL=http://localhost:5000/api
VITE_SOCKET_URL=http://localhost:5000
VITE_GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
```

Create `Frontend/User/.env`:

```env
VITE_API_URL=http://localhost:5000/api
VITE_SOCKET_URL=http://localhost:5000
VITE_CRICAPI_KEY=your_api_key_here
VITE_GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
```

### Run Development Servers

**Backend** (port 5000):
```bash
npm --prefix Backend run dev
```

**User Frontend** (port 5173):
```bash
npm --prefix Frontend/User run dev
```

**Admin Frontend** (port 5174):
```bash
npm --prefix Frontend/Admin run dev
```

### Auth Flow

| Role | Access | Auth Required |
|------|--------|---------------|
| **Guest / Spectator** | Read-only public pages (live scores, match detail, scorecard, commentary, teams, players, rankings, news) | No |
| **Admin / Scorer** | Dashboard, match scoring, team/player/event management | Yes (JWT login at `/admin/login`) |
| **Future: Google Login** | Not yet implemented; placeholder hidden until OAuth is configured | — |

- Public user app has `/login` and `/register` routes; users can also **Continue as Guest** for read-only browsing.
- Admin console uses `ProtectedRoute` components; unauthenticated requests redirect to `/admin/login`.
- Guest users cannot access admin scoring or match control pages.
- Token is stored in `localStorage` under both `bq_token` and `token` keys for cross-app compatibility.
- On 401/403 responses, auth state is cleared and user is redirected to login.

### API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/login` | Public | User login (returns JWT) |
| POST | `/api/auth/register` | Public | User registration |
| POST | `/api/auth/logout` | Public | Logout (clears server-side state) |
| GET | `/api/auth/profile` | JWT | Get authenticated user profile |
| POST | `/api/admin/login` | Public | Admin login (returns JWT) |
| POST | `/api/admin/register` | Public | Admin registration |
| GET | `/api/admin/profile` | JWT+Admin | Get admin profile |

### Auth Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Admin login returns "Invalid credentials" | Logging in through wrong endpoint | Ensure admin login uses `/api/admin/login` (not `/api/auth/login`) |
| "Not authorized, no token" after login | Token not sent in request header | Check `Authorization: Bearer <token>` header is present |
| Page stays blank after 401/403 | Response interceptor not handling error | Check API interceptor redirects to login page |
| CORS error in browser console | Backend origin not whitelisted | Add frontend URL to `CORS_ORIGINS` in `Backend/.env` |
| Token lost on page refresh | Redux store not synced to localStorage | Ensure auth reducer initializes from `localStorage` |
| "Admin role required" 403 | User token used on admin route | Admin routes require admin role; log in via `/admin/login` |
| Socket.IO connection failed | CORS mismatch on WebSocket | Same `CORS_ORIGINS` env var controls both HTTP and Socket.IO CORS |

### Environment Variables Reference

**Backend (`Backend/.env`)**:
```
PORT=5000                          # API server port
MONGO_URL=...                      # MongoDB connection string
JWT_SECRET=...                     # JWT signing secret (REQUIRED)
CORS_ORIGINS=http://localhost:5173,http://localhost:5174  # Allowed frontend origins
NODE_ENV=development               # Environment mode
```

**Admin Frontend (`Frontend/Admin/.env`)**:
```
VITE_API_URL=http://localhost:5000/api    # Backend API URL
VITE_SOCKET_URL=http://localhost:5000     # WebSocket server URL
VITE_GOOGLE_CLIENT_ID=...                 # Google OAuth client ID (optional)
```

**User Frontend (`Frontend/User/.env`)**:
```
VITE_API_URL=http://localhost:5000/api    # Backend API URL (or "/api" for proxy)
VITE_SOCKET_URL=http://localhost:5000     # WebSocket server URL
VITE_CRICAPI_KEY=...                      # CricAPI key (optional)
VITE_GOOGLE_CLIENT_ID=...                 # Google OAuth client ID (optional)
```

### User App Routes

| Path | Page |
|------|------|
| `/` | Home (live scores, upcoming, results) |
| `/live` | Live matches |
| `/match/:matchId` | Match detail with tabs |
| `/series` | Series/tournament listings |
| `/series/:seriesId` | Series detail |
| `/players` | Player directory |
| `/teams` | Teams by category |
| `/rankings` | Player/team rankings |
| `/points-table` | Tournament points table |
| `/news`, `/videos`, `/highlights` | Media pages |
| `/international` | International cricket |
| `/login` | Login / Register / Guest entry |
| `/register` | Registration form |

### Admin Routes

| Path | Page | Auth |
|------|------|------|
| `/admin` | Dashboard | Required |
| `/admin/login` | Admin login | Public |
| `/admin/score` | Match selection for scoring | Required |
| `/admin/score/:matchId` | Live scoring interface | Required |
| `/admin/teams` | Team management | Required |
| `/admin/players` | Player management | Required |
| `/admin/events` | Event/tournament management | Required |
| `/admin/blogs` | Blog management | Required |
| `/admin/bulk-import` | Bulk import data | Required |
| `/admin/rankings` | Rankings management | Required |
| `/admin/international` | International cricket management | Required |
| `/admin/sync` | External data sync panel | Required |

### Commentary System

- **AI-powered** commentary via Anthropic Claude API when `ANTHROPIC_API_KEY` is configured in `Backend/.env`.
- **Fallback structured** commentary generated server-side with varied templates (dot ball, single, boundary, six, wicket, no-ball, wide, free-hit, no-ball+wicket-cancelled).
- Commentary is **always factual**: does not invent shot types, wicket modes, or runs.
- Templates include cricketing expressions ("Clean strike!", "Drama on the field!", "Free Hit coming up!", "Pressure building here.") selected deterministically for variety.
- Over summaries provide context-aware analysis (maiden, wicket maiden, run-scoring over).
- Ball-level commentary exposes `short` (broadcast summary) and `vivid` (descriptive) text.

### Manual Testing Checklist

| Area | What to Check |
|------|---------------|
| **User Home** | Live scores load from API; no hardcoded data; loading/error states work |
| **Match Detail** | Tabs (Live, Scorecard, Commentary, Partnerships, Graphs, Info) all render with real data |
| **Scorecard** | Batting/bowling tables show correct runs, wickets, overs, extras |
| **Commentary** | Ball-by-ball commentary appears in real-time; varied templates not repetitive |
| **Commentary — Wicket** | Bowled says "stumps shattered" not "sent to deep cover"; caught says fielder/direction; lbw/bowled do not mention shot type or direction |
| **Commentary — No-ball + Wicket** | When admin marks wicket on no-ball, commentary says "No ball called, wicket cancelled, batter survives, Free Hit coming" — never says "out" |
| **Commentary — Free Hit** | Free Hit mentioned next ball after no-ball; commentary doesn't say "out" on free-hit wicket attempt |
| **Commentary — Fallback** | Disconnect AI API key, verify structured fallback works for dot/single/boundary/wide/no-ball/wicket |
| **Commentary — Over Summary** | At over end, summary shows runs/wickets/maiden context |
| **Partnerships** | Partnership bars render correctly for each wicket |
| **Graphs** | Run-rate graph, wicket chart use team names from match data |
| **Admin Score Page** | Responsive at 360px–1440px; no horizontal overflow; buttons tap-friendly; sidebar works on mobile; Mid Session button visible |
| **Admin Auth** | `/admin/*` redirects to login when unauthenticated; login works |
| **Guest Flow** | Public pages accessible without login; no 401 errors; header shows Login/Join instead of profile |
| **Scoring** | Striker/non-striker/bowler selection works; extras/wicket/no-ball/free-hit UI readable; match-not-started shows correct state (not infinite loading) |

## Production Build (not yet verified in current pass)

```bash
npm run build
```

The root build script installs Backend, User, and Admin dependencies, then builds all frontend dist folders.

## Deployment

See [DEPLOYMENT_DOCKER_RENDER.md](./DEPLOYMENT_DOCKER_RENDER.md) for the Docker Hub and Render deployment guide. The existing [DEPLOYMENT.md](./DEPLOYMENT.md) covers the legacy Vercel deployment option.

## Socket.IO Architecture

- Backend initializes Socket.IO on the HTTP server
- Two frontend socket clients: User and Admin, both using the Shared socket service
- Room-based events: `match-{matchId}` for match-specific updates
- Ball scoring events: `ball:recorded`, `score:update`, `strike:changed`, `over:completed`, `innings:end`, `match:end`
- Legacy events maintained for backward compatibility

## Development Notes

- External cricket APIs are completely optional; the app works fully with local data
- AI commentary requires an Anthropic API key
- Legacy socket events are being phased out in favor of the new event naming convention
- The Shared folder contains cross-app components; prefer importing from Shared when possible

## License

Private project
