export const PRIMARY_TABS = [
  { id: "live", label: "Live" },
  { id: "scorecard", label: "Scorecard" },
  { id: "commentary", label: "Commentary" },
  { id: "partnerships", label: "Partnerships" },
  { id: "graphs", label: "Graphs" },
  { id: "info", label: "Info" },
];

export const MORE_TABS = [
  { id: "playing-xi", label: "Playing XI" },
  { id: "overs", label: "Overs" },
  { id: "live-stats", label: "Live Stats" },
  { id: "wagon", label: "Wagon Wheel" },
  { id: "stats", label: "Analytics" },
  { id: "summary", label: "Summary" },
];

export const TABS = [...PRIMARY_TABS, ...MORE_TABS];

export const idOf = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return String(value._id || value.id || "");
};

export const sameId = (a, b) => idOf(a) && idOf(a) === idOf(b);

export const teamName = (team) => team?.shortName || team?.name || "Team";

export const longTeamName = (team) => team?.name || team?.shortName || "Team";

export const playerName = (player, players = []) => {
  if (!player) return "Unknown";
  if (typeof player === "object" && (player.name || player.fullName)) {
    return player.name || player.fullName;
  }
  const found = players.find((candidate) => sameId(candidate, player));
  return found?.name || found?.fullName || "Unknown";
};

export const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const formatOvers = (balls = 0) => `${Math.floor(number(balls) / 6)}.${number(balls) % 6}`;

export const isIllegalDelivery = (ball) => !!(ball?.isWide || ball?.isNoBall);

export const withDisplayBallNumbers = (balls = []) => {
  let legalBalls = 0;
  return balls.map((ball) => {
    const displayBall = ball?.displayBallNumber || ball?.legalBallNumber || legalBalls + 1;
    if (!isIllegalDelivery(ball)) legalBalls += 1;
    return { ...ball, displayBall };
  });
};

export const formatBowlerOvers = (bowler) => {
  if (!bowler) return "0.0";
  if (number(bowler.balls) > 0) return formatOvers(bowler.balls);
  return `${number(bowler.overs)}.0`;
};

export const strikeRate = (runs, balls) => {
  if (!balls) return "0.00";
  return ((number(runs) / number(balls)) * 100).toFixed(2);
};

export const economyRate = (runs, balls) => {
  const legalOvers = number(balls) / 6;
  if (!legalOvers) return "0.00";
  return (number(runs) / legalOvers).toFixed(2);
};

export const formatDate = (value) => {
  if (!value) return "TBC";
  try {
    return new Date(value).toLocaleDateString("en-US", {
      weekday: "short", year: "numeric", month: "short", day: "numeric",
    });
  } catch { return "Invalid Date"; }
};

export const getTeamById = (match, teamId) => {
  if (!match?.teams) return null;
  return match.teams.find((t) => sameId(t, teamId)) || null;
};

export const collectPlayers = (match) => {
  if (!match?.teams) return [];
  const all = [];
  match.teams.forEach((team) => {
    if (team?.players) {
      team.players.forEach((p) => {
        if (!all.some((existing) => sameId(existing, p))) {
          all.push(p);
        }
      });
    }
  });
  return all;
};

export const getPlayingXI = (match, teamId) => {
  if (!match?.playingXI) return [];
  const entry = match.playingXI.find((p) => sameId(p.team, teamId));
  return entry?.players || [];
};

export const currentInningsOf = (match) => {
  if (!match?.innings) return null;
  const idx = match.currentInnings;
  return match.innings[idx] || null;
};

export const statusLabel = (match) => {
  if (!match) return "";
  if (match.status === "live") return "LIVE";
  if (match.status === "completed") return "COMPLETED";
  if (match.status === "innings_break" || match.status === "innings-break") return "INNINGS BREAK";
  return (match.status || "UPCOMING").toUpperCase();
};

export const statusKey = (match) => {
  if (!match) return "default";
  if (match.status === "live") return "live";
  if (match.status === "completed") return "completed";
  if (match.status?.startsWith("innings")) return "innings_break";
  return "default";
};

export const currentInningsNumber = (match) => {
  if (!match?.innings) return 1;
  const inningsIndex = match.currentInnings ?? 0;
  return inningsIndex + 1;
};

export const countdownText = (startAt) => {
  if (!startAt) return "";
  try {
    const diff = new Date(startAt).getTime() - Date.now();
    if (diff <= 0) return "";
    const d = Math.floor(diff / (1000 * 60 * 60 * 24));
    const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    if (d > 0) return `Starts in ${d}d ${h}h`;
    return `Starts in ${h}h`;
  } catch { return ""; }
};

export const getMatchBanner = (match) => {
  if (!match) return "";
  const status = match.status;
  if (status === "live") return "This match is currently in progress";
  if (status === "completed") return "This match has ended";
  if (status === "innings_break") return "Innings Break";
  return "Match has not started yet";
};

// Overs as a decimal number. The two fields are the SAME quantity in different
// units (`balls` is the legal-ball count, `overs` its floor), so adding them
// double-counted every innings: a 199/4 innings saved as overs:15, balls:90 was
// treated as 30 overs and the scorecard printed RR 6.63 instead of 13.27.
// Prefer `balls` (exact, no rounding) and fall back to `overs` when it is absent.
export const overValue = (innings) => {
  if (!innings) return 0;
  const balls = number(innings.balls);
  if (balls > 0) return balls / 6;
  return number(innings.overs);
};

export const getCrr = (innings) => {
  if (!innings) return "0.00";
  const ov = overValue(innings);
  return ov > 0 ? (number(innings.runs) / ov).toFixed(2) : "0.00";
};

export const getTarget = (innings) => {
  if (!innings) return null;
  return innings.target || null;
};

export const getRrr = (innings) => {
  if (!innings?.target) return null;
  return innings.requiredRunRate?.toFixed(2) || "0.00";
};

export const getResultLine = (match) => {
  if (!match?.result?.description) return "";
  return match.result.description;
};

export const getTossLine = (match) => {
  if (!match?.tossWinner) return "";
  const winner =
    typeof match.tossWinner === "object"
      ? match.tossWinner.shortName || match.tossWinner.name
      : getTeamById(match, match.tossWinner)?.shortName ||
        getTeamById(match, match.tossWinner)?.name ||
        "Unknown";
  return `${winner} won the toss & chose to ${match.tossDecision || "bat"}`;
};

export const ballRuns = (ball) => {
  if (ball.isWide || ball.isNoBall) return 1;
  return number(ball.runs);
};

export const ballLabel = (ball) => {
  if (ball?.wicketCancelled) return "Nb";
  if (ball?.isWicket) return "W";
  if (ball?.isWide) return "Wd";
  if (ball?.isNoBall) return "Nb";
  if (ball?.runs === 0) return "\u2022";
  if (ball?.runs === 4) return "4";
  if (ball?.runs === 6) return "6";
  return String(ball?.runs || 0);
};

export const ballClass = (ball) => {
  if (ball?.wicketCancelled) return "bg-orange-600 text-white ring-2 ring-red-400";
  if (ball?.isWicket) return "bg-red-600 text-white";
  if (ball?.isWide || ball?.isNoBall) return "bg-orange-500 text-white";
  if (ball?.runs === 6) return "bg-purple-600 text-white";
  if (ball?.runs === 4) return "bg-blue-600 text-white";
  if ((ball?.runs || 0) > 0) return "bg-slate-700 text-white";
  return "bg-slate-300 text-slate-700";
};

export const ballResultText = (ball) => {
  if (ball?.runText) return ball.runText;
  if (ball?.wicketCancelled) return "no ball, wicket cancelled";
  if (ball?.isWicket) return "OUT!";
  if (ball?.isWide) return "wide";
  if (ball?.isNoBall) return "no ball";
  if (ball?.runs === 0) return "no run";
  if (ball?.runs === 4) return "FOUR";
  if (ball?.runs === 6) return "SIX";
  return `${ball?.runs || 0} runs`;
};

export const labelize = (value) =>
  String(value || "")
    .replace(/_/g, "-")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

export const TAG_COLORS = {
  "line-length": "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-700",
  movement: "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-700",
  shot: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-200 dark:border-green-700",
  direction: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-700",
  default: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600",
};

export const ballDataPoints = (ball) => {
  const points = [];
  const lineLen = (ball?.pitchLength || ball?.pitchZone) || ball?.pitchLine
    ? `${ball.pitchLength || ball.pitchZone || ""}${(ball.pitchLength || ball.pitchZone) && ball.pitchLine ? " \u2022 " : ""}${ball.pitchLine || ""}`
    : "";
  if (lineLen) points.push({ label: labelize(lineLen), type: "line-length" });
  if (ball?.ballMovement && ball.ballMovement !== "none")
    points.push({ label: labelize(ball.ballMovement), type: "movement" });
  const shot = ball?.shotTypeName || ball?.shotType || ball?.pitchShotType || "";
  if (shot) points.push({ label: labelize(shot), type: "shot" });
  const dir = ball?.shotDirection || ball?.fieldingZone || ball?.nearestPosition || ball?.regionName || ball?.zone || "";
  if (dir) points.push({ label: labelize(dir), type: "direction" });
  return points;
};

export const overRunsAndWickets = (over) => {
  const balls = over?.balls || [];
  const runs = balls.reduce((sum, ball) => sum + (ball.runs || 0) + (ball.isWide || ball.isNoBall ? 1 : 0), 0);
  const wickets = balls.filter(ball => ball.isWicket).length;
  return { runs, wickets };
};

export const dismissalParts = (dismissal) => {
  if (!dismissal) return { how: "", who: "" };
  if (typeof dismissal === "string") return { how: dismissal, who: "" };
  return {
    how: dismissal.dismissalType || dismissal.type || "",
    who: dismissal.fielder || dismissal.bowler || dismissal.dismissedBy || "",
  };
};

export const ordinal = (n) => {
  if (!n) return "";
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

export const flattenCommentary = (match) => {
  const allBalls = [];
  if (!match?.innings) return allBalls;
  match.innings.forEach((innings) => {
    innings?.oversHistory?.forEach((over) => {
      const overNum = over.overNumber;
      let legalBalls = 0;
      (over.balls || []).forEach((ball) => {
        const displayBall = ball.displayBallNumber || ball.legalBallNumber || legalBalls + 1;
        allBalls.push({
          overNumber: overNum,
          ballNumber: displayBall,
          over: `${overNum}.${displayBall}`,
          ...ball,
        });
        if (!isIllegalDelivery(ball)) legalBalls += 1;
      });
    });
  });
  allBalls.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
  return allBalls;
};
