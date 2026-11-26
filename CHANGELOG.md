# Changelog

All notable changes to CricAll are recorded here, newest first.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). CricAll has no version numbers yet. From 26 Nov 2026 each dated section is the day the change was **deployed**; `[Unreleased]` holds merged changes not yet deployed. Sections up to 25 Nov 2026 use the **merge date**, because deploy dates were not recorded.

> **Kaise update karein (Roman Urdu):** har PR apni ek line `[Unreleased]` mein jodta hai. Deploy ke din `[Unreleased]` ki lines us din ki tareekh ke heading mein chali jati hain. Plan ka task mukammal ho to us ki row [docs/product/COMPLETED.md](docs/product/COMPLETED.md) mein jati hai. Poora tareeqa wahin hai.

Groups: **Added** (new), **Changed** (behaviour changed), **Fixed** (bug), **Security**, **Removed**, **Maintenance** (scripts, backups, deploy), **Documentation**.

## [Unreleased]

Nothing merged after `1708a5b` (PR #85) yet. Work in progress is tracked in [docs/product/05-IMPLEMENTATION-PLAN.md](docs/product/05-IMPLEMENTATION-PLAN.md) (T0.1–T0.4).

## 2026-11-25

### Added
- Add owner-scoped compressed organization image uploads ([#82](https://github.com/Abid-Tanoli/Cric-All/pull/82))
- Let club owners assign match scorers and validate toss winners ([#83](https://github.com/Abid-Tanoli/Cric-All/pull/83))
- Enrich the public team page with live/upcoming fixtures and top performers ([#84](https://github.com/Abid-Tanoli/Cric-All/pull/84))
- Public club page at /club/:slug ([#85](https://github.com/Abid-Tanoli/Cric-All/pull/85))

## 2026-11-24

### Added
- Owner can add players to a team from the Squad tab ([#79](https://github.com/Abid-Tanoli/Cric-All/pull/79))

### Fixed
- Store and show the squad shirt number, keep role/playingRole in sync ([#80](https://github.com/Abid-Tanoli/Cric-All/pull/80))
- Recompute post-match tables on every completion path ([#81](https://github.com/Abid-Tanoli/Cric-All/pull/81))

### Maintenance
- Add guarded user purge script and runbook ([#77](https://github.com/Abid-Tanoli/Cric-All/pull/77))

### Documentation
- Add club owner journey audit ([#78](https://github.com/Abid-Tanoli/Cric-All/pull/78))

## 2026-11-23

### Added
- Add email-only 6-digit verification on signup ([#76](https://github.com/Abid-Tanoli/Cric-All/pull/76))

### Fixed
- Fix location fields rejected on org, player and register flows; show per-field errors ([#75](https://github.com/Abid-Tanoli/Cric-All/pull/75))

### Maintenance
- Add a guarded test-data cleanup command ([#73](https://github.com/Abid-Tanoli/Cric-All/pull/73))
- Add encrypted off-site copy of database and uploads backups ([#74](https://github.com/Abid-Tanoli/Cric-All/pull/74))

## 2026-11-22

### Added
- Add organization types, type details and registered-club verification ([#71](https://github.com/Abid-Tanoli/Cric-All/pull/71))
- Add automatic first team, team roles, registration branching and orgType filters ([#72](https://github.com/Abid-Tanoli/Cric-All/pull/72))

## 2026-11-21

### Added
- Installable Admin app (PWA) ([#68](https://github.com/Abid-Tanoli/Cric-All/pull/68))
- One-folder branding with automatic multi-app asset generation ([#69](https://github.com/Abid-Tanoli/Cric-All/pull/69))
- Add curated location dropdowns, filters and Admin locations ([#70](https://github.com/Abid-Tanoli/Cric-All/pull/70))

## 2026-11-20

### Added
- Local sponsor management across backend, User and Admin apps ([#62](https://github.com/Abid-Tanoli/Cric-All/pull/62))
- Group next bowler by overs bowled and add plain commentary when AI is off ([#63](https://github.com/Abid-Tanoli/Cric-All/pull/63))
- Official tournament awards with citations and publish gating (`6a092fd`)
- End-of-over card, roomy rows and new bowler/batter events ([#65](https://github.com/Abid-Tanoli/Cric-All/pull/65))
- Add OBS live scoreboard overlay route ([#66](https://github.com/Abid-Tanoli/Cric-All/pull/66))
- Tool to find and bulk-fix players with missing or invalid roles ([#67](https://github.com/Abid-Tanoli/Cric-All/pull/67))

## 2026-11-19

### Added
- Enable real SMTP delivery for backend notifications ([#58](https://github.com/Abid-Tanoli/Cric-All/pull/58))
- Admin one-click team/org deletion approval and separate Super Sub setup ([#59](https://github.com/Abid-Tanoli/Cric-All/pull/59))
- Match-level AI commentary setting shared by all scorers ([#60](https://github.com/Abid-Tanoli/Cric-All/pull/60))
- Series management screen for organization owners ([#61](https://github.com/Abid-Tanoli/Cric-All/pull/61))

## 2026-11-17

### Added
- Innings break screen before the second-innings openers ([#54](https://github.com/Abid-Tanoli/Cric-All/pull/54))
- Installable app (PWA) with Install button, update toast and offline page ([#55](https://github.com/Abid-Tanoli/Cric-All/pull/55))
- AdSense integration (off by default), privacy page, ads.txt ([#56](https://github.com/Abid-Tanoli/Cric-All/pull/56))
- About, Contact, Terms, SEO metadata, sitemap and crawler fallback for AdSense review ([#57](https://github.com/Abid-Tanoli/Cric-All/pull/57))

## 2026-11-16

### Added
- App-style scoring screen, next-bowler modal, AI-off simple mode ([#53](https://github.com/Abid-Tanoli/Cric-All/pull/53))

## 2026-11-14

### Fixed
- Single-match events create their match, Live Scores lists all results ([#51](https://github.com/Abid-Tanoli/Cric-All/pull/51))
- Atomic, idempotent organization handover with a single owner ([#52](https://github.com/Abid-Tanoli/Cric-All/pull/52))

## 2026-11-13

### Added
- Organization owners create and run tournaments and series ([#48](https://github.com/Abid-Tanoli/Cric-All/pull/48))
- Organization owners score matches from the User app ([#49](https://github.com/Abid-Tanoli/Cric-All/pull/49))
- Issue reports, deletion requests and admin inbox ([#50](https://github.com/Abid-Tanoli/Cric-All/pull/50))

## 2026-11-12

### Added
- Pick Playing XI from the whole club roster, inline new player ([#46](https://github.com/Abid-Tanoli/Cric-All/pull/46))
- Organization-owned tournaments and series, admin-only deletes ([#47](https://github.com/Abid-Tanoli/Cric-All/pull/47))

### Fixed
- Recompute chase rate and enforce bowler rules ([#45](https://github.com/Abid-Tanoli/Cric-All/pull/45))

## 2026-11-11

### Added
- Show tournament champions on public pages ([#42](https://github.com/Abid-Tanoli/Cric-All/pull/42))

### Fixed
- Derive tournament champion/runner-up from completed Final ([#41](https://github.com/Abid-Tanoli/Cric-All/pull/41))
- Make ball undo restore the exact pre-ball state ([#43](https://github.com/Abid-Tanoli/Cric-All/pull/43))
- Correct run-out ends, bowler credit, and free-hit persistence ([#44](https://github.com/Abid-Tanoli/Cric-All/pull/44))

## 2026-11-07

### Added
- Make tournament impact result-aware and add official Top 3 podium ([#39](https://github.com/Abid-Tanoli/Cric-All/pull/39))
- Showcase Official Tournament Awards ([#40](https://github.com/Abid-Tanoli/Cric-All/pull/40))

## 2026-11-06

### Added
- Import Final result as a draft manual scorecard ([#37](https://github.com/Abid-Tanoli/Cric-All/pull/37))

### Fixed
- Fix manual scorecard overs format validation ([#36](https://github.com/Abid-Tanoli/Cric-All/pull/36))
- Fix Final import: map Dr Suleman and scope man-of-the-match to the finalist team ([#38](https://github.com/Abid-Tanoli/Cric-All/pull/38))

## 2026-11-05

### Fixed
- Show and save batting position in the old-player edit forms ([#34](https://github.com/Abid-Tanoli/Cric-All/pull/34))

### Maintenance
- Sync VPS deploy config (ports, Mongo env, backups) ([#35](https://github.com/Abid-Tanoli/Cric-All/pull/35))

## 2026-11-04

### Fixed
- Keep tournaments visible on the public series list ([#32](https://github.com/Abid-Tanoli/Cric-All/pull/32))
- Player merge integrity, match squad/XI validation, cleanup runbook ([#33](https://github.com/Abid-Tanoli/Cric-All/pull/33))

## 2026-11-03

### Added
- Placeholder player report and safe rename/merge tooling ([#29](https://github.com/Abid-Tanoli/Cric-All/pull/29))

### Fixed
- Fix full-squad match setup and unannounced XI display ([#28](https://github.com/Abid-Tanoli/Cric-All/pull/28))
- Make placeholder player report complete and add decision-support columns ([#30](https://github.com/Abid-Tanoli/Cric-All/pull/30))
- Resolve placeholder teams from squads and scorecard orientation, add looser candidate columns ([#31](https://github.com/Abid-Tanoli/Cric-All/pull/31))

## 2026-10-31

### Added
- Matches-played column and Player of the Tournament impact ranking ([#27](https://github.com/Abid-Tanoli/Cric-All/pull/27))

### Fixed
- Tournament squads 404, run rate, fall-of-wickets overs, reconnect bar, hide unconfigured international section ([#25](https://github.com/Abid-Tanoli/Cric-All/pull/25))
- Correct team label for bowlers on stats boards and derive player profile stats from matches ([#26](https://github.com/Abid-Tanoli/Cric-All/pull/26))

## 2026-10-30

### Added
- Final fixture script, correct W badge in bracket, derived tournament status/dates ([#23](https://github.com/Abid-Tanoli/Cric-All/pull/23))
- Organization ownership handover with temporary password and forced password change ([#24](https://github.com/Abid-Tanoli/Cric-All/pull/24))

### Fixed
- Keep SF result importers team-scoped (no cross-team player reuse) ([#22](https://github.com/Abid-Tanoli/Cric-All/pull/22))

## 2026-10-29

### Added
- Import Semi-Final 2 result (Khan Associates vs Young Star) as a draft ([#21](https://github.com/Abid-Tanoli/Cric-All/pull/21))

## 2026-10-28

### Added
- Admin: list, open and publish manual scorecard drafts ([#16](https://github.com/Abid-Tanoli/Cric-All/pull/16))
- Create tournament semi-finals via shared fixture service and idempotent script ([#18](https://github.com/Abid-Tanoli/Cric-All/pull/18))
- Add optional batting position (opener/middle/lower/tailender) to players ([#19](https://github.com/Abid-Tanoli/Cric-All/pull/19))

### Fixed
- Show team names on tournament fixtures and results (no more TBD) ([#17](https://github.com/Abid-Tanoli/Cric-All/pull/17))

## 2026-09-28 to 2026-10-20 (foundation)

Summary of the work before pull requests were used consistently. See `git log` for detail. Work before 28 Sep 2026 (PR #4, #5, June 2026) is not listed. PR #20 was never merged; the official awards change (`6a092fd`) went in without a PR.

### Added
- Tournament hub: Cricinfo-style series page and admin content manager ([#8](https://github.com/Abid-Tanoli/Cric-All/pull/8))
- Squads CSV import script, dry run by default ([#9](https://github.com/Abid-Tanoli/Cric-All/pull/9))
- Knockouts for local clubs: manual scorecards, scorer assignment, bracket progression and awards ([#10](https://github.com/Abid-Tanoli/Cric-All/pull/10))
- Player photos and team logos attach scripts with runbooks ([#11](https://github.com/Abid-Tanoli/Cric-All/pull/11), [#14](https://github.com/Abid-Tanoli/Cric-All/pull/14))
- Community posts, comments, likes, reports and admin moderation, off by default ([#12](https://github.com/Abid-Tanoli/Cric-All/pull/12), [#13](https://github.com/Abid-Tanoli/Cric-All/pull/13))
- `REQUIRE_VERIFIED_ACCOUNT` switch for the verification gate ([#7](https://github.com/Abid-Tanoli/Cric-All/pull/7))
- 12th Man rule replacing Super Sub copy; feature-flagged navigation; AI commentary off by default (`45f41a6`, `1ac6215`, `818c628`)
- Phone-number signup and login with OTP (`902df33`); phone verification is currently switched off in config
- Email verification, Google identity linking, token versioning, zod validation and rate limits on auth (`ef63454`)

### Fixed
- Tournament fixtures were not scorable without a database repair (`a4cf64e`)
- Invitations work for phone-only accounts (`581fd4d`)

### Security
- Fixtures and private teams hidden from every public read path (`fc11f2b`)
- Public data sanitizers and per-organization team names (`a6d4b60`)
- Cross-tenant and NoSQL injection test suites (`623e9d2`)
- Scoring routes honour `score_match`; squad routes need `create_match` (`7a9cac0`)

### Documentation
- Pre-launch credential rotation checklist (`cbb3886`)
- Phase 0 audit and phase status table (`4d4f71f`, `cf5eba9`)
