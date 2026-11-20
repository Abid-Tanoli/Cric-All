// Deterministic, Cricbuzz-style commentary built from stored ball fields only.
//
// It never calls AI and never invents a fielder or shot detail: every phrase
// comes from a field that is actually on the ball. The scorer feed, the User
// match page and the Admin match view all read this module so the chip and the
// sentence are identical everywhere.
//
// Stored ball shape (see Backend/src/models/Match.js ballSchema):
//   runs            runs off the bat (0 for wides/byes/leg byes)
//   batsmanRuns     same figure when the engine recorded it
//   extraRuns       wide: 1 + extra runs; no ball: 1; bye/leg bye: the runs
//   isWide, isNoBall, isBye, isLegBye, isWicket, wicketCancelled
//   wicketType, fielderName, bowlerName, batsmanName, displayBallNumber

const n = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const runsOffBat = (ball = {}) =>
  ball.batsmanRuns != null ? n(ball.batsmanRuns) : n(ball.runs);

const isLegal = (ball = {}) => !ball.isWide && !ball.isNoBall;

export const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

// Total runs the delivery added to the innings (bat + every extra).
export function ballDeliveryRuns(ball = {}) {
  if (ball.isWide) {
    const extra = n(ball.extraRuns);
    return extra > 0 ? extra : 1 + runsOffBat(ball);
  }
  if (ball.isNoBall) {
    const extra = n(ball.extraRuns);
    const byes = ball.isBye || ball.isLegBye ? (extra > 0 ? extra : n(ball.runs)) : 0;
    return 1 + (byes || runsOffBat(ball));
  }
  if (ball.isBye || ball.isLegBye) {
    const extra = n(ball.extraRuns);
    return extra > 0 ? extra : n(ball.runs);
  }
  return runsOffBat(ball);
}

// Chip label: •, 1, 4, 6, W, 1W, wd, 3wd, nb, 5nb, 5n-b, 2b, 1lb.
export function ballChipText(ball = {}) {
  if (ball.isWicket && !ball.wicketCancelled) {
    const runs = runsOffBat(ball);
    return runs > 0 ? `${runs}W` : "W";
  }
  if (ball.isWide) {
    const total = ballDeliveryRuns(ball);
    return total > 1 ? `${total}wd` : "wd";
  }
  if (ball.isNoBall) {
    const total = ballDeliveryRuns(ball);
    if (ball.isBye || ball.isLegBye) return `${total}n-b`;
    return total > 1 ? `${total}nb` : "nb";
  }
  if (ball.isBye) return `${ballDeliveryRuns(ball)}b`;
  if (ball.isLegBye) return `${ballDeliveryRuns(ball)}lb`;
  const runs = runsOffBat(ball);
  return runs === 0 ? "\u2022" : String(runs);
}

// wicket | boundary | extra | normal ("normal" covers dot balls and 1/2/3).
export function ballChipTone(ball = {}) {
  if (ball.isWicket && !ball.wicketCancelled) return "wicket";
  if (
    !ball.isWide &&
    !ball.isNoBall &&
    !ball.isBye &&
    !ball.isLegBye &&
    (runsOffBat(ball) === 4 || runsOffBat(ball) === 6)
  ) {
    return "boundary";
  }
  if (ball.isWide || ball.isNoBall || ball.isBye || ball.isLegBye) return "extra";
  return "normal";
}

// "runOut", "run_out" and "run out" all mean the same thing.
const normalizeWicketType = (value) =>
  String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function wicketPhrase(ball = {}) {
  const type = normalizeWicketType(ball.wicketType);
  const fielder = ball.fielderName || "";
  const runs = runsOffBat(ball);

  if (type === "run out") {
    const fielderPart = fielder ? ` (${fielder})` : "";
    const runsPart = runs > 0 ? `, ${plural(runs, "run")} completed` : "";
    return `run out${fielderPart}${runsPart}`;
  }
  if (type === "caught") return fielder ? `OUT! caught by ${fielder}` : "OUT! caught";
  if (type === "stumped") return fielder ? `OUT! stumped by ${fielder}` : "OUT! stumped";
  if (!type) return "OUT!";
  return `OUT! ${type}`;
}

// The result half of a commentary line, e.g. "no run", "FOUR", "wide, 1 run".
export function ballResultPhrase(ball = {}) {
  if (ball.wicketCancelled) return "no ball, wicket cancelled";
  if (ball.isWicket) return wicketPhrase(ball);

  if (ball.isWide) {
    const extra = Math.max(0, ballDeliveryRuns(ball) - 1);
    return extra > 0 ? `wide, ${plural(extra, "run")}` : "wide";
  }
  if (ball.isNoBall) {
    if (ball.isBye) return `no ball, ${plural(Math.max(0, ballDeliveryRuns(ball) - 1), "bye")}`;
    if (ball.isLegBye) {
      return `no ball, ${plural(Math.max(0, ballDeliveryRuns(ball) - 1), "leg bye")}`;
    }
    const offBat = runsOffBat(ball);
    return offBat > 0 ? `no ball, ${plural(offBat, "run")} off the bat` : "no ball";
  }
  if (ball.isBye) return plural(ballDeliveryRuns(ball), "bye");
  if (ball.isLegBye) return plural(ballDeliveryRuns(ball), "leg bye");

  const runs = runsOffBat(ball);
  if (runs === 0) return "no run";
  if (runs === 4) return "FOUR";
  if (runs === 6) return "SIX";
  return plural(runs, "run");
}

// "Bowler to Batter, FOUR". Missing names are simply left out.
export function ballSentence(ball = {}, { bowlerName = "", batsmanName = "" } = {}) {
  const bowler = ball.bowlerName || bowlerName || "";
  const batter = ball.batsmanName || batsmanName || "";
  const result = ballResultPhrase(ball);
  if (bowler && batter) return `${bowler} to ${batter}, ${result}`;
  if (batter) return `${batter}, ${result}`;
  if (bowler) return `${bowler}, ${result}`;
  return result;
}

export const overNumberOf = (over) => n(over?.overNumber) + 1;

export const formatBowlerOversFromBalls = (balls) => {
  const total = Math.max(0, n(balls));
  return `${Math.floor(total / 6)}.${total % 6}`;
};

const sequenceOf = (ball, index) => {
  const candidates = [ball?.rawBallNumber, ball?.ballNumber, ball?.displayBallNumber];
  const found = candidates.map(Number).find(Number.isFinite);
  return found != null ? found : index;
};

const orderedBalls = (balls = []) =>
  balls
    .map((ball, index) => ({ ball, index, sequence: sequenceOf(ball, index) }))
    .sort((a, b) => a.sequence - b.sequence || a.index - b.index)
    .map((entry) => entry.ball);

const bowlerKeyOf = (over, balls) =>
  String(
    over?.bowler?._id ||
      over?.bowler ||
      balls[0]?.bowler?._id ||
      balls[0]?.bowler ||
      ""
  );

// One pass over the innings builds every over: chips, per-ball plain sentence
// ("Over 14.3"), the running score at the end of that over and the bowler's
// cumulative O-M-R-W. Output is newest first.
export function buildPlainOverFeed(overs = []) {
  const sortedOvers = [...(overs || [])]
    .filter(Boolean)
    .sort((a, b) => overNumberOf(a) - overNumberOf(b));

  const bowlerTotals = new Map();
  let score = { runs: 0, wickets: 0 };
  const feed = [];

  sortedOvers.forEach((over) => {
    const balls = orderedBalls(over.balls || []);
    const bowlerKey = bowlerKeyOf(over, balls);
    const bowlerName = over?.bowler?.name || balls[0]?.bowlerName || "";
    const totals = bowlerTotals.get(bowlerKey) || { balls: 0, maidens: 0, runs: 0, wickets: 0 };

    let overRuns = 0;
    let overWickets = 0;
    let legalBalls = 0;

    const deliveries = balls.map((ball) => {
      const runs = ballDeliveryRuns(ball);
      const wicket = Boolean(ball.isWicket && !ball.wicketCancelled);
      overRuns += runs;
      score = { runs: score.runs + runs, wickets: score.wickets + (wicket ? 1 : 0) };
      totals.runs += runs;
      if (isLegal(ball)) {
        legalBalls += 1;
        totals.balls += 1;
      }
      if (wicket) {
        overWickets += 1;
        totals.wickets += 1;
      }
      const display = legalBalls + (isLegal(ball) ? 0 : 1);
      return {
        ball,
        label: `${overNumberOf(over)}.${display}`,
        chip: ballChipText(ball),
        tone: ballChipTone(ball),
        text: ballSentence(ball, { bowlerName }),
      };
    });

    const complete = legalBalls >= 6 || over?.isComplete === true;
    if (complete && overRuns === 0) totals.maidens += 1;
    bowlerTotals.set(bowlerKey, totals);

    const bowlerLine = balls.length
      ? `${formatBowlerOversFromBalls(totals.balls)}-${totals.maidens}-${totals.runs}-${totals.wickets}`
      : "";

    feed.push({
      overNumber: overNumberOf(over),
      over,
      runs: overRuns,
      wickets: overWickets,
      complete,
      chips: deliveries.map((delivery) => delivery.chip),
      balls: deliveries,
      score: { ...score },
      bowlerName,
      bowlerLine,
      summary: `End of over ${overNumberOf(over)}: ${plural(overRuns, "run")}, ${score.runs}/${score.wickets}`,
    });
  });

  return feed.reverse();
}

// Compact "Over 1: Name" list for the next-bowler modal.
export function overByOverList(overs = []) {
  return [...(overs || [])]
    .filter(Boolean)
    .sort((a, b) => overNumberOf(a) - overNumberOf(b))
    .map((over) => ({
      overNumber: overNumberOf(over),
      name: over?.bowler?.name || over?.balls?.[0]?.bowlerName || "",
    }));
}
