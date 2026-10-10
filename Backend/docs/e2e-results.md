# E2E Results - Local Only

- Run id: `mv2los9i`
- API base: `http://127.0.0.1:5000/api` (loopback only - guard enforced)
- Database: `cric-all-e2e` on `127.0.0.1:27017` (local Docker Mongo)
- Duration: 181.6s
- Scenarios: 7 of 7 ran
- Overall: **PASS** (78 pass, 0 fail, 0 divergence)

## Scenario coverage

Every scenario in the roster appears here, including the ones that did not run.

| Scenario | Status | Checks |
| --- | --- | --- |
| Scenario 1 - full T20 innings (20 overs, every ball type) and the chase | ran | 16 |
| Scenario 2 - free hit (a no-ball must protect the next delivery) | ran | 4 |
| Scenario 3 - innings bowled out inside the overs | ran | 6 |
| Scenario 4 - tie, then Super Over | ran | 13 |
| Scenario 5 - negative tests (HTTP authorization and Laws) | ran | 7 |
| Scenario 6 - negative tests (Socket.IO cannot score) | ran | 3 |
| Scenario 7 - other Match.matchType formats | ran | 29 |
| **Total** | 7 ran, 0 skipped | **78** |

A filtered run counts only the checks of the scenarios that actually ran, so its
total is expected to sit well below the canonical full-suite total - the two
heaviest scenarios alone carry the majority of the checks. The table above names
every scenario that did not run and why, which is what distinguishes an
intentionally small `E2E_ONLY` run from a silent regression. A partial run is
never written over the canonical report.

Every score below was produced by sending balls to `POST /api/matches/:id/score`
as the invited `score_handler`. No result was inserted into MongoDB. The expected
scorecard comes from a tally written from the Laws of Cricket that shares no code
with `ScoringEngine`; agreement between the two is a real cross-check.

## Accounts and calls

- Scenarios executed: 7 of 7 (none skipped)
- Owner account: `OPENCODE_TEST_owner_mv2los9i@example.test` (never used to score)
- Assigned scorer, who sent every delivery: `OPENCODE_TEST_scorer_mv2los9i@example.test`, organization role `score_handler`
- Invitation accepted through `POST /invitations/accept` using the token from the console mail log
- Organization: `6aca65cdb37b8ab7095573f8`; second tenant for the cross-tenant test: `6aca65cdb37b8ab7095573fc`
- HTTP calls issued by the suite: 655
- Note: the application lower-cases e-mail addresses on save, so `OPENCODE_TEST_...` fixtures appear as `opencode_test_...` in the database and in mail. Names keep the prefix verbatim.


## Scenario 1 - full T20 innings (20 overs, every ball type) and the chase

Fixture created through `POST /organizations/:id/matches`; every delivery sent by the invited `score_handler` (OPENCODE_TEST_scorer_mv2los9i@example.test), never by the owner.
Extras split (innings 1): the independent tally follows the Laws - a wide is one extra and runs completed off a wide are byes. The server folds those runs into `wides` instead. `wides` independent=3 server=5; `byes` independent=4 server=2. The extras *total* is asserted separately and agrees.
Innings 1: **145/8** in 20.0 overs. Extras (Laws split): wides 3, no-balls 4, byes 4, leg-byes 4, total 15.
Chasing side: **146/0** off 49 balls (target 146).
Result: OPENCODE_TEST_Beta_mv2los9i won by 10 wickets (23 balls remaining).

| Result | Check | Detail |
| --- | --- | --- |
| PASS | every delivery accepted by POST /matches/:id/score | 127 balls recorded |
| PASS | innings 1 ended on the last ball of over 20 | ended=true reason=oversComplete overs=20.0 |
| PASS | legal deliveries counted = 120 | independent=120 |
| PASS | strike rotation agreed with the server on all 127 deliveries | 127 deliveries, no divergence |
| PASS | innings 1 scorecard: independent tally vs server | independent tally and server agree |
| PASS | a run-out is not charged to the bowler | bowler wickets: independent=7 server=7 (the fixture contains one run-out) |
| PASS | end-innings closes innings 1 and sets the break | status=200 matchStatus=innings_break |
| PASS | start-next-innings puts innings 2 live | status=200 |
| PASS | chase deliveries all accepted | 49 balls |
| PASS | innings 2 ended because the target was reached | reason=targetChased runs=146 target=146 balls=49 |
| PASS | strike rotation agreed on every chase delivery | [] |
| PASS | innings 2 scorecard: independent tally vs server | independent tally and server agree |
| PASS | scoring alone does not settle the match | status=completed result="{"winner":{"_id":"6aca65cdb37b8ab70955740b","name":"OPENCODE_TEST_Beta_mv2los9i","shortName":"OPE"},"margin":"10 wickets","description":"OPENCODE_TEST_Beta_mv2los9i won by 10 wickets (49 balls remaining)"}" - expected, the result is only written by end-innings |
| PASS | end-innings accepts the final innings | status=200 |
| PASS | chasing side won by the wickets remaining | resultType=normal margin="10 wickets" description="OPENCODE_TEST_Beta_mv2los9i won by 10 wickets (23 balls remaining)" (inningsController.js:83 hard-codes 10 as the wicket count, so a Super Over margin would be wrong here too) |
| PASS | match marked completed | status=completed |

## Scenario 2 - free hit (a no-ball must protect the next delivery)

On its own fixture, so that a wrongly-accepted dismissal cannot desynchronise the strike for the rest of a real innings. On a free hit only a run-out, obstructing the field, or hit twice may dismiss.

| Result | Check | Detail |
| --- | --- | --- |
| PASS | the no-ball was recorded | status=200 runs=1 |
| PASS | free-hit bowled / caught / lbw are refused | all three were refused |
| PASS | a run-out still stands on a free hit | run-out accepted=true |
| PASS | the server reports each next delivery as a free hit | flag persisted between HTTP requests |

## Scenario 3 - innings bowled out inside the overs

Ten dismissals inside 14 legal deliveries, so the innings must end on wickets rather than on overs.
All out: **6/10** in 2.1 overs (target 7).

| Result | Check | Detail |
| --- | --- | --- |
| PASS | all-out deliveries accepted | 13 balls |
| PASS | innings ended at 10 wickets, well inside 20 overs | wickets=10 balls=13 reason=allOut |
| PASS | strike rotation agreed on every delivery | [] |
| PASS | all-out scorecard: independent tally vs server | independent tally and server agree |
| PASS | target set for the second innings | server target=7 independent=7 |
| PASS | a completed innings refuses further deliveries with 4xx | status=409 code=INNINGS_COMPLETED |

## Scenario 4 - tie, then Super Over

Both sides bat to 30, then the second innings is closed by hand. Under the Laws an equal total is a tie: `end-innings` must record `resultType: "tie"` and leave the match awaiting resolution, and a Super Over must then be playable.

| Result | Check | Detail |
| --- | --- | --- |
| PASS | end-innings closes the first innings | status=200 runs=31 |
| PASS | second innings starts | status=200 |
| PASS | equal totals are accepted by end-innings | status=200 body={"match":{"address":{"country":"Pakistan"},"result":{"margin":"Match tied","description":"Match ended in a tie - Resolution pending","resultType":"tie"},"seriesStanding":{"matchesPlayed":0},"powerplayConfig":{"enabled":true,"overs":6,"type":"standard","batting |
| PASS | the tie is recorded as resultType "tie" | resultType=tie margin="Match tied" description="Match ended in a tie - Resolution pending" |
| PASS | the match waits for tie resolution | status=pending_tie_resolution |
| PASS | balls are refused while tie resolution is pending with 4xx | status=409 code=MATCH_NOT_SCORABLE |
| PASS | tied innings 1: independent tally vs server | independent tally and server agree |
| PASS | tied innings 2: independent tally vs server | independent tally and server agree |
| PASS | a tie can be resolved to a Super Over | status=200 {"match":{"address":{"country":"Pakistan"},"result":{"margin":"Match tied","description":"Match ended in a tie - Resolution pending","resultType":"tie"},"seriesStanding":{"matchesPlayed":0},"powerplay |
| PASS | Super Over innings can be started | status=200 {"match":{"address":{"country":"Pakistan"},"result":{"margin":"Match tied","description":"Super Over 1: 1st Innings in progress","resultType":"super_over"},"seriesStanding":{"matchesPlayed":0},"powerp |
| PASS | Super Over recorded as a separate innings | independent=6 balls=2 inningsIndex=2 |
| PASS | Super Over scorecard: independent tally vs server | independent tally and server agree |
| PASS | the Super Over result is recorded | status=200 {"margin":"Match tied","description":"Super Over 1: First innings complete","resultType":"super_over"} |

## Scenario 5 - negative tests (HTTP authorization and Laws)

A score must be refused without a token, with an unverified mailbox, across a tenant boundary, into a completed innings, and for the same bowler in consecutive overs.

| Result | Check | Detail |
| --- | --- | --- |
| PASS | no token -> 401 | status=401 |
| PASS | garbage token -> 401 | status=401 |
| PASS | unverified mailbox -> 403 | status=403 {"message":"Please verify your email address or phone number before performing this action.","code":"EMAIL_NOT_VERIFIED"} |
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
**ODI**: not played out - this suite does not bat 90 overs or an unbounded innings. Creation verified.
**Test**: not played out - this suite does not bat 90 overs or an unbounded innings. Creation verified.
**Tape Ball**: not played out - this suite does not bat 90 overs or an unbounded innings. Creation verified.

| Result | Check | Detail |
| --- | --- | --- |
| PASS | 6 Overs: created with the right matchType and overs limit | matchType=6 Overs totalOvers=6 status=upcoming |
| PASS | 6 Overs: first delivery recorded | balls=1 |
| PASS | 6 Overs: innings ended at the configured 6 overs | reason=oversComplete overs=6.0 balls=36 serverOvers=6 |
| PASS | 6 Overs: strike rotation agreed before innings end | [] |
| PASS | 6 Overs: scorecard independent tally vs server | independent tally and server agree |
| PASS | 8 Overs: created with the right matchType and overs limit | matchType=8 Overs totalOvers=8 status=upcoming |
| PASS | 8 Overs: first delivery recorded | balls=1 |
| PASS | 8 Overs: innings ended at the configured 8 overs | reason=oversComplete overs=8.0 balls=48 serverOvers=8 |
| PASS | 8 Overs: strike rotation agreed before innings end | [] |
| PASS | 8 Overs: scorecard independent tally vs server | independent tally and server agree |
| PASS | T10: created with the right matchType and overs limit | matchType=T10 totalOvers=10 status=upcoming |
| PASS | T10: first delivery recorded | balls=1 |
| PASS | T10: innings ended at the configured 10 overs | reason=oversComplete overs=10.0 balls=60 serverOvers=10 |
| PASS | T10: strike rotation agreed before innings end | [] |
| PASS | T10: scorecard independent tally vs server | independent tally and server agree |
| PASS | T20: created with the right matchType and overs limit | matchType=T20 totalOvers=20 status=upcoming |
| PASS | T20: first delivery recorded | balls=1 |
| PASS | T20: innings ended at the configured 20 overs | reason=oversComplete overs=20.0 balls=120 serverOvers=20 |
| PASS | T20: strike rotation agreed before innings end | [] |
| PASS | T20: scorecard independent tally vs server | independent tally and server agree |
| PASS | ODI: created with the right matchType and overs limit | matchType=ODI totalOvers=50 status=upcoming |
| PASS | Test: created with the right matchType and overs limit | matchType=Test totalOvers=90 status=upcoming |
| PASS | Tape Ball: created with the right matchType and overs limit | matchType=Tape Ball totalOvers=8 status=upcoming |
| PASS | Super Over: created with the right matchType and overs limit | matchType=Super Over totalOvers=1 status=upcoming |
| PASS | Super Over: first delivery recorded | balls=1 |
| PASS | Super Over: innings ended at the configured 1 overs | reason=oversComplete overs=1.0 balls=6 serverOvers=1 |
| PASS | Super Over: strike rotation agreed before innings end | [] |
| PASS | Super Over: scorecard independent tally vs server | independent tally and server agree |
| PASS | Test: engine resolves the model enum format key | maxOvers=null maxWickets=10 superOver=false |

## Laws applied by the independent tally

- A legal delivery is anything that is not a Wide or a No-ball (byes and leg-byes are legal).
- A wide is one extra, plus any runs the batters completed.
- A No-ball is one extra, plus runs off the bat credited to the batter.
- Byes and leg-byes are run by the fielders, so an odd number does not change the strike.
- A run-out is not charged to the bowler.
- Six legal deliveries make an over and the ends change at the end of it.
- On a free hit only a run-out, obstructing the field, or hit twice can dismiss.
