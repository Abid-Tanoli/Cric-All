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
//   batsmanOnStrike, batsmanNonStrike, dismissedPlayer  (player refs / names)

const n = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const runsOffBat = (ball = {}) =>
  ball.batsmanRuns != null ? n(ball.batsmanRuns) : n(ball.runs);

const isLegal = (ball = {}) => !ball.isWide && !ball.isNoBall;

// A player ref can be an id or a populated document.
export const playerIdOf = (value) => {
  if (!value) return "";
  if (typeof value === "object") return String(value._id || value.id || "");
  return String(value);
};

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

// Runs credited to the batter: a wide, bye or leg bye never is.
export const ballBatterRuns = (ball = {}) =>
  ball.isWide || ball.isBye || ball.isLegBye ? 0 : runsOffBat(ball);

// A wide is not a ball faced; a no ball is.
export const ballFacedByBatter = (ball = {}) => !ball.isWide;

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

// Scorebook shorthand for the dismissal line: "c Fielder b Bowler", "lbw b
// Bowler", "run out (Fielder)". Only fields that exist are used; nothing is
// invented when the fielder or bowler is unknown.
export function howOutText(ball = {}) {
  const type = normalizeWicketType(ball.wicketType);
  const bowler = ball.bowlerName || "";
  const fielder = ball.fielderName || "";

  if (type === "bowled") return bowler ? `b ${bowler}` : "bowled";
  if (type === "lbw") return bowler ? `lbw b ${bowler}` : "lbw";
  if (type === "caught") {
    const caught = fielder ? `c ${fielder}` : "c";
    return bowler ? `${caught} b ${bowler}` : caught;
  }
  if (type === "stumped") {
    const stumped = fielder ? `st ${fielder}` : "st";
    return bowler ? `${stumped} b ${bowler}` : stumped;
  }
  if (type === "run out") return fielder ? `run out (${fielder})` : "run out";
  if (type === "hit wicket") return bowler ? `hit wicket b ${bowler}` : "hit wicket";
  if (type === "retired hurt") return "retired hurt";
  if (type === "retired out") return "retired out";
  if (!type) return "out";
  return type;
}

// "Hamza Khan c Fielder b Bowler, 16 (6)". Nothing to name means no line.
export function dismissalLine({ name = "", howOut = "", runs = 0, balls = 0 } = {}) {
  if (!name) return "";
  return `${name}${howOut ? ` ${howOut}` : ""}, ${n(runs)} (${n(balls)})`;
}

// "Hamza Khan* 16 (6)" for the striker, "Shan 14 (6)" for the partner.
export const batterScoreLine = ({ name = "", runs = 0, balls = 0, onStrike = false } = {}) =>
  `${name || "Batter"}${onStrike ? "*" : ""} ${n(runs)} (${n(balls)})`;

export const newBowlerText = (name = "", replacedName = "") => {
  if (!name) return "";
  if (replacedName) return `${name} comes into the attack, replacing ${replacedName}`;
  return `${name} to open the bowling`;
};

export const newBatterText = (name = "", position = 0) => {
  if (!name) return "";
  return position > 0
    ? `${name} comes in next at No. ${position}`
    : `${name} comes in next`;
};

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
    playerIdOf(over?.bowler) ||
      playerIdOf(balls[0]?.bowler) ||
      ""
  );

// Both batters at the crease when the over ended: whoever faced the last ball
// is the striker. A batter dismissed off that last ball is not at the crease,
// so he is left out instead of inventing his replacement.
const creaseBatters = (deliveries, batterTotals) => {
  const last = deliveries[deliveries.length - 1];
  if (!last) return [];
  const dismissedId = last.dismissalId || "";
  const strikerId = playerIdOf(last.ball.batsmanOnStrike);
  const nonStrikerId = playerIdOf(last.ball.batsmanNonStrike);
  const rows = [];

  if (strikerId && strikerId !== dismissedId) rows.push({ id: strikerId, onStrike: true });
  if (nonStrikerId && nonStrikerId !== strikerId && nonStrikerId !== dismissedId) {
    rows.push({ id: nonStrikerId, onStrike: false });
  }

  return rows.map((row) => {
    const totals = batterTotals.get(row.id);
    return {
      id: row.id,
      name: totals?.name || "",
      runs: totals?.runs || 0,
      balls: totals?.balls || 0,
      onStrike: row.onStrike,
    };
  });
};

// The first batter to appear on a later delivery who has not batted yet.
const incomingBatterAfter = (flat, index, appeared) => {
  for (let i = index + 1; i < flat.length; i += 1) {
    const { ball } = flat[i];
    const ids = [playerIdOf(ball.batsmanOnStrike), playerIdOf(ball.batsmanNonStrike)];
    const fresh = ids.find((id) => id && !appeared.has(id));
    if (fresh) return fresh;
  }
  return "";
};

// One pass over the innings builds every over: chips, per-ball plain sentence
// ("Over 14.3"), the end-of-over card (score, chase, both batters, both
// bowlers) and the new-bowler / new-batter event rows. Output is newest first.
//
// options.players     roster used to name ids that carry no name string
// options.target      chase target (0 when there is no chase)
// options.totalOvers  innings length, used for "need X from Y balls"
export function buildPlainOverFeed(overs = [], options = {}) {
  const { players = [], target = 0, totalOvers = 0 } = options || {};

  const playerNames = new Map();
  (players || []).forEach((player) => {
    const id = playerIdOf(player);
    const name = player?.name || player?.fullName || "";
    if (id && name) playerNames.set(id, name);
  });

  const sortedOvers = [...(overs || [])]
    .filter(Boolean)
    .sort((a, b) => overNumberOf(a) - overNumberOf(b));

  const flat = [];
  sortedOvers.forEach((over) => {
    orderedBalls(over.balls || []).forEach((ball) => flat.push({ over, ball }));
  });

  const batterTotals = new Map();
  const battingOrder = [];
  const remember = (id, name) => {
    if (!id) return;
    if (!batterTotals.has(id)) {
      batterTotals.set(id, { id, name: "", runs: 0, balls: 0 });
      battingOrder.push(id);
    }
    const entry = batterTotals.get(id);
    if (!entry.name) entry.name = name || playerNames.get(id) || "";
  };
  flat.forEach(({ ball }) => {
    remember(playerIdOf(ball.batsmanOnStrike), ball.batsmanName);
    remember(playerIdOf(ball.batsmanNonStrike), "");
  });
  const positionOf = new Map(battingOrder.map((id, index) => [id, index + 1]));

  const bowlerTotals = new Map();
  const overBowlers = [];
  const appeared = new Set();
  let score = { runs: 0, wickets: 0 };
  let legalTotal = 0;
  let flatIndex = 0;
  const feed = [];

  sortedOvers.forEach((over) => {
    const overNo = overNumberOf(over);
    const balls = orderedBalls(over.balls || []);
    const bowlerKey = bowlerKeyOf(over, balls);
    const bowlerName =
      over?.bowler?.name || balls[0]?.bowlerName || playerNames.get(bowlerKey) || "";
    const totals = bowlerTotals.get(bowlerKey) || { balls: 0, maidens: 0, runs: 0, wickets: 0 };

    // Ends alternate every over, so the bowler at the other end is the one who
    // bowled the previous over and the replaced bowler is over N-2.
    const sameEnd = [...overBowlers].reverse().find((entry) => entry.overNumber % 2 === overNo % 2);
    const events = [];
    if (bowlerName) {
      const text = sameEnd
        ? sameEnd.key === bowlerKey
          ? ""
          : newBowlerText(bowlerName, sameEnd.name)
        : newBowlerText(bowlerName, "");
      if (text) events.push({ kind: "bowler", label: "New bowler", text });
    }

    let overRuns = 0;
    let overWickets = 0;
    let legalBalls = 0;
    const deliveries = [];

    balls.forEach((ball) => {
      const runs = ballDeliveryRuns(ball);
      const wicket = Boolean(ball.isWicket && !ball.wicketCancelled);
      overRuns += runs;
      score = { runs: score.runs + runs, wickets: score.wickets + (wicket ? 1 : 0) };
      totals.runs += runs;

      const legal = isLegal(ball);
      if (legal) {
        legalBalls += 1;
        totals.balls += 1;
        legalTotal += 1;
      }
      if (wicket) {
        overWickets += 1;
        totals.wickets += 1;
      }

      const strikerId = playerIdOf(ball.batsmanOnStrike);
      const nonStrikerId = playerIdOf(ball.batsmanNonStrike);
      if (strikerId) {
        remember(strikerId, ball.batsmanName);
        appeared.add(strikerId);
        const row = batterTotals.get(strikerId);
        row.runs += ballBatterRuns(ball);
        if (ballFacedByBatter(ball)) row.balls += 1;
      }
      if (nonStrikerId) {
        remember(nonStrikerId, "");
        appeared.add(nonStrikerId);
      }

      const display = legalBalls + (legal ? 0 : 1);
      const delivery = {
        ball,
        label: `${overNo}.${display}`,
        chip: ballChipText(ball),
        tone: ballChipTone(ball),
        text: ballSentence(ball, { bowlerName }),
        wicket,
      };

      if (wicket) {
        const dismissedId = playerIdOf(ball.dismissedPlayer) || strikerId;
        const dismissed = dismissedId ? batterTotals.get(dismissedId) : null;
        delivery.dismissalId = dismissedId;
        delivery.dismissal = dismissalLine({
          name: dismissed?.name || ball.batsmanName || "",
          howOut: howOutText(ball),
          runs: dismissed?.runs || 0,
          balls: dismissed?.balls || 0,
        });
      }

      deliveries.push(delivery);
      events.push({ kind: "ball", delivery });

      if (wicket) {
        const incoming = incomingBatterAfter(flat, flatIndex, appeared);
        const incomingName = incoming ? batterTotals.get(incoming)?.name || "" : "";
        const text = newBatterText(incomingName, positionOf.get(incoming) || 0);
        if (text) events.push({ kind: "batter", label: "New batter", text });
      }

      flatIndex += 1;
    });

    const complete = legalBalls >= 6 || over?.isComplete === true;
    if (complete && overRuns === 0) totals.maidens += 1;
    bowlerTotals.set(bowlerKey, totals);

    const bowlerLine = balls.length
      ? `${formatBowlerOversFromBalls(totals.balls)}-${totals.maidens}-${totals.runs}-${totals.wickets}`
      : "";
    overBowlers.push({ overNumber: overNo, key: bowlerKey, name: bowlerName, line: bowlerLine });

    const bowlers = [];
    if (bowlerName || bowlerLine) {
      bowlers.push({ id: bowlerKey, name: bowlerName, line: bowlerLine, isCurrent: true });
    }
    const previous = overBowlers[overBowlers.length - 2] || null;
    if (previous && previous.key !== bowlerKey && (previous.name || previous.line)) {
      bowlers.push({
        id: previous.key,
        name: previous.name,
        line: previous.line,
        isCurrent: false,
      });
    }

    const chasing = n(target) > 0 && score.runs < n(target);
    const chase = chasing
      ? {
          target: n(target),
          need: n(target) - score.runs,
          ballsLeft:
            n(totalOvers) > 0 ? Math.max(0, n(totalOvers) * 6 - legalTotal) : null,
        }
      : null;
    const chaseText = chase
      ? chase.ballsLeft != null
        ? `Target ${chase.target} · need ${chase.need} from ${plural(chase.ballsLeft, "ball")}`
        : `Target ${chase.target} · need ${chase.need}`
      : "";

    feed.push({
      overNumber: overNo,
      over,
      runs: overRuns,
      wickets: overWickets,
      complete,
      chips: deliveries.map((delivery) => delivery.chip),
      balls: deliveries,
      score: { ...score },
      bowlerName,
      bowlerLine,
      summary: `End of over ${overNo}: ${plural(overRuns, "run")}, ${score.runs}/${score.wickets}`,
      title: `${complete ? "End of over" : "Over"} ${overNo}${complete ? "" : " in progress"}`,
      runsText: plural(overRuns, "run"),
      scoreText: `${score.runs}/${score.wickets}`,
      chase,
      chaseText,
      batters: creaseBatters(deliveries, batterTotals),
      bowlers,
      events,
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
