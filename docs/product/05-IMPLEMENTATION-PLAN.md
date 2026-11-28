# Implementation plan

Size (andaza, ek developer + AI agent): **S** 1–2 din · **M** 3–5 din · **L** 1–2 hafte.
Har task = apni branch + apna worktree + tests + PR. Push/merge/deploy malik ki ijazat se.

**Mukammal kaam yahan nahi rehte:** merge + deploy + "Mukammal jab" live par dekhne ke baad task ki row [COMPLETED.md](COMPLETED.md) mein chali jati hai. Kisi `Depend` wale ID ki row yahan na mile to wahan dekhein. Har tabdeeli ki line [CHANGELOG.md](../../CHANGELOG.md) mein.

## 1. Ek nazar

| Marhala | Nateeja | Kul andaza |
|---|---|---|
| **M0 Bharosa** | Data mehfooz, pending kaam live | ~1 hafta |
| **M1 Sahi hisaab** | Tri-series ka table aur scoring darust | ~2 hafte |
| **M2 Asaan bunyad** | International standard design, navigation, forms mein Urdu madad | ~2 hafte |
| **M3 Asaan scoring** | Ek tap, offline | ~4 hafte |
| **M4 Asaan match aur club** | 4 qadam, 2 fields | ~3 hafte |
| **M5 Phailao** | WhatsApp, login, madad, follow | ~5 hafte |
| **M6 Har idara** | School privacy, idaron ki zaroorat | ~5 hafte |
| **M7 Kamai** | Sponsors, Pro | baad mein |

Tri-series ki tareekh par tarteeb: [07-TRI-SERIES.md](07-TRI-SERIES.md) §3.

## 2. Tasks

### M0 Bharosa
| ID | Kaam | Branch | Files | Mukammal jab | Size | Depend |
|---|---|---|---|---|---|---|
| T0.1 | Idara update se data na mite; leak band; club page fixes (B4, B5, B14) | `fix/org-update-data-loss` | **MERGED** PR #86 (`5c12bc2`, 26 Nov). Live API par chalta dikha (27 Nov: `/organizations/roots` sirf public fields deta hai); deploy ki tareekh nahi likhi gayi | Deploy ke baad 08 §5 ki jaanch; phir COMPLETED.md | S | — |
| T0.2 | Team/player update se data na mite (B4). **T0.1 ke saath ek hi deploy**; files alag | `fix/update-defaults` | **MERGED** PR #87 (`e630fac`, 26 Nov). Deploy baqi | `safeParse({})` = `{}`; chhupi team chhupi rahe; Admin stats update se location na mite | S | — |
| T0.3 | Purani copy, `/live` (B9) | `fix/public-site-leftover-copy` | **MERGED** PR #88 (`8577d58`, 26 Nov). Deploy baqi | Live par `/live` aur Home ki copy dekhein | S | — |
| T0.4 | Socket, DLS (B12, B13) | `fix/socket-broadcast-and-dead-dls` | **MERGED** PR #89 (`8385e5e`, 26 Nov). Deploy baqi | Live score bina login chale | S | — |
| T0.5 | Home aur `/live` par score sahi team (B8, B10) | `fix/home-score-attribution` | **MERGED** PR #92 (`46ff229`, 27 Nov): B8. **B10 TAYYAR** (28 Nov) PR #99 (`18e618f`): Results mein aaj aur kal ke match. Deploy baqi | Innings `innings.team` se juri | S | T0.3 |
| T0.6 | Data safai, 24 rows | — | **Faisle ho gaye** (27 Nov): 24 rows manzoor; list ki 6 test/atki records wali rows hatani hain. Backup ka tareeqa PR #93 (`f7e7001`) mein theek hua. VPS par run baqi | Har row par faisla | S | T0.9 |
| T0.7 | Player merge ke baqi fields (B15), delete guards (B16) | `fix/merge-official-awards-refs` | **MERGED** PR #94 (`415b0cd`, 27 Nov): merge ke fields (B15). **B16 TAYYAR** (28 Nov) PR #100 (`258f20d`): record wala player 409 + merge ka mashwara; match ke saath us ki balls bhi | Test: award wala player sahi mile | M | — |
| T0.8 | Players role filter/pagination (B11) | `fix/players-list` | **TAYYAR** (28 Nov) PR #101 (`5219572`): sab pages, `playingRole` filter | 126/126, filter kaam kare | S | T0.3 |
| T0.9 | **Malik:** credentials, off-site backup + restore test, SMTP, `PUBLIC_*_URL` | — | VPS | Restore chala kar dekha | — | — |

### M1 Sahi hisaab (tri-series)
| ID | Kaam | Branch | Files | Mukammal jab | Size | Depend |
|---|---|---|---|---|---|---|
| T1.1 | NRR, abandoned points, ek helper (B1–B3) | `fix/nrr-points` | **MERGED** PR #90 (`fb2526e`, 26 Nov). **ICC all-out qaida: TAY, rakhna hai** (Abid, 26 Nov). Deploy baqi | Deploy ke baad `stats:recompute` dry-run diff Abid ko, phir backup + `--apply` | M | — |
| T1.2 | `clientBallId`, dohri ball band (B6) | `feat/idempotent-balls` | **PR #97** (28 Nov, CI 3/3 hara). e2e 81/82: naye 4 check pass; 1 purana check `master` par bhi fail (§7) | 08 §2; e2e pass | M | — |
| T1.3 | Custom overs, ball type, quota (B17) | `feat/custom-overs` | **TAYYAR** (28 Nov) PR #103 (`8800e0f`). TRD §4.2; e2e mein 7-over Custom match | 7-over match shuru se akhir tak | M | — |
| T1.4 | Points setting owner UI mein | `feat/points-config-ui` | **TAYYAR** (28 Nov) PR #102 (`d8b7450`) | 3 hindse save, table badle | S | T1.1 |
| T1.5 | Double round + final fixtures | `feat/double-round` | **TAYYAR** (28 Nov) PR #105 (`7e1746f`) | 3 teams → 6 + final | S | — |
| T1.6 | Reset ko scorer se chhupana (B19) | `fix/scorer-danger-actions` | **PR #98** (28 Nov, CI 3/3 hara) | Scorer: nahi dikhta, API 403 | S | — |
| T1.7 | Practice series | — | 07 §4 | Kaghaz = app | M | T1.1–T1.3 |
| T1.8 | Socket: scoring rooms login ke saath; live dekhna anonymous hi rahe | `feat/socket-scoring-auth` | `Backend/src/socket/socket.js`, scoring ka socket join (`Frontend/Shared/scoring`). **Faisla baqi** (28 Nov): aaj koi scoring room nahi; kaun se events sirf scorer ko jayein | Bina login live score aata hai; bina token scoring room join rad; scorer ka room chalta hai | M | T0.4 |

### M2 Asaan bunyad
| ID | Kaam | Branch | Files | Mukammal jab | Size | Depend |
|---|---|---|---|---|---|---|
| T2.1 | Forms mein Urdu madad (R1) | `feat/form-urdu-help` | TRD §3, 09; `Shared/ui/Field.jsx`, `Shared/copy/formHelp.js` | Har MUST form field par Urdu line; public pages aur scoring mein Urdu nahi | S | T2.2 |
| T2.2 | Rang, text, button ke qaide (B24) | `feat/readable-ui` | **PR #96** (28 Nov, CI 3/3 hara). `Shared/styles/theme.css` + naye `Shared/ui/{BigButton,Sheet,Card,Field}.jsx` | Naye components par axe saaf; screenshots | M | — |
| T2.3 | Bottom navigation, Home, flag `VITE_SIMPLE_UI` (R2) | `feat/simple-nav` | `App.jsx`, `Header.jsx`, `Home.jsx`, `config/features.js` | 03 §5; flag band = purana | M | T2.1, T2.2 |
| T2.4 | Owner 9 tabs → 3 | `feat/simple-dashboard` | `MyOrganization.jsx` | Har purani cheez "More" mein milti hai; permissions wohi | M | T2.3 |
| T2.5 | Lists halki (Teams, Series, Players) | `feat/simple-lists` | pages | 03 §6.9 | S | T2.2 |
| T2.6 | Match page: dono score upar, 3 tabs | `feat/simple-match-page` | `Match.jsx` | 03 §6.8 | M | T2.2 |

### M3 Asaan scoring
| ID | Kaam | Branch | Files | Mukammal jab | Size | Depend |
|---|---|---|---|---|---|---|
| T3.1 | `recordBall(payload)` alag karna (refactor, rawaiya wohi) | `refactor/record-ball` | `useMatchScoring.js` | Purane tests + e2e bina tabdeeli pass | M | T1.2 |
| T3.2 | Engine browser mein chal sakta hai? (jaanch, code merge nahi) | — | **JAWAB** (28 Nov) TRD §5.3.1: haan, bina tabdeeli (PR #104, `2ed643d`) | 1 safhe ka jawab | S | — |
| T3.3 | SimpleScorer: pad, Undo, extras (R5, R6) | `feat/simple-scorer` | `Shared/scoring/simple/*` | 360×640 bina scroll; aam ball 1 tap; 08 §3 kaam 4–5 | L | T3.1, T2.2 |
| T3.4 | OUT sheet, agla bowler, strike | `feat/simple-wicket` | usi folder | OUT 3 taps; tamam dismissal tests | M | T3.3 |
| T3.5 | Offline queue + sync (R7) | `feat/offline-scoring` | `Shared/scoring/offline/*`, server session | 08 §2 Offline | L | T1.2, T3.2, T3.3 |
| T3.6 | Mashq mode, awaaz, vibration, wake lock | `feat/scorer-practice` | simple/ | Record mein kuch nahi jata | M | T3.3 |

### M4 Asaan match aur club
| ID | Kaam | Branch | Files | Mukammal jab | Size | Depend |
|---|---|---|---|---|---|---|
| T4.1 | Club 2 fields (R3) | `feat/simple-club` | `CreateOrganization.jsx` | 1 screen, Urdu madad ke saath | S | T2.1 |
| T4.2 | Match 4 qadam, pichli XI (R4) | `feat/quick-match` | TRD §4.5 | 2 minute mein (08 §3 kaam 3) | L | T1.3, T2.2 |
| T4.3 | 2–11 khilari (R15) | `feat/flexible-side` | TRD §4.3 | 6 par 5 wicket = all out; e2e | M | F7 |
| T4.4 | Bahar ki team: chhupi guest Team + khilari (R14) | `feat/guest-side` | TRD §4.4 | `isGuest: true`, `isPublic: false`; rankings, team directory, search, club teams aur har public list se bahar; match page par naam dikhe | L | T4.2 |
| T4.5 | Purane Setup XI/Wizard hatana | `chore/remove-old-setup` | — | 1 tournament naye par chal chuka | M | T4.2, T3.3 |

### M5 Phailao
| ID | Kaam | Branch | Mukammal jab | Size | Depend |
|---|---|---|---|---|---|
| T5.1 | Match/tournament share card + WhatsApp (R12) | `feat/share-match` | Crawler test | M | T0.9 |
| T5.2 | Sitemap, meta, JSON-LD | `feat/seo-public` | Sirf public records | M | — |
| T5.3 | Madad `?`, audio, WhatsApp help (R13, R17) | `feat/help` | Har MUST screen par | M | F4 |
| T5.4 | Scorer QR/link (R18) | `feat/scorer-invite` | 2 tap mein scorer lage | M | — |
| T5.5 | Phone login (R16) | `feat/phone-login` | Code aaye, had lage | M | F3 |
| T5.6 | Email notifications: **sirf email, push nahi** (R20) | `feat/email-notify` | Match shuru/khatam, scorer chuna gaya; 1 waqia = 1 email; unsubscribe | M | T0.9 (email test) |
| T5.7 | Badges + player card (R19) | `feat/player-card` | Share card | M | T5.1 |
| T5.8 | Gallery/khabrein (R23) | `feat/org-media` | `publish_content` se | L | — |

### M6 Har idara
| ID | Kaam | Mukammal jab | Size | Depend |
|---|---|---|---|---|
| T6.1 | Bachon ki privacy (R22): pehle design, phir code | 08 §2 Privacy | L | Malik ki manzoori |
| T6.2 | `orgType` ek sach; academy, league shamil | Har type register → team → match | M | — |
| T6.3 | Event/Incubation/Handler UI se chhupana (F8) | Purane links chalein | M | F8 |
| T6.4 | Departments/branches dashboard | University aur NGO pilot | L | T6.2 |
| T6.5 | Tournament mein team ki darkhwast (R21) | Apply → approve | L | — |

### M7 Kamai (baad mein)
Sponsor org/overlay + report · Pro flags · AdSense sirf public (scoring aur minors par nahi) · payment demand sabit hone par.

## 3. Pehle 10 qadam (tarteeb)
`T0.1 → T0.2 → T0.3 → T0.4 → T0.9 → T1.1 → T1.2 → T1.3 → T1.6 → T1.7`
Saath saath chal sakta hai (files alag): **T2.2** (phir T2.1 us par).
Ek saath **nahi**: T1.2 + T3.1 (dono `useMatchScoring.js`) · T1.1 + T1.5 (dono `tournamentService.js`) · T0.3 + T0.5 + T2.3 (`Home.jsx`) · T1.2 + T1.3 + T4.3 (`Match.js`).

## 4. Har task ka taiyar prompt
Agent ko yeh den, `<...>` bhar kar:

```text
TASK <ID> - <kaam>. Read docs/product/05-IMPLEMENTATION-PLAN.md row <ID>, and only
the sections of 02-TRD.md / 03-UI-UX.md / 06-BUGS-AND-RISKS.md it points to.

Run `git fetch origin` and create a NEW worktree from origin/master on branch <branch>.
Work only there. Never push to master, never force-push, never merge, never deploy.
Never connect to a live database; use in-memory Mongo or local `cric-all-e2e` only.

STEP 1  Inspect and report briefly: current behaviour, files you will touch, risks.
        If the docs and the code disagree, stop and say so.
STEP 2  Write the failing test first. Update endpoints are tested THROUGH the zod
        validator, not by calling the controller directly.
STEP 3  Smallest safe change. No unrelated refactors.
STEP 4  Run the affected suites, then the full suites in 08-TEST-PLAN.md section 1.
        Paste exact pass/fail totals. Say plainly what you did not run.
UI work: English UI; Urdu helper text only in forms, confirmations and errors (TRD
        section 3). Screenshots at 360x640, 375x812 and 1280 wide; the checklist in
        03-UI-UX.md section 9; everything behind VITE_SIMPLE_UI.
CHANGELOG Add one line for this change under [Unreleased] in CHANGELOG.md, in the right
        group (Added / Changed / Fixed / Security / Removed / Maintenance / Documentation).
        Do NOT move rows to docs/product/COMPLETED.md: that happens only after deploy.
FINISH  Commit on <branch>. Report: changed files, test totals, how to test by hand,
        rollback, deploy notes, what you guessed, what you could not verify.
DONE WHEN: <"Mukammal jab" column>
```

## 5. Merge aur deploy
1. CI teeno hare → malik review → "Create a merge commit".
2. Deploy se pehle backup; match ke din deploy nahi (`docs/vps-deploy-runbook.md`).
3. Data badalne wali script: dry-run → malik dekhe → backup → `--apply`. Points/stats (`stats:recompute`): dry-run **local copy par**, diff Abid ko, phir production par backup ke baad.
4. Deploy ke baad 5 minute: health, login, ek match page, ek club page.
5. Deploy theek chale aur "Mukammal jab" live par dikh jaye: CHANGELOG mein `[Unreleased]` → us din ki tareekh, aur task ki row 05 se [COMPLETED.md](COMPLETED.md) mein (tareeqa wahan likha hai). Ek commit: `docs: complete <ID>`.

## 6. Aaj ki reports kahan gayin

| Report | Ab yahan |
|---|---|
| Scope aur roadmap | 01, aur yeh file |
| Club page review (0.1) | B4, B5, B14 → T0.1, T0.2 |
| 0.2, 0.3, 0.4 sessions | T0.3, T0.4, T0.6; B8–B13, B15, B16, B23 |
| Tri-series jaanch | 07; B1–B3, B17 → M1 |
| claude.ai chat ka plan | M1 (scoring), T0.9 (backup, email, password), T5.8 (media), T4.4 (opponent), T1.8 (socket login) |
| Database / Supabase | **Faisla baqi** (Abid alag se batayega). Is plan mein shamil nahi |
| UI/UX naap | 03, M2–M4 |

## 7. Progress
Merge ke baad halat `TAYYAR → MERGED`; deploy aur jaanch ke baad row COMPLETED.md mein. `LIVE` halat yahan nahi rehti. Aaj (27 Nov): T0.1, T0.2, T0.3, T0.4, T1.1 MERGED · T0.5 MERGED, B10 baqi · T0.7 MERGED, B16 baqi · T0.6 faisle ho gaye, VPS run baqi · T0.1 live API par chalta dikha, baqi ka deploy nahi dekha · baqi NAYA.

28 Nov: PR #96 (T2.2), #97 (T1.2), #98 (T1.6) khule, CI hara, merge baqi · TAYYAR, PR khule: B10 #99, B16 #100, T0.8 #101, T1.4 #102, T1.3 #103, T1.5 #105 · T3.2 ka jawab TRD §5.3.1 (#104) · T1.8 faisla baqi · e2e ka check "scoring alone does not settle the match" PR #45 (`5f62888`) se `master` par fail: target poora hone par engine match khud mukammal karta hai; check badlein ya engine, faisla malik.
