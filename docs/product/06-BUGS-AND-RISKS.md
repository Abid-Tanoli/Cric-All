# Bugs aur khatre

25 Nov 2026 tak. Band hone wale bugs (merge + deploy + live par dekha) [COMPLETED.md](COMPLETED.md) mein chale jate hain.

**Saboot:** `CHALAYA` = code chala kar dekha · `PARHA` = code parh kar · `LIVE` = live site par dekha · `REPORT` = doosre session ki report, dobara check nahi.

## 1. Surkh (pehle theek karein)

| ID | Masla | Saboot | Halat |
|---|---|---|---|
| **B1** | NRR ulta jab `teams[1]` pehle batting kare: jeetne wali ka -3, harne wali ka +3. `tournamentService.js` innings ko team ki jagah tarteeb se jorta hai | CHALAYA; live match mein bhi tarteeb ulti | NAYA |
| **B2** | NRR har innings ko poore overs deta hai: 10 over mein 101 ka chase +0.05, hona chahiye +5.10 | CHALAYA | NAYA |
| **B3** | Abandoned match par points nahi | CHALAYA | NAYA |
| **B4** | Update se data mitna: zod 4 `.partial()` ke bawajood `.default()` lagata hai. Idaray: logo, description, socials, privacy khali. **Master par hai, deploy ho chuka** | CHALAYA | Idara: TAYYAR, `fix/org-update-data-loss` pushed. **Team/player: NAYA (T0.2)** |
| **B5** | Idaray ki private fields bina login: `/organizations/roots`, `/tree`, `/:id/children`, `/:id/chain` | LIVE (`roots` ki field names; abhi phone/email khali) | TAYYAR, `fix/org-update-data-loss` pushed |
| **B6** | Ball dohri lag sakti hai (retry); offline nahi | PARHA | NAYA |

**Jab tak B4 deploy na ho, live par na karein:** club page ka public toggle, team edit, Admin ka activate/deactivate. Deploy ke baad (25 Nov 14:33 UTC tak) kisi idaray ka record nahi badla tha.

## 2. Zard

| ID | Masla | Saboot | Halat |
|---|---|---|---|
| B7 | Ball 3 jagah likhi jati hai; `Delivery`/`Ball` fail ho to sirf log, scoring chalti rahe | PARHA | NAYA |
| B8 | Home par live score ghalat team ke saamne (30/0 KHA ka, BAL par dikha) | LIVE | NAYA (0.2 ne `/live` theek kiya) |
| B9 | `/live` purani tareekh ka live match nahi dikhata | LIVE, REPORT | TAYYAR `fix/public-site-leftover-copy` |
| B10 | Aaj khatam hua match `/live` ke kisi tab mein nahi; Results sirf kal ke | REPORT | NAYA |
| B11 | ~~Players list mein 126 mein se 26 nahi~~ **Bug nahi:** API page 1 par 100, page 2 par 26 deti hai (`totalPages=2`). Frontend ka page 2 dekhna baqi. Role filter ka masla alag se dekhna | CHALAYA (API) | Jaanch baqi |
| B12 | Koi bhi anonymous socket sab ko `match:updateList` bhej sakta tha; khali JOIN se crash | PARHA / REPORT | TAYYAR `fix/socket-broadcast-and-dead-dls` |
| B13 | Ghalat DLS code (istemal nahi hota) | PARHA | TAYYAR (usi branch) |
| B14 | Team page par club link kabhi nahi banta; private club ke dead links; club page par live match nahi; server error "Not Found" | PARHA, tests | TAYYAR, `fix/org-update-data-loss` pushed |
| B15 | Player merge `officialAwards`, `customAwards`, `replacedBowlerBlock` nahi badalta | REPORT | NAYA |
| B16 | Admin ka player Delete references check nahi karta; match delete balls peeche chhorta hai | REPORT | NAYA |
| B17 | `Tape Ball` hamesha 8 overs; owner custom overs nahi de sakta | PARHA | NAYA |
| B18 | Setup do jagah; Wizard "Step 2 of 4" se khulta hai | CHALAYA | NAYA |
| B19 | Reset match/innings scorer ke menu mein "End innings" ke saath | CHALAYA | NAYA |
| B20 | Phone se verification band; email lazmi | PARHA | FAISLA F3 |
| B21 | Urdu naam ka slug `organization`, `organization-2` | PARHA (test mein yehi umeed) | NAYA |
| B22 | `tournamentAwards` ka ek audit test poore run mein 1 dafa fail, akela 2 dafa pass | CHALAYA | NAYA (waqti lagta hai, wajah nahi dekhi) |
| B23 | Manual form innings team ki tarteeb se rakhta hai; SF2 live par ulti dikhti hai | REPORT | NAYA |
| B24 | Naranji par safed text 2.84:1; 1,089 jagah text ≤ 11px | CHALAYA | NAYA |
| B25 | Blog: `blogsController.js:15` `category` se filter karta hai magar `Blog.js` mein `category` field nahi; `Blog.isLive` sirf badge hai, publish ka asal gate nahi | PARHA | NAYA (T5.8 se pehle) |

## 3. Data jo malik ne dekhna hai
0.4 session ki 24 rows ki list (logon ke naam hain, is liye yahan nahi). Khulasa: 4 placeholder khilari (**delete nahi, merge**), 1 match 20 Nov se LIVE, 1 test player, 1 adhoora idara, kuch spelling. Har row par alag ijazat, pehle backup.

## 4. Khatre

| # | Khatra | Bachao |
|---|---|---|
| K1 | 4 credentials rotation list mein | Malik rotate kare, `docs/pre-launch-rotation-checklist.md` |
| K2 | Off-site backup ka code merge (#74) magar setup nahi: rclone remote `cricalldrive` nahi bana, `OFFSITE_*` set nahi, pehla off-site backup aur restore test nahi. Repo ki systemd units `/opt/cricall/Backend` kehti hain (`Backend/backup/*.service:10-11`), VPS par `/home/abid/cric-all/Backend` chahiye | Tri-series se pehle poora + ek dafa restore test; passphrase sirf password manager mein |
| K3 | Pehla asli live-scored muqabla hi tri-series | Practice series ([07](07-TRI-SERIES.md)) |
| K4 | Do agents ek folder mein (pehle takra chuke hain) | Ek task = ek worktree |
| K5 | 12 files uncommitted | Jald branch par commit |
| K6 | Bachon ka data bina qaide | R22 se pehle schools nahi |
| K7 | Nayi scoring screen User **aur** Admin par | Flag + purani screen |
| K8 | Email spam/SPF/DKIM test baqi (chat ke mutabiq) | Asli inbox mein test |
| K9 | Ek hi VPS | Backup, aur match ke din deploy band |

## 5. Pending branches

| Branch | Kya | Tests |
|---|---|---|
| `fix/org-update-data-loss` (pushed `6ca0ad5`) | B4 (idara), B5, B14 | Branch par: backend 6 suites 99/99, User 4 files 26/26, build theek. Pehle poore run mein: User 318, Admin 166 pass; backend ke 3 server wale suites server par 87/87; B22 alag |
| `fix/public-site-leftover-copy` | 0.2 | REPORT: 341 pass |
| `fix/socket-broadcast-and-dead-dls` | 0.3 | REPORT: 1080/1080 pass |
