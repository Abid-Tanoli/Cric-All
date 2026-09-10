# CricAll: Docker Hub and Render Deployment

This guide uses these exact public Docker Hub images:

- Backend: `abidtanoli/cricall-backend:v1`
- User frontend: `abidtanoli/cricall-user-frontend:v1`
- Admin frontend: `abidtanoli/cricall-admin-frontend:v1`

Run every PowerShell command from:

```powershell
Set-Location "C:\Users\Abid\Desktop\Abid Web Development\Cric-All"
```

The physical folder can keep its old name. The application and image names are CricAll.

## 1. Sign in to Docker Hub

Create the three repositories in Docker Hub if they do not exist, then sign in:

```powershell
docker login
```

Use a Docker Hub access token instead of putting a password in a script. Keep the repositories public for the simplest Render setup. Private repositories require a Docker Hub registry credential in Render.

## 2. Build the backend image

```powershell
docker build --platform linux/amd64 -t abidtanoli/cricall-backend:v1 .\Backend
```

The helper command is:

```powershell
npm run docker:build:backend
```

## 3. Test the backend locally

Create `Backend\.env` from `Backend\.env.example` and put your real values only in `Backend\.env`. Do not commit that file.

```powershell
docker run --rm --name cricall-backend-test --env-file .\Backend\.env -p 5000:5000 abidtanoli/cricall-backend:v1
```

In a second PowerShell window:

```powershell
Invoke-RestMethod http://localhost:5000/api/health
```

Expected result includes `success: true` and `message: CricAll API is running`. Press `Ctrl+C` in the first window to stop the container.

## 4. Push the backend image

```powershell
docker push abidtanoli/cricall-backend:v1
```

## 5. Deploy the backend on Render

1. Open the Render Dashboard.
2. Select **New > Web Service**.
3. Select **Existing Image**.
4. Enter `docker.io/abidtanoli/cricall-backend:v1`.
5. Select **Connect**.
6. Use a name such as `cricall-backend`.
7. Choose a region close to your users and MongoDB Atlas region.
8. Choose the Free instance type for hobby testing.
9. In **Advanced**, set the health check path to `/api/health`.
10. Add the backend environment variables listed below.
11. Create the web service.

Render sets `PORT` automatically. The backend already listens on `process.env.PORT` and does not need a custom Docker command.

After deployment, copy the backend URL, for example:

```text
https://cricall-backend.onrender.com
```

Verify:

```powershell
Invoke-RestMethod https://cricall-backend.onrender.com/api/health
```

Official reference: [Deploy a prebuilt Docker image on Render](https://render.com/docs/deploying-an-image).

## 6. Backend environment variables on Render

Add these in the backend service's **Environment** page:

```text
NODE_ENV=production
MONGODB_URI=<your Atlas URI including the existing database name>
JWT_SECRET=<a long random secret>
CORS_ORIGINS=https://your-user-service.onrender.com,https://your-admin-service.onrender.com
```

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | Yes | `production` |
| `MONGODB_URI` | Yes | Full Atlas URI including database path (`/cric-all`) |
| `JWT_SECRET` | Yes | Long random secret for token signing |
| `CORS_ORIGINS` | Yes | Comma-separated origin URLs — the only source of truth for allowed CORS origins |
| `CLIENT_URL` | No | Optional alias for the user frontend origin (legacy compat) |
| `ADMIN_URL` | No | Optional alias for the admin frontend origin (legacy compat) |
| `FRONTEND_URL` | No | Optional alias for `CLIENT_URL` (legacy compat) |

The CORS configuration in `Backend/src/config/cors.js` reads **only** `CORS_ORIGINS` plus the three optional aliases. Localhost development origins (`localhost:3000`, `localhost:3001`, `localhost:5173`, `localhost:5174`) are allowed automatically when `NODE_ENV` is not `production`. In production, `CORS_ORIGINS` alone controls access.

`CLIENT_URL`, `ADMIN_URL`, and `FRONTEND_URL` are **optional aliases** accepted only in addition to `CORS_ORIGINS`. They exist for backward compatibility with previous deployments. If you set `CORS_ORIGINS` correctly, these three are unnecessary.

Optional variables already documented in `Backend/.env.example` include Google OAuth, RapidAPI, CricAPI, YouTube, RSS, Sentry, and AI commentary settings. Add only the integrations you use.

Do not add `ALLOW_DB_RESET=true`, `ALLOW_DESTRUCTIVE_DB_SEED=true`, or `ALLOW_PRODUCTION_DB_RESET=true` in production.

## 7. Allow Render to reach MongoDB Atlas

1. Open MongoDB Atlas.
2. Open the correct project.
3. Go to **Security > Network Access**.
4. Add the network address that should reach the cluster.
5. For a free Render service without a fixed outbound IP, the simple testing option is `0.0.0.0/0` (**Allow Access from Anywhere**).
6. If you use `0.0.0.0/0`, protect the database with a strong, unique database-user password and minimum required database privileges.
7. Confirm that `MONGODB_URI` includes an explicit database path. Keep the current database name unless you intentionally migrate it later.

Atlas only accepts connections from its project IP access list. See [MongoDB Atlas IP access list documentation](https://www.mongodb.com/docs/atlas/security/ip-access-list/).

## 8. Build and push the User frontend

Vite variables are baked into the image during `docker build`. Replace the example backend URL before building:

```powershell
$BackendUrl = "https://cricall-backend.onrender.com"

docker build --platform linux/amd64 `
  --build-arg "VITE_API_URL=$BackendUrl/api" `
  --build-arg "VITE_SOCKET_URL=$BackendUrl" `
  -f .\Frontend\User\Dockerfile `
  -t abidtanoli/cricall-user-frontend:v1 `
  .\Frontend

docker push abidtanoli/cricall-user-frontend:v1
```

Equivalent helper script:

```powershell
.\scripts\docker-build-user.ps1 -ApiUrl "$BackendUrl/api" -SocketUrl $BackendUrl
```

The build context is `Frontend`, not `Frontend\User`, because the User app imports code from `Frontend\Shared`.

## 9. Deploy the User frontend on Render

1. Select **New > Web Service > Existing Image**.
2. Enter `docker.io/abidtanoli/cricall-user-frontend:v1`.
3. Use a name such as `cricall-user`.
4. Choose the Free instance type.
5. Create the service.
6. Open the assigned URL and test Home, Live, Match, Scorecard, Commentary, Login, and Register.

No runtime `VITE_API_URL` is needed in Render because it was included when the image was built.

## 10. Build and push the Admin frontend

```powershell
$BackendUrl = "https://cricall-backend.onrender.com"

docker build --platform linux/amd64 `
  --build-arg "VITE_API_URL=$BackendUrl/api" `
  --build-arg "VITE_SOCKET_URL=$BackendUrl" `
  -f .\Frontend\Admin\Dockerfile `
  -t abidtanoli/cricall-admin-frontend:v1 `
  .\Frontend

docker push abidtanoli/cricall-admin-frontend:v1
```

Equivalent helper script:

```powershell
.\scripts\docker-build-admin.ps1 -ApiUrl "$BackendUrl/api" -SocketUrl $BackendUrl
```

## 11. Deploy the Admin frontend on Render

1. Select **New > Web Service > Existing Image**.
2. Enter `docker.io/abidtanoli/cricall-admin-frontend:v1`.
3. Use a name such as `cricall-admin`.
4. Choose the Free instance type.
5. Create the service.
6. Open the assigned URL and test admin login, dashboard, match setup, and scoring.

## 12. Update frontend API URLs

`VITE_API_URL` and `VITE_SOCKET_URL` are build-time values. If the backend URL changes:

1. Rebuild both frontend images with the new backend URL.
2. Push both images using the same tags.
3. In each Render frontend service, choose **Manual Deploy > Deploy latest reference**.

Image-backed Render services do not automatically redeploy just because the image behind a tag changed.

## 13. Update backend frontend URLs

After Render assigns the two frontend URLs:

1. Open the backend service in Render.
2. Update `CORS_ORIGINS` with both frontend origins, separated by a comma.
3. Optionally set `CLIENT_URL` and `ADMIN_URL` as human-readable aliases — they are not required for CORS to work.
4. Save the changes and let Render redeploy the backend.
5. Test API requests and live Socket.IO updates from both frontends.

Do not add a trailing slash to frontend origin values.

## 14. Local Docker Compose test

`docker-compose.yml` starts all three CricAll services and reads backend secrets from `Backend\.env`:

```powershell
docker compose up --build
```

If Compose reports invalid `.env` syntax, fix any non-comment line that is not in `KEY=value` format. Do not paste secret values into commands or commit the file.

Open:

- User frontend: `http://localhost:3000`
- Admin frontend: `http://localhost:3001`
- Backend health: `http://localhost:5000/api/health`

Stop the services without deleting volumes:

```powershell
docker compose down
```

The Mongo service is optional and does not start by default. To use it, set the backend's `MONGODB_URI` or `MONGO_URL` to `mongodb://mongodb:27017/<your-existing-local-database-name>`, then run:

```powershell
docker compose --profile local-mongo up --build
```

Do not use `docker compose down -v` if the local Mongo volume contains data you want to keep.

## 15. Push all three images

```powershell
.\scripts\docker-push-all.ps1
```

Or:

```powershell
docker push abidtanoli/cricall-backend:v1
docker push abidtanoli/cricall-user-frontend:v1
docker push abidtanoli/cricall-admin-frontend:v1
```

## Common errors

### CORS error

- Use origins only, such as `https://cricall-user.onrender.com`; do not add `/api`.
- The only required variable is `CORS_ORIGINS`. Put both frontend URLs there, separated by a comma.
- `CLIENT_URL` and `ADMIN_URL` are optional aliases — they are not required if `CORS_ORIGINS` is set correctly.
- Remove trailing slashes.
- Redeploy the backend after changing environment variables.

### MongoDB connection error

- Check the Atlas database username and password.
- URL-encode special characters in the password.
- Ensure the URI includes an explicit database name.
- Check Atlas **Network Access**.
- Do not rename the existing database just for the CricAll rebrand.

### Render PORT error

- Do not hardcode Render's port.
- The backend uses `process.env.PORT`.
- Both frontend images run `serve` on Render's runtime `$PORT`.
- Do not override the Docker command unless there is a specific need.

Render requires public web services to bind on `0.0.0.0`; see [Render port binding](https://render.com/docs/web-services#port-binding).

### Vite environment variable is not working

- Vite variables must start with `VITE_`.
- They are fixed during `docker build`, not when the container starts.
- `VITE_API_URL` must end in `/api`.
- `VITE_SOCKET_URL` must be the backend origin without `/api`.
- Rebuild, push, and manually redeploy the latest image reference.

### Docker image name uppercase error

Docker repository names must be lowercase. Use only:

```text
abidtanoli/cricall-backend:v1
abidtanoli/cricall-user-frontend:v1
abidtanoli/cricall-admin-frontend:v1
```

### Free Render service is slow after inactivity

Render Free web services spin down after 15 minutes without inbound HTTP traffic or WebSocket messages. The next request can take about one minute while the service starts. Three continuously active free web services can also consume the workspace's shared 750 free instance hours quickly. Free service files are ephemeral, so keep permanent data in MongoDB Atlas, not inside a container.

See [Render Free instance limitations](https://render.com/docs/free).

### Render still uses the old image

After pushing a replacement image with the same `v1` tag, open the service and select:

```text
Manual Deploy > Deploy latest reference
```

For safer future releases, publish new immutable tags such as `v2`, then update the image URL in Render.
