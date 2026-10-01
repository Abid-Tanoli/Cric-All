# E2E Results - Local Only

- Run id: `mupotre8`
- API base: `http://127.0.0.1:5000/api` (loopback only - guard enforced)
- Database: `cric-all-e2e` on `127.0.0.1:27017` (local Docker Mongo)
- Duration: 227.6s
- Overall: **FAIL** (42 pass, 12 fail, 6 divergence)

Every score below was produced by sending balls to `POST /api/matches/:id/score`
as the invited `score_handler`. No result was inserted into MongoDB. The expected
scorecard comes from a tally written from the Laws of Cricket that shares no code
with `ScoringEngine`; agreement between the two is a real cross-check.

## Accounts and calls

- Owner account: `OPENCODE_TEST_owner_mupotre8@example.test` (never used to score)
- Assigned scorer, who sent every delivery: `OPENCODE_TEST_scorer_mupotre8@example.test`, organization role `score_handler`
- Invitation accepted through `POST /invitations/accept` using the token from the console mail log
- Organization: `6abe7bd977291da4387ab3b5`; second tenant for the cross-tenant test: `6abe7bd977291da4387ab3c7`
- HTTP calls issued by the suite: 402
- Note: the application lower-cases e-mail addresses on save, so `OPENCODE_TEST_...` fixtures appear as `opencode_test_...` in the database and in mail. Names keep the prefix verbatim.


## Scenario 1 - full T20 innings (20 overs, every ball type) and the chase

Fixture created through `POST /organizations/:id/matches`; every delivery sent by the invited `score_handler` (OPENCODE_TEST_scorer_mupotre8@example.test), never by the owner.
Extras split (innings 1): the independent tally follows the Laws - a wide is one extra and runs completed off a wide are byes. The server folds those runs into `wides` instead. `wides` independent=3 server=5; `byes` independent=4 server=2. The extras *total* is asserted separately and agrees.
Innings 1: **145/8** in 20.0 overs. Extras (Laws split): wides 3, no-balls 4, byes 4, leg-byes 4, total 15.
Chasing side: **146/0** off 49 balls (target 146).
Result: OPENCODE_TEST_Beta_mupotre8 won by 10 wickets (23 balls remaining).

| Result | Check | Detail |
| --- | --- | --- |
| PASS | every delivery accepted by POST /matches/:id/score | 127 balls recorded |
| PASS | innings 1 ended on the last ball of over 20 | ended=true reason=oversComplete overs=20.0 |
| PASS | legal deliveries counted = 120 | independent=120 |
| FAIL | strike rotation agreed with the server on all 127 deliveries | [{"delivery":36,"field":"onStrike (after)","mine":"6abe7bda77291da4387ab40d","server":"6abe7bda77291da4387ab41b"},{"delivery":37,"field":"batsmanOnStrike (before)","mine":"6abe7bda77291da4387ab40d","server":"6abe7bda77291da4387ab41b"},{"delivery":37,"field":"onStrike (after)","mine":"6abe7bda77291da4387ab40d","server":"6abe7bda77291da4387ab41b"},{"delivery":38,"field":"batsmanOnStrike (before)","mine":"6abe7bda77291da4387ab40d","server":"6abe7bda77291da4387ab41b"}] |
| DIVERGENCE | innings 1 scorecard: independent tally vs server |  |
| FAIL | a run-out is not charged to the bowler | bowler wickets: independent=7 server=8 (the fixture contains one run-out) |
| PASS | chase deliveries all accepted | 49 balls |
| PASS | innings 2 ended because the target was reached | reason=targetChased runs=146 target=146 balls=49 |
| FAIL | strike rotation agreed on every chase delivery | [{"delivery":1,"field":"batsmanOnStrike (before)","mine":"6abe7bdb77291da4387ab461","server":"6abe7bdb77291da4387ab44c"},{"delivery":1,"field":"onStrike (after)","mine":"6abe7bdb77291da4387ab461","server":"6abe7bdb77291da4387ab44c"},{"delivery":2,"field":"batsmanOnStrike (before)","mine":"6abe7bdb77291da4387ab461","server":"6abe7bdb77291da4387ab44c"},{"delivery":2,"field":"onStrike (after)","mine":"6abe7bdb77291da4387ab461","server":"6abe7bdb77291da4387ab44c"}] |
| DIVERGENCE | innings 2 scorecard: independent tally vs server |  |
| PASS | scoring alone does not settle the match | status=completed result="{"winner":{"_id":"6abe7bda77291da4387ab405","name":"OPENCODE_TEST_Beta_mupotre8","shortName":"OPE"},"margin":"10 wickets","description":"OPENCODE_TEST_Beta_mupotre8 won by 10 wickets (49 balls remaining)"}" - expected, the result is only written by end-innings |
| PASS | end-innings accepts the final innings | status=200 |
| PASS | chasing side won by the wickets remaining | resultType=normal margin="10 wickets" description="OPENCODE_TEST_Beta_mupotre8 won by 10 wickets (23 balls remaining)" (inningsController.js:83 hard-codes 10 as the wicket count, so a Super Over margin would be wrong here too) |
| PASS | match marked completed | status=completed |

### Divergence detail

**innings 1 scorecard: independent tally vs server**

| Field | Independent tally | Server |
| --- | --- | --- |
| `batting[6abe7bda77291da4387ab429].runs` | 28 | 31 |
| `batting[6abe7bda77291da4387ab429].ballsFaced` | 19 | 0 |
| `batting[6abe7bda77291da4387ab429].fours` | 4 | 2 |
| `batting[6abe7bda77291da4387ab429].sixes` | 1 | 2 |
| `batting[6abe7bda77291da4387ab429].dismissalType` | "bowled" | "runOut" |
| `batting[6abe7bda77291da4387ab40d].runs` | 26 | 33 |
| `batting[6abe7bda77291da4387ab40d].ballsFaced` | 33 | 0 |
| `batting[6abe7bda77291da4387ab40d].fours` | 2 | 3 |
| `batting[6abe7bda77291da4387ab40d].sixes` | 0 | 1 |
| `batting[6abe7bda77291da4387ab40d].dismissalType` | "stumped" | "lbw" |
| `batting[6abe7bda77291da4387ab430].runs` | 16 | 10 |
| `batting[6abe7bda77291da4387ab430].ballsFaced` | 8 | 0 |
| `batting[6abe7bda77291da4387ab430].fours` | 1 | 0 |
| `batting[6abe7bda77291da4387ab430].isOut` | true | false |
| `batting[6abe7bda77291da4387ab422].runs` | 14 | 2 |
| `batting[6abe7bda77291da4387ab422].ballsFaced` | 8 | 0 |
| `batting[6abe7bda77291da4387ab422].fours` | 1 | 0 |
| `batting[6abe7bda77291da4387ab422].sixes` | 1 | 0 |
| `batting[6abe7bda77291da4387ab422].isOut` | true | false |
| `batting[6abe7bda77291da4387ab437].runs` | 14 | 24 |
| `batting[6abe7bda77291da4387ab437].ballsFaced` | 11 | 0 |
| `batting[6abe7bda77291da4387ab437].fours` | 1 | 4 |
| `batting[6abe7bda77291da4387ab445].ballsFaced` | 11 | 0 |
| `batting[6abe7bda77291da4387ab41b].runs` | 8 | 6 |
| `batting[6abe7bda77291da4387ab41b].ballsFaced` | 7 | 0 |
| `batting[6abe7bda77291da4387ab41b].fours` | 1 | 0 |
| `batting[6abe7bda77291da4387ab41b].isOut` | true | false |
| `batting[6abe7bda77291da4387ab414].ballsFaced` | 13 | 0 |
| `batting[6abe7bda77291da4387ab43e].ballsFaced` | 7 | 0 |
| `batting[6abe7bda77291da4387ab43e].fours` | 0 | 1 |
| `batting[6abe7bda77291da4387ab43e].sixes` | 1 | 0 |
| `batting[6abe7bdb77291da4387ab44c].ballsFaced` | 3 | 0 |
| `bowling[6abe7bdc77291da4387ab492].wickets` | 1 | 2 |

**innings 2 scorecard: independent tally vs server**

| Field | Independent tally | Server |
| --- | --- | --- |
| `batting[6abe7bdb77291da4387ab461].missing` | 74 | "absent from scorecard" |
| `batting[6abe7bdb77291da4387ab468].missing` | 72 | "absent from scorecard" |

## Scenario 2 - free hit (a no-ball must protect the next delivery)

On its own fixture, so that a wrongly-accepted dismissal cannot desynchronise the strike for the rest of a real innings. On a free hit only a run-out, obstructing the field, or hit twice may dismiss.
`ScoringEngine` sets `innings.isFreeHit = ballRecord.isNoBall` after each delivery and the adapter writes it back with `mInn.isFreeHit = engineInn.isFreeHit`, but `inningsSchema` in `Backend/src/models/Match.js` has no `isFreeHit` (or `freeHitActive`) field. Mongoose runs in strict mode, so the assignment is discarded and never reaches the database. Because scoring is one delivery per HTTP request, the free-hit restriction is never actually in force.

| Result | Check | Detail |
| --- | --- | --- |
| PASS | the no-ball was recorded | status=200 runs=1 |
| FAIL | free-hit bowled / caught / lbw are refused | accepted: free hit, then bowled (wickets now 1), free hit, then caught (wickets now 2), free hit, then lbw (wickets now 3) |
| PASS | a run-out still stands on a free hit | run-out accepted=true |
| FAIL | the server reports the next delivery as a free hit | `isFreeHit` is absent from the innings schema in Match.js (line 125 onwards), so Mongoose drops the flag between HTTP requests and every delivery is scored as if no-ball happened |

## Scenario 3 - innings bowled out inside the overs

Ten dismissals inside 14 legal deliveries, so the innings must end on wickets rather than on overs.
All out: **6/10** in 2.1 overs (target 7).

| Result | Check | Detail |
| --- | --- | --- |
| PASS | all-out deliveries accepted | 13 balls |
| PASS | innings ended at 10 wickets, well inside 20 overs | wickets=10 balls=13 reason=allOut |
| PASS | strike rotation agreed on every delivery | [] |
| DIVERGENCE | all-out scorecard: independent tally vs server |  |
| PASS | target set for the second innings | server target=7 independent=7 |
| FAIL | a completed innings refuses further deliveries | status=200 - a ball was accepted into an innings that had already ended |

### Divergence detail

**all-out scorecard: independent tally vs server**

| Field | Independent tally | Server |
| --- | --- | --- |
| `batting[6abe7bda77291da4387ab41b].ballsFaced` | 2 | 0 |
| `batting[6abe7bda77291da4387ab430].ballsFaced` | 2 | 0 |
| `batting[6abe7bda77291da4387ab445].ballsFaced` | 2 | 0 |
| `batting[6abe7bda77291da4387ab40d].ballsFaced` | 1 | 0 |
| `batting[6abe7bda77291da4387ab414].ballsFaced` | 1 | 0 |
| `batting[6abe7bda77291da4387ab422].ballsFaced` | 1 | 0 |
| `batting[6abe7bda77291da4387ab429].ballsFaced` | 1 | 0 |
| `batting[6abe7bda77291da4387ab437].ballsFaced` | 1 | 0 |
| `batting[6abe7bda77291da4387ab43e].ballsFaced` | 1 | 0 |
| `batting[6abe7bdb77291da4387ab44c].ballsFaced` | 1 | 0 |
| `bowling[6abe7bdc77291da4387ab48b].wickets` | 4 | 5 |

## Scenario 4 - tie, then Super Over

Both sides bat to 30, then the second innings is closed by hand. Under the Laws an equal total is a tie: `end-innings` must record `resultType: "tie"` and leave the match awaiting resolution, and a Super Over must then be playable.

| Result | Check | Detail |
| --- | --- | --- |
| PASS | end-innings closes the first innings | status=200 runs=31 |
| PASS | second innings starts | status=200 |
| PASS | equal totals are accepted by end-innings | status=200 body={"match":{"address":{"country":"Pakistan"},"result":{"margin":"Match tied","description":"Match ended in a tie - Resolution pending","resultType":"tie"},"seriesStanding":{"matchesPlayed":0},"powerplayConfig":{"enabled":true,"overs":6,"type":"standard","batting |
| PASS | the tie is recorded as resultType "tie" | resultType=tie margin="Match tied" description="Match ended in a tie - Resolution pending" |
| PASS | the match waits for tie resolution | status=pending_tie_resolution (Match.js:146 declares status as ["upcoming","toss_done","live","completed","innings-break","innings_break"], so this value cannot be persisted) |
| DIVERGENCE | tied innings 1: independent tally vs server |  |
| DIVERGENCE | tied innings 2: independent tally vs server |  |
| PASS | a tie can be resolved to a Super Over | status=200 {"match":{"address":{"country":"Pakistan"},"result":{"margin":"Match tied","description":"Match ended in a tie - Resolution pending","resultType":"tie"},"seriesStanding":{"matchesPlayed":0},"powerplay |
| PASS | Super Over innings can be started | status=200 {"match":{"address":{"country":"Pakistan"},"result":{"margin":"Match tied","description":"Super Over 1: 1st Innings in progress","resultType":"super_over"},"seriesStanding":{"matchesPlayed":0},"powerp |
| PASS | Super Over recorded as a separate innings | independent=6 balls=2 inningsIndex=2 |
| DIVERGENCE | Super Over scorecard: independent tally vs server |  |
| PASS | the Super Over result is recorded | status=200 {"margin":"Match tied","description":"Super Over 1: First innings complete","resultType":"super_over"} |

### Divergence detail

**tied innings 1: independent tally vs server**

| Field | Independent tally | Server |
| --- | --- | --- |
| `batting[6abe7bda77291da4387ab414].ballsFaced` | 7 | 0 |
| `batting[6abe7bda77291da4387ab40d].ballsFaced` | 5 | 0 |

**tied innings 2: independent tally vs server**

| Field | Independent tally | Server |
| --- | --- | --- |
| `batting[6abe7bdb77291da4387ab468].ballsFaced` | 7 | 0 |
| `batting[6abe7bdb77291da4387ab461].ballsFaced` | 5 | 0 |

**Super Over scorecard: independent tally vs server**

| Field | Independent tally | Server |
| --- | --- | --- |
| `batting[6abe7bda77291da4387ab40d].ballsFaced` | 2 | 0 |

## Scenario 5 - negative tests (HTTP authorization and Laws)

A score must be refused without a token, with an unverified mailbox, across a tenant boundary, into a completed innings, and for the same bowler in consecutive overs.

| Result | Check | Detail |
| --- | --- | --- |
| PASS | no token -> 401 | status=401 |
| PASS | garbage token -> 401 | status=401 |
| PASS | unverified mailbox -> 403 | status=403 {"message":"Please verify your email address before performing this action.","code":"EMAIL_NOT_VERIFIED"} |
| PASS | verified member of another organization -> 403 | status=403 {"message":"You are not a member of this organization.","code":"ORG_MEMBERSHIP_REQUIRED","requiredPermission":"score_match"} |
| PASS | no refused attempt changed the scorecard | runs=0 balls=0 |
| PASS | same bowler cannot bowl consecutive overs | status=400 {"message":"Same bowler cannot bowl consecutive overs"} |
| PASS | overs-per-bowler limit enforced (maxBowlerOvers = 4 for T20) | refused during over 2: {"message":"Same bowler cannot bowl consecutive overs"} |

## Scenario 6 - negative tests (Socket.IO cannot score)

An unauthenticated socket client joins the live match room and tries every plausible scoring event. The scorecard must not move and the server must not acknowledge.
The socket accepts room joins only (`joinRoom`, `join-match`), so no ball can be recorded through it. The handshake carries no JWT, so an anonymous client can subscribe to any match's live feed and read it - a confidentiality finding, recorded separately from the pass/fail result.

| Result | Check | Detail |
| --- | --- | --- |
| PASS | unauthenticated socket connects with no token | no credential presented at handshake |
| PASS | no scoring event was acknowledged | 11 events attempted, 0 acknowledged |
| PASS | scorecard unchanged after every socket attempt | runs 0->0, balls 0->0, wickets 0->0 |

## Scenario 7 - other Match.matchType formats

`Match.js` offers eight formats. Each is created through the API and, where the format is short enough to bat out, played to completion and checked against the independent tally.
**ODI**: not played out - this suite does not bat 90 overs or an unbounded innings.
**Test**: not played out - this suite does not bat 90 overs or an unbounded innings.
**Tape Ball**: not played out - this suite does not bat 90 overs or an unbounded innings.
**Test**: because of that case mismatch the engine enforces T20 rules on a Test match, and `declareInnings` throws `Declaration only allowed in Test matches` because the engine believes the format is not Test. Two independent code paths disagree about which format the fixture is.

| Result | Check | Detail |
| --- | --- | --- |
| PASS | 6 Overs: fixture created and one delivery recorded | matchType=6 Overs totalOvers=6 status=200 balls=1 |
| FAIL | 6 Overs: innings played to completion without error | POST /matches/6abe7ca277291da4387cb960/score -> 400 {"message":"Same bowler cannot bowl consecutive overs"} |
| PASS | 8 Overs: fixture created and one delivery recorded | matchType=8 Overs totalOvers=8 status=200 balls=1 |
| FAIL | 8 Overs: innings played to completion without error | POST /matches/6abe7ca677291da4387cbb7b/score -> 400 {"message":"Same bowler cannot bowl consecutive overs"} |
| PASS | T10: fixture created and one delivery recorded | matchType=T10 totalOvers=10 status=200 balls=1 |
| FAIL | T10: innings played to completion without error | POST /matches/6abe7ca977291da4387cbd96/score -> 400 {"message":"Same bowler cannot bowl consecutive overs"} |
| PASS | T20: fixture created and one delivery recorded | matchType=T20 totalOvers=20 status=200 balls=1 |
| FAIL | T20: innings played to completion without error | POST /matches/6abe7cac77291da4387cbfb2/score -> 400 {"message":"Same bowler cannot bowl consecutive overs"} |
| PASS | ODI: fixture created and one delivery recorded | matchType=ODI totalOvers=50 status=200 balls=1 |
| PASS | Test: fixture created and one delivery recorded | matchType=Test totalOvers=90 status=200 balls=1 |
| PASS | Tape Ball: fixture created and one delivery recorded | matchType=Tape Ball totalOvers=8 status=200 balls=1 |
| PASS | Super Over: fixture created and one delivery recorded | matchType=Super Over totalOvers=1 status=200 balls=1 |
| FAIL | Super Over: innings played to completion without error | POST /matches/6abe7cb277291da4387cc2d2/score -> 400 {"message":"Same bowler cannot bowl consecutive overs"} |
| FAIL | Test: stored totalOvers matches the format the engine resolves | `ScoringEngine.FORMATS` keys the unlimited entry `TEST` (upper case) while the `Match.matchType` enum value is `Test`. The engine looks the format up with `FORMATS[match.matchType]`, so a Test match falls through to the T20 defaults (20 overs, Super Over available) while the model stores totalOvers = 90. |

## Laws applied by the independent tally

- A legal delivery is anything that is not a Wide or a No-ball (byes and leg-byes are legal).
- A Wide is one extra, plus any runs the batters completed.
- A No-ball is one extra, plus runs off the bat credited to the batter.
- Byes and leg-byes are run by the fielders, so an odd number does not change the strike.
- A run-out is not charged to the bowler.
- Six legal deliveries make an over and the ends change at the end of it.
- On a free hit only a run-out, obstructing the field, or hit twice can dismiss.
