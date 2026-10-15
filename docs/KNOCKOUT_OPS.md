# Knockout operations — scorer runbook

P2 of the `oct12-knockout` branch. This is the runbook a club uses to run one
knockout fixture live, plus what the automated dry run proves and what it does
not.

Everything here is verified by `Backend/test/knockoutLiveDryRun.test.js`, which
plays a full 20-over × 2 fixture through the real scoring HTTP API.

---

## 1. Who may score a match

Two separate permissions, unchanged from Phase 9, plus one new rule:

| Action | Permission | Who holds it |
| --- | --- | --- |
| Assign a scorer to a fixture | `create_match` | Platform admins, club owner/admin/manager |
| Open the scoring screen for a fixture | `score_match` | Club members whose role holds `score_match`, plus platform admins |

**New in P2:** if a fixture has an assigned scorer, only that scorer (plus the
club's owner/admin/manager and platform admins, who keep supervisory access)
may open it. Other `score_handler`s in the same club get `403` with code
`MATCH_SCORER_NOT_ASSIGNED`. A fixture with **no** assigned scorer keeps the
Phase 9 rule — any member holding `score_match` can score it.

Assignment is stored in `Match.assignedScorers` (an array of `User` ids) and is
audited as `match.scorers_assigned`.

### Assigning a scorer

- **Admin UI:** *Scorer Assignment* in the sidebar (`/admin/scorers`). Pick the
  fixture, tick the member, **Save assignment**. Ticking nobody clears the
  restriction.
- **API:**

```http
PUT /api/matches/:id/scorers        # { "scorerIds": ["64b7…"] } — [] clears
PUT /api/matches/:id/officials      # { "userId": "64b7…", "role": "scorer" }
```

Both write the same field, so either path can be used from scripts. The
officials endpoint (`MatchOfficial` with `role:"scorer"`) is what the older
officials bookkeeping uses; appointing a **scorer** no longer writes a ghost
"umpire" row whose name is a raw user id (that bug is fixed in P2).

---

## 2. Match flow (the 20-over script the scorer follows)

All calls are `PUT`/`POST` with the scorer's `Bearer` token. The exact sequence
below is what the dry run executes.

1. **Toss** — `PUT /api/matches/:id/toss` `{ "tossWinnerId": "…", "decision": "bat" | "bowl" }`.
2. **Playing XI** (both sides) — `PUT /api/matches/:id/playing-xi` `{ "teamId": "…", "players": ["…×11"] }`.
3. **Start scoring** — `POST /api/matches/:id/score` with
   `inningsIndex`, `batsmanOnStrikeId`, `batsmanNonStrikeId`, `bowlerId`, plus
   the delivery details.
   - Runs: `runs: 0…6`.
   - **Wide:** `isWide: true` (1 extra + `runs` as overthrows; no legal ball).
   - **No-ball:** `isNoBall: true` (1 extra; arms a free hit).
   - **Free hit:** the *next* legal ball. The response returns
     `ball.freeHitNext === true` after the no-ball, `false` on the free-hit ball.
     On a free hit only `run_out` / `obstructing` / `hit twice` count.
   - **Wicket:** `isWicket: true`, `wicketType`, `dismissedPlayerId`, and
     `fielderId` for `caught`/`stumped`/`run_out`. Add
     `nextBatsmanId` to bring the next bat on.
   - **Run-out:** `wicketType: "run_out"`, `dismissedPlayerId` = whoever is out
     (striker or non-striker), `fielderId`, and `didCross: true` if they crossed.
4. **Undo the last ball** — `POST /api/matches/:id/revert-ball` `{ "inningsIndex": 0 }`.
   Use this for a mis-entry; it rolls back runs, balls, player stats and the
   over's ball list.
5. **Retire a batsman** — `POST /api/matches/:id/retire-batsman`
   `{ "inningsIndex": 0, "playerId": "…", "type": "retired_hurt" | "retired" }`.
   The card is marked `isRetiredHurt`/`isRetired`. Send the replacement on the
   next delivery with `batsmanOnStrikeId` / `batsmanNonStrikeId`.
6. **Innings ends automatically** on the last legal ball of the 20th over (all
   out, overs used, or target reached): the match moves to `innings_break` and
   `innings[1].target` is set to innings-1 runs + 1.
7. **End innings (optional, idempotent)** — `POST /api/matches/:id/end-innings`
   `{ "inningsIndex": 0 }`.
8. **Start the chase** — `POST /api/matches/:id/start-next-innings` (no body).
9. **Chase** with `inningsIndex: 1` until the target is passed; the engine
   completes the match and writes `result.winner` on that ball.
10. **Man of the Match** — `PUT /api/matches/:id/mom` `{ "playerId": "…" }`.

### Rate limit

`POST /:matchId/score`, `/field-click`, `/revert-ball`, `/set-bowler`,
`/reset-innings` and `/reset-match` share a limit of **12 requests per second
per match+route+actor**. A human scorer is comfortably inside this. Automated
scripts must sleep ~115 ms between scoring calls (the dry run does).

---

## 3. What the dry run proves

`Backend/test/knockoutLiveDryRun.test.js` creates a knockout tournament and a
manually-created quarter-final, then over real HTTP:

- 20 overs × 1 innings = 120 legal balls, with a wide, a no-ball + free hit, a
  caught/bowled wicket, a **run-out of the non-striker**, a **retirement**, and
  an **undo**;
- the innings break, the "start next innings" action, the chase, and the result;
- that the scorecard is arithmetically consistent (batting + extras = innings
  total, no duplicate batsman cards, the run-out is charged to the dismissed
  batsman, the retired batsman is marked);
- that `GET /:id/stats` answers 200;
- that the tournament **standings** score the win;
- that the Socket.IO channels a public scorecard subscribes to
  (`ball:recorded`, `score:update`, `match:ballUpdate`, `over:completed`,
  `WICKET_ALERT`, `match:updateList`, `match:updated`) actually fired.

### Bugs found and fixed by the dry run (each with a regression test)

1. **A run-out of the non-striker was charged to the striker's card**
   (`ScoringEngine._updateBattingStats`). The dismissal is now attributed to the
   batsman the scorer named, and the fall of wicket and the card agree.
   Regression: `test/scoringEngine.test.js` → *"a run-out charges the dismissal
   to the batsman the scorer named"*.
2. **The last ball of an innings discarded the engine's state transition**
   (`updateScore` forced `match.status = "live"` and `match.currentInnings` back
   to the ball just bowled). The match looked live at the innings break and
   `/start-next-innings` answered *"Match is not in innings break"*.
   Regression: `test/knockoutLiveDryRun.test.js` → *"the last ball of the first
   innings moves the match to the innings break"*.
3. **`match:end` was emitted at the innings break** — `isMatchEnd` was derived
   from `currentInnings >= 1` instead of "was this the last innings". Fixed in
   the same change as (2).
4. **The fall of wickets could not say how a batsman got out**
   (`Match.fallOfWickets` sub-schema). The engine writes `wicket`, `wicketType`
   and `fielder`, but the sub-schema only declared `runs`/`wickets`/`player`/
   `overs`, so Mongoose silently dropped the other three on save. The
   scorecard's fall-of-wickets therefore never showed the dismissal type.
   Regression: `test/knockoutLiveDryRun.test.js` → *"a fall-of-wicket entry
   survives a save with how the batsman got out"*, plus a schema guard in
   `test/scoringEngine.test.js`.

---

## 4. Live-match risks (read before Sunday 18 Oct)

- **Network / device loss.** The scoring state lives on the server; a scorer who
  reloads the page loses nothing. Two scorers on the same match will interleave
  — the rate limit does not prevent it. Assign exactly one scorer per fixture
  (P2's assignment rule exists for this reason).
- **Undo is single-ball only.** `/revert-ball` takes back the last delivery. To
  fix an error several balls back, revert in order and re-enter.
- **Retirement does not auto-send in a replacement.** The scorer must pass the
  new batsman's id on the next delivery, or the innings cannot record a ball.
- **Super over is not exercised** by the dry run (`resolve-tie`,
  `start-super-over` are separate routes). If a final ties, the tie resolution
  flow needs a manual check.
- **Impact player / 12th man substitutions are not exercised** by the dry run.
- **No push "wicket alert".** `emitWicketAlert` / `MILESTONE_ALERT` in
  `socket.js` are dead exports — nothing calls them. A wicket reaches the
  public page today through `ball:recorded` / `score:update` carrying
  `isWicket: true`, so the scorecard updates, but there is no dedicated alert
  channel. Do not rely on one.
- **Manual (paper) scorecards are a different path** — see `docs/` P1 notes; a
  manual match has no live scoring and must not be assigned a scorer.
- **Paper QFs (Sun 11 Oct)** are entered as manual scorecards; only the live
  fixture on Sun 18 Oct uses this runbook.

---

## 5. Quick API reference (scoring surface)

| Method | Route | Purpose |
| --- | --- | --- |
| PUT | `/api/matches/:id/toss` | Record the toss |
| PUT | `/api/matches/:id/playing-xi` | File the XI (exactly 11) |
| POST | `/api/matches/:id/score` | Record a delivery |
| POST | `/api/matches/:id/revert-ball` | Undo the last delivery |
| POST | `/api/matches/:id/end-innings` | Close the current innings |
| POST | `/api/matches/:id/start-next-innings` | Begin the chase |
| POST | `/api/matches/:id/retire-batsman` | Retire a batsman |
| POST | `/api/matches/:id/set-bowler` | Set the bowler for the over |
| PUT | `/api/matches/:id/edit-ball` | Correct a past delivery |
| PUT | `/api/matches/:id/mom` | Man of the Match |
| PUT | `/api/matches/:id/scorers` | Assign/clear the fixture's scorer |
| POST | `/api/matches/:id/officials` | Officials bookkeeping (incl. scorer) |
