# TRD: CricAll (Technical Requirements)

Maujooda stack par; **database badalna is file mein nahi**. Zaroorat ke number [01-PRD.md](01-PRD.md) se, bugs [06-BUGS-AND-RISKS.md](06-BUGS-AND-RISKS.md) se.

## 1. Maujooda stack

| Hissa | Kya | Jagah |
|---|---|---|
| User app | React 19, Vite 7, Tailwind 4, Redux, PWA | `Frontend/User` |
| Admin | React 18, Vite 8 | `Frontend/Admin` |
| Shared | Scoring, rang, components | `Frontend/Shared` |
| API | Express 5, Socket.IO 4, zod 4.3.6 | `Backend/src` |
| Deploy | Docker Compose + Nginx (HTTPS), Hostinger VPS, `~/cric-all` | `docker-compose.yml`, `docs/vps-deploy-runbook.md` |

**Ports** (`docker compose ps` se tasdeeq shuda):

| Container | Host port | Container port | Domain |
|---|---|---|---|
| `cricall-backend` | 5050 | 5000 | api.cricall.online |
| `cricall-user-frontend` | 3300 | 3000 | cricall.online |
| `cricall-admin-frontend` | 3301 | 3001 | admin.cricall.online |
| `cricall-mongo` | 127.0.0.1:27017 | 27017 | — |

Host ports VPS ke `.env` (`BACKEND_HOST_PORT` waghera) se aate hain; compose ke default 5000/3000/3001 hain.

Scoring UI **User aur Admin dono** `Frontend/Shared/scoring` se lete hain. Nayi scoring screen ka asar dono par hoga; feature flag lazmi.

## 2. Usool
1. Naya UI flag ke peeche: `Frontend/User/src/config/features.js` → `VITE_SIMPLE_UI` (default `false`). Purana UI 1 tournament tak rahe.
2. Scoring ka hisaab sirf `Backend/src/services/scoring/`. UI naya hisaab na banaye.
3. Match ke baad sab kuch sirf `Backend/src/services/postMatch.js` se.
4. Public jawab sirf `Backend/src/utils/publicProjection.js` se.
5. Update schema mein `.default()` mana (bug B4).
6. Har write par permission: `middleware/orgAccess.js`, `middleware/matchAccess.js`.
7. Naya env → `.env.example` mein bhi.

## 3. Forms mein Urdu madad (R1)
**Faisla:** poori app English, international standard. Urdu sirf forms waghera mein.

| Cheez | Tareeqa |
|---|---|
| i18n library | **Nahi.** Zubaan badalne ka button nahi, poori app RTL nahi |
| Lafz | Ek file `Frontend/Shared/copy/formHelp.js`: `{ key: { en, ur, example } }`, [09-URDU-COPY.md](09-URDU-COPY.md) se |
| Component | `Shared/ui/Field.jsx`: English label, input, neeche `<span lang="ur" dir="rtl">` Urdu madad. Namoona: `Register.jsx:252`, `EmailCodeForm.jsx:110` |
| Kahan | Register/login, club, team, khilari, match banana, tournament ki darkhwast, settings, tasdeeq (confirm), ghalti, net ki halat |
| Kahan nahi | Header, bottom nav, Home, match page, scorecard, commentary, tournament hub, rankings, profiles, scoring pad, share cards, SEO |
| Ghalti | Backend ka `code` → English jumla + Urdu line; code na mile to aam jumla |
| Font | Noto Naskh Arabic self-host, sirf Urdu lafz ke liye (`unicode-range`), taake baqi page bhari na ho |
| Accessibility | Urdu madad `aria-describedby` se juri; `lang="ur"` lazmi |
| Test | Har MUST form field ki key `formHelp.js` mein; public pages mein Urdu na ho (ek test) |
| Doosri zubaan baad mein | Sab lafz ek file mein hain, is liye raasta khula hai |

## 4. Match banana

### 4.1 Club 2 fields (R3)
- `POST /api/organizations` ko sirf `name` chahiye; backend tabdeeli nahi.
- `CreateOrganization.jsx` ka naya halka form; baqi `OrgSettings.jsx`.
- Type `?orgType=` se aaye to dobara na poochein.
- Shehar: `LocationSelect` ki jagah shehar ki search → `locationRefs` khud bhare. **Aaj API shehar se upar ka rasta kaise deti hai, pehle `GET /locations/:id/path` dekhein.**

### 4.2 Overs aur ball type (R10)

| Cheez | Qaida |
|---|---|
| `totalOvers` | int 1–50, `createOrgMatchSchema`, `updateOrgMatchSchema`, tournament fixture |
| `maxBowlerOvers` | optional 1–50; khali ho to `ceil(overs/5)` (`bowlerRules.js` mein maujood) |
| `ballType` | naya `Match.ballType`: `hard`, `tape`, `tennis` |
| `matchType` | jis ke overs fixed format se na milen: naya `Custom` |

Dhyan: `Match.js` ka pre-save `matchType` badalne par `totalOvers` **dobara likh deta hai** (default 20). `Custom` par na likhe. `ScoringEngine.js` ke `FORMATS` mein `Custom` (`maxOvers: null`). Validator ka comment `totalOvers` ko jaan boojh kar rokta hai; naya qaida: **sirf `Custom` ke saath** qabool.

Powerplay: `Custom` par band, default.

### 4.3 11 se kam khilari (R15, F7)
`11` in jagahon par jama hai, sab ek saath badlein:

| Jagah | Aaj |
|---|---|
| `Backend/src/controllers/matchController.js:1420,1426` | Thik 11 |
| `matchController.js:1670` | Squad 11–20 |
| `matchController.js:2143` | Bowling 1–11 |
| `Frontend/Shared/scoring/components/ScoreManagement/MatchSetupWizard.jsx` | 11 ki kai sharten |
| `Backend/src/services/scoring/ScoringEngine.js:607` | All out = format ke `maxWickets` (10) |
| `Backend/src/controllers/inningsController.js:75` | 10 likha hua |

Naya: `match.playersPerSide` (2–11, default 11); all out = `playersPerSide − 1`. "Aakhri batsman akela khele" is marhale mein **nahi**. E2E suite lazmi.

### 4.4 Khilari baad mein, aur bahar ki team (R14)
**Faisla (26 Nov):** bahar ki team = chhupi guest Team.

- `Team.isGuest: true` (naya boolean), `Team.isPublic: false`, owner idaray ke `organizationRef` ke saath. Logo marzi se.
- Is ke khilari bhi guest (`Player.isGuest: true`); "Player 1…n" khud ban sakte hain.
- **Bahar rakhna lazmi:** rankings, team directory (`/teams`), search, club page ki teams, player lists, awards, sitemap, aur har public listing. Match page par sirf naam aur score, link nahi.
- **Owner ko merge ka koi button abhi nahi.** Admin ki taraf se baad mein alag faisla.
- **Khatra:** `hiddenTeamIds()` chhupi team ke matches public list se hata deta hai. Guest ke liye alag qaida chahiye, warna poora match ghayab ho jayega.
- `orgMatchesController.js:35-47` (`MATCH_TEAM_NOT_IN_ORG`): guest Team usi idaray ki hai, is liye check paas hoga.
- Wajah: `Match.teams` mein Team ki ObjectId lazmi hai (`Match.js:335-339`), is liye bina Team ke opponent ke liye poora model badalna parta.

### 4.5 Naya flow
Route `/match/new`; `Frontend/User/src/pages/quickmatch/`. Purane "Setup XI" aur Wizard ki jagah ek hi flow; API wohi: matches, playing-xi, toss, openers. Pichli XI: naya `GET /organizations/:id/teams/:teamId/last-xi` (`manage` permission).

## 5. Scoring

### 5.1 Nayi screen (R5, R6)
- `Frontend/Shared/scoring/simple/SimpleScorer.jsx` + chhote hissay; hisaab `hooks/useMatchScoring.js` se.
- `useMatchScoring` mein `submitBall` state se chalta hai (`selectedRuns`, `selectedExtra`). Naya `recordBall(payload)` nikalein jo seedha payload le; purana `submitBall` usi ko bulaye.
- Ek tap = ek `recordBall`; jawab aane tak **screen foran** badle (optimistic), server jawab se milaye.
- Do tap 250ms mein = ek (ghalti se double tap). Asli hifazat `clientBallId`.
- Undo: `POST /matches/:id/revert-ball` (maujood).
- Reset: aaj `reset-innings` aur `reset-match` scoring permission (`score_match`) par chalte hain (`matchRoutes.js:156-157`). Naya: `create_match`. Purane scorer tests dekhein.

### 5.2 Ek ball ek dafa (R8)

| Hissa | Qaida |
|---|---|
| Client | `clientBallId = crypto.randomUUID()`, har retry mein wohi |
| Schema | `updateScoreSchema`: `clientBallId: z.string().uuid().optional()` (purane client chalen) |
| Match ball | `ballSchema.clientBallId` |
| Server | Us innings mein wohi id ho → **naya kuch na likhe**, wohi `200` + maujooda score, `duplicate: true` |
| Ek waqt | Do requests ek saath: match par optimistic version check; haarne wali dobara parhe |
| Undo | `clientActionId` isi tarah; warna retry do balls hata dega |
| Rate limit | Score route par 1 second mein 12; queue flush dheere bheje |

Sirf Delivery par unique index kaafi nahi: `Delivery`/`Ball` baad mein, alag aur ghalti chhupa kar save hote hain (B7). Sach `Match.innings[].oversHistory` hai.

### 5.3 Offline (R7)

```
tap → IndexedDB queue (clientBallId, seq, payload, baseVersion)
    → screen (local engine)
    → net ho to 1-1 karke, tarteeb se POST
    → 200 / duplicate → hatao
    → 4xx → RUKO, laal patti "Madad chahiye", queue mehfooz
    → net / 5xx / timeout → 2,4,8…30s baad dobara
```

| Faisla | Wajah |
|---|---|
| Pehle version: **ek match, ek main scorer device** | Play-Cricket bhi yehi karta hai; do device ka tanazo mushkil |
| Device lock: server `scoringSession {deviceId, userId, lastSeen}`; doosra device sirf "Scorer badlein" se | Dohri scoring se bachao |
| Match setup online; scoring ke liye match + squads pehle download | Kam khatra |
| Innings/match khatam bhi queue mein | Warna ground par atak jaye |
| `sw.js` API ko `NetworkOnly` rakhta hai: **waise hi rahe** | Queue app mein, service worker mein nahi |
| Scoring page shell precache | Bina net page khule |
| `navigator.storage.persist()` maangein | Browser queue na mitaye |
| Token khatam ho jaye | Queue mehfooz, login ke baad chale. `api.js` 401 par token hatata hai: **queue na hate** |
| Logout, queue baqi | Roko, samjhao |
| Local hisaab | **Server ka engine hi browser mein chalega** (jaanch T3.2, neeche §5.3.1). Screen ke liye local hisaab, sync par server ka jawab sach |

Library: `idb` (chhoti); Dexie nahi.

#### 5.3.1 Jaanch: engine browser mein? (T3.2, 28 Nov 2026)

**Jawab: haan, bina Mongoose aur bina tabdeeli ke.** "Sirf runs/wickets/overs ka chhota hisaab" wala fallback nahi chahiye.

Saboot:
- `ScoringEngine.js` sirf `ballAccounting.js` aur `utils/resultHelpers.js` import karta hai. `controllerAdapter.js` in ke ilawa `bowlerRules.js` aur `utils/cricketHelpers.js`. Dono utils kuch import nahi karte. Kahin bhi Mongoose, Node module, `process`, `Buffer` ya `require` nahi.
- esbuild `--platform=browser` ne adapter samet poora engine bina error bundle kiya: 32.9 KB minified, ~10 KB gzip.
- Wohi bundle Node globals ke baghair V8 sandbox (`vm`) mein chalaya: 1, 4, wide, 6, bowled → 12/1, 4 legal balls, extras mein 1 wide. Wicket undo → 12/0, 3 balls. Server jaisa hisaab.
- Adapter plain object leta hai: `JSON.parse(JSON.stringify(...))`, `toObject()` sirf ho to. API ka match JSON seedha chal jata hai. IDs `String(a) === String(b)` se milte hain.

T3.5 ke liye dhyan:
1. **Ek hi copy.** Engine `Frontend/Shared/scoring/` mein le jayein, ya Vite alias se `Backend/src/services/scoring` import karein (`fs.allow: ['..']` pehle se hai). Server aur client ka hisaab kabhi alag na ho.
2. Engine `this.match` ko badalta hai (48 jagah): client har ball se pehle clone kare, adapter ki tarah.
3. Bowler ke qaide (lagatar overs, quota, replaced bowler) adapter mein hain aur plain data par chalte hain: client screen par bata sakta hai, aakhri faisla server ka.
4. Sync ka jawab (200 / `duplicate: true`, T1.2) hi sach: local state us se badal dein.
5. Pehle T3.1 (`recordBall` alag): phir local engine ko jodna ek jagah ka kaam.

Browser pane mein page khol kar nahi chalaya (wahan `file://` nahi khulta). Asal phone par T3.5 mein dekhna baqi.

### 5.4 Scorer bulana (R18)
QR/link = maujooda invitation (`score_handler`) + us match par khud assign. Bina account token wala link **nahi** (audit ka faisla).

## 6. Points aur NRR (R9)
`Backend/src/services/tournamentService.js` → `recomputeTournamentPoints`:

1. Innings ko `innings.team` se pehchanein, `teams[0]` se nahi. Super over innings shamil nahi.
2. NRR = (apne runs ÷ apne overs) − (khaye runs ÷ phenke overs), tamam matches ka jama.
3. Overs = legal balls ÷ 6. `balls` na ho (manual) to `12.4` = 12 over 4 ball, **12.4 decimal nahi**.
4. All out (ya `playersPerSide − 1`) → poore quota overs.
5. Match ke kam kiye overs (barish) → naya quota, target par note. DLS is marhale mein nahi.
6. `abandoned` ya `no result` → dono ko `pointsConfig.noResult`, `matchesPlayed` +1, NRR par asar nahi. "Postponed" par kuch nahi.
7. Super over se tie tooti → jeetne wale ke points; NRR asal innings se.
8. Barabar points ki tarteeb: points → jeet → NRR → head-to-head. **FAISLA ke baad**; aaj ki tarteeb pehle dekhein.
9. `rankingService.js` ka NRR `innings.team` se hai (theek) magar all-out quota nahi; **ek hi helper** `services/netRunRate.js` dono istemal karein.
10. Purane tournament ka dry-run pehle: `npm run stats:recompute` (default dry-run).

`pointsConfig` model mein hai, owner UI mein nahi: form mein "Jeet / Barabar / Barish" 3 hindse.

## 7. Sharing (R12)
- `GET /share/match/:id` aur `/share/tournament/:id`: `shareController.js` ke `shareTeam` jaisa.
- Title: `Lions 142/6 (20) v Tigers 98/10`; live mein "LIVE".
- Tasveer: pehle `social-share.png`; baad mein bani hui (sharp SVG → PNG, cache).
- WhatsApp: `https://wa.me/?text=` + share link.
- Chhupi team/idara → aam card. `PUBLIC_FRONTEND_URL` aur `PUBLIC_BACKEND_URL` set hon (`PUBLIC_BACKEND_URL` na ho to default `127.0.0.1` hai, tasveer toot jayegi).
- Sitemap: `GET /sitemap.xml` backend se, sirf public records; nginx se jodna deploy par.

## 8. Login (R16)
Aaj: email code ya Google; phone code **band** (`Backend/.env.example`). `utils/smsSender.js` aur phone OTP ka code maujood hai. Kaam: provider chunna (F3), `SMS_DRIVER`, `/auth/verify-phone` kholna, rate limit, kharche ki had. Tab tak Google button sab se upar.

## 9. Bachon ki privacy (R22)
Alag chhota design pehle. Kam se kam: `Player.isMinor` (umar ya age group U-10…U-17 se), public par sirf naam/team/score; photo, phone, social, pata, tareekh-e-paidaish nahi; guardian ijazat ka record; minor par ads aur share card nahi. Har jagah `publicProjection.js` se, taake `/players`, search, share, tournament stats sab cover hon.

## 10. Ghair-functional

| Cheez | Had |
|---|---|
| Scoring tap se screen badalna | ≤ 100 ms (local) |
| Ball server par | ≤ 1 s achhe net par; 3G par queue |
| Pehla load scoring page | ≤ 200 KB gzip JS *(aaj ka naap pehle lein)* |
| Phone | Android 9+, 2 GB RAM, Chrome pichle 2 saal |
| Offline | 1 poora match (~300 balls) |
| Socket | Join limit (0.3), live parhna bina login |
| Ghalti | Sentry ya log; scorer ko saaf message |

## 11. Security
- Update schemas (B4), org leak (B5), uploads magic-byte (maujood), rate limits.
- Credentials rotation (`docs/pre-launch-rotation-checklist.md`) malik kare.
- Scoring socket rooms par login: alag kaam, live dekhna public rahe.
- Audit log: reset, scorer badalna, points setting.

## 12. Kaam na badle
Scoring rules ka hisaab, roles ke naam (`score_handler`; UI par "Scorer"), public URLs, tournament hub routes, OBS overlay ka URL.
