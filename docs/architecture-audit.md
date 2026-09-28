# CricAll Architecture Audit — Phase 0

Date: 2026-09-28
Scope: static inspection of `Backend/`, `Frontend/User/`, `Frontend/Admin/` plus test/lint/build runs.
Method: claims marked **CONFIRMED / STALE / WRONG** with file evidence. No production system was touched (no VPS, no production MongoDB — verification ran against a local in-memory MongoDB).

---

## 1. Baseline (measured before any change)

| Surface | Command | Result |
|---|---|---|
| Backend tests | `npm test` | 52 tests: 39 pass, 0 fail, 13 skipped (skips later explained in §4) |
| User frontend tests | `npm test` | 12 pass |
| User frontend lint | `npm run lint` | 76 errors, 13 warnings (pre-existing) |
| User frontend build | `npm run build` | OK |
| Admin frontend tests | `npm test` | 10 pass |
| Admin frontend lint | `npm run lint` | 0 errors, 6 warnings |
| Admin frontend build | `npm run build` | OK |

Environment: Node v24.18.0, zod 4.3.6, mongoose 9, express 5, ESM, `node --test`. No local MongoDB service and no running Docker daemon; `mongodb-memory-server` (dev-only) was used as the test database.

---

## 2. Claim verification

### CONFIRMED

| # | Claim | Evidence |
|---|---|---|
| C1 | Signup creates an account but no organization. | `authController.registerUser` inserts only a `User` document; no `TeamOrganization` is created anywhere on the register/google-register path. |
| C2 | Handlers receive a role the admin guard rejects. | `authMiddleware.js:67` — `requireAdmin` allows only `role === "admin" \|\| role === "superadmin"`. Users registered as handlers are never given `role: "admin"`, so every org-admin API rejects them. |
| C3 | `accountType` is only consumed by handler-scoped guards. | `handlerController.js:12` (`req.user.accountType`); no other guard branches on `accountType`. Platform authority is decided solely by `role`. |
| C4 | There is no user → organization link. | `TeamOrganization.js` schema fields: `name, category, shortName, logoUrl, description, website, parent, isActive` — no owner/admin/user field. |
| C5 | `managedBy` is set only by admin approval of a handler request. | `handlerController.js:128` and `:144` are the only writers of `managedBy` (on `Team`/`Event`), executed inside the `HandlerRequest` approval path. |
| C6 | Real operations live entirely in the Admin SPA; the User site is a portal around them. | All organization/team/match/tournament/blog/event operations are routed through the Admin frontend against `/api/admin/*` and the guarded org routes; the User site exposes profile, teams browse, scoring UI and auth. |
| C7 | Password-reset expiry check treated `undefined` as "not expired". | Pre-fix `isResetTokenExpired(undefined)` returned false (a missing expiry was accepted). Now returns `true`; `adminController` shares this helper and remains compatible (tests green). |
| C8 | The axios response interceptor swallowed `error.response`. | Pre-fix `Frontend/User/src/services/api.js` dropped `error.response` when rethrowing, so callers could not read status codes. Fixed in Phase 1: `error.response` and `error.code` are preserved. |

### STALE (true before Phase 1, changed by Phase 1)

| # | Claim | Current state |
|---|---|---|
| S1 | Users have no email-verification state. | `User` now has `emailVerified`, `emailVerifiedAt`, `emailVerificationToken(+Expires)`, `verificationSentAt`; `POST /api/auth/verify-email` and `/resend-verification` exist; `requireVerifiedEmail` guards the org/team/match/blog/upload/player/event/tournament admin routes. |
| S2 | Reset tokens survive use (no rotation). | Reset now bumps `tokenVersion`, invalidating already-issued JWTs on password change. |
| S3 | Frontend had no verify-email flow. | `/verify-email/:token` route, `VerifyEmail.jsx`, register post-signup panel, Header verification banner with resend, dev-time notice when `VITE_GOOGLE_CLIENT_ID` is unset. |

### WRONG

| # | Claim | Correction |
|---|---|---|
| W1 | "Invalid credentials returns 401." | The endpoint returns **400** (`INVALID_CREDENTIALS`) — deliberately kept to avoid breaking `test/auth-api.test.js`, which asserts 400. |
| W2 | "Google login creates a `scorer` with full access." | Pre-Phase-1 Google sign-up created `role: "viewer" / accountType: "viewer"` (`googleAuthController.js:104-105`); `role: "scorer"` is only relevant to `admin google login` (accepted risk, see §5). |
| W3 | "The HTTP integration tests exercise the API." | They could never run — two independent bugs (see §4). Their "passing" baseline was effectively 13 vacuous skips. |

---

## 3. Root cause of the handler / organization-admin dead end

1. **Signup never creates an organization.** A handler or organization admin registers and lands in a dashboard with no org, no teams and no data.
2. **Platform authority is `role`, but signup never grants it.** `requireAdmin` demands `role: "admin" | "superadmin"`; self-registered handlers are not admins, so every organization/team/match API returns 403.
3. **`accountType` (the field that *should* express "this person runs an org") is decorative** — read only by `handlerController`, never by authorization guards.
4. **The only sanctioned way to gain `managedBy` is an admin-approved `HandlerRequest`** — i.e. the platform Admin app is load-bearing for what the product promises users can do themselves.
5. **Consequence:** the promised flow "sign up → run your teams/tournaments" is broken end-to-end unless a platform admin manually approves requests from the Admin SPA. This is the primary inversion target: organizations must self-manage; the Admin app becomes supervisory (Phase 2+).

---

## 4. Test-harness findings (why 13 tests were permanently skipped)

Both bugs are now fixed; the suite runs **90 tests / 90 pass / 0 fail / 0 skipped** with a live server.

1. **`skip` was passed a function** (`{ skip: () => !serverAvailable }`) in `test/auth-api.test.js`. node:test treats a non-boolean `skip` as a truthy flag and never calls it, so the tests skipped unconditionally — on Node v24 the function form is not supported (verified empirically). Fixed: the health probe now runs at module load (top-level await) and `skip` receives a plain boolean.
2. **The health probe URL dropped the `/api` prefix.** `new URL("/health", "http://localhost:5000/api")` resolves to `http://localhost:5000/health`, which is a 404 (only `/api/health` exists, `src/index.js:207`). Every request in that file had the same defect. Fixed by resolving paths against a BASE normalized to end in `/`.

---

## 5. Accepted risks / findings deferred to later phases

| Finding | Disposition |
|---|---|
| `googleAdminLogin` accepts `role: "scorer"` as an admin-path role. | Accepted for Phase 1 (login still requires the account to already hold that role); revisit in Phase 9 (scoring) / Phase 11 (security). |
| `POST /players` create route lacks the admin guard applied to other player routes. | Noted, not modified — Phase 5 (players). |
| Auth rate limits are per-IP, fixed-window constants in `routes/authRoutes.js` (not per-account). | Documented; per-account throttling belongs to Phase 11. |
| Login invalid-credentials stays 400, not 401. | Intentional compatibility decision (W1). |
| `tokenVersion` defaults to 0 for existing JWTs so nothing is logged out on deploy. | Intentional. |
| Existing users grandfathered as `emailVerified: true` by migration (dry-run default). | Owner action: provide SMTP creds or keep `MAIL_DRIVER=console`. |

---

## 6. Constraints honored

- No secrets printed or logged (variable names only in `.env.example`).
- No production DB / VPS contact; verification used `mongodb-memory-server` on `127.0.0.1`.
- Migrations default to dry-run; `--apply` required to write.
- PowerShell-compatible commands; no bash-only npm scripts.
- Test data follows the `OPENCODE_TEST_`-style naming used by the suite; no new project dependencies except `nodemailer` (prod) and `mongodb-memory-server` (dev).
