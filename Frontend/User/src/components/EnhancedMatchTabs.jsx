import React, { useMemo, useState, useEffect } from "react";
import { api } from "../services/api";
import WinProbabilityChart from "./WinProbabilityChart";
import ProjectedScoreWidget from "./ProjectedScoreWidget";
import BoundariesTracker from "./BoundariesTracker";
import PartnershipWheel from "./PartnershipWheel";
import WagonWheel from "./WagonWheel";

const TABS = [
  { id: "live", label: "Live Score" },
  { id: "scorecard", label: "Scorecard" },
  { id: "commentary", label: "Commentary" },
  { id: "stats", label: "Stats" },
  { id: "wagon", label: "Wagon Wheel" },
  { id: "info", label: "Match Info" },
];

const idOf = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return String(value._id || value.id || "");
};

const sameId = (a, b) => idOf(a) && idOf(a) === idOf(b);

const teamName = (team) => team?.shortName || team?.name || "Team";

const longTeamName = (team) => team?.name || team?.shortName || "Team";

const playerName = (player, players = []) => {
  if (!player) return "Unknown";
  if (typeof player === "object" && (player.name || player.fullName)) {
    return player.name || player.fullName;
  }
  const found = players.find((candidate) => sameId(candidate, player));
  return found?.name || found?.fullName || "Unknown";
};

const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const formatOvers = (balls = 0) => `${Math.floor(number(balls) / 6)}.${number(balls) % 6}`;

const formatBowlerOvers = (bowler) => {
  if (!bowler) return "0.0";
  if (number(bowler.balls) > 0) return formatOvers(bowler.balls);
  return `${number(bowler.overs)}.0`;
};

const strikeRate = (runs, balls) => {
  if (!balls) return "0.00";
  return ((number(runs) / number(balls)) * 100).toFixed(2);
};

const economyRate = (runs, balls) => {
  const legalOvers = number(balls) / 6;
  if (!legalOvers) return "0.00";
  return (number(runs) / legalOvers).toFixed(2);
};

const formatDate = (value) => {
  if (!value) return "TBC";
  return new Date(value).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const getTeamById = (match, teamId) =>
  (match?.teams || []).find((team) => sameId(team, teamId)) ||
  (match?.playingXI || []).find((entry) => sameId(entry.team, teamId))?.team ||
  null;

const collectPlayers = (match) => {
  const map = new Map();
  const add = (player) => {
    if (!player || typeof player !== "object") return;
    const key = idOf(player);
    if (key) map.set(key, player);
  };

  (match?.teams || []).forEach((team) => (team.players || []).forEach(add));
  (match?.playingXI || []).forEach((entry) => (entry.players || []).forEach(add));
  (match?.squad15 || []).forEach((entry) => (entry.players || []).forEach(add));
  (match?.innings || []).forEach((innings) => {
    add(innings.currentBatsman1);
    add(innings.currentBatsman2);
    add(innings.onStrikeBatsman);
    add(innings.currentBowler);
    (innings.batting || []).forEach((row) => add(row.player));
    (innings.bowling || []).forEach((row) => add(row.player));
    (innings.oversHistory || []).forEach((over) => {
      add(over.bowler);
      (over.balls || []).forEach((ball) => {
        add(ball.batsmanOnStrike);
        add(ball.batsmanNonStrike);
        add(ball.bowler);
      });
    });
  });

  return Array.from(map.values());
};

const getPlayingXI = (match, teamId) =>
  (match?.playingXI || []).find((entry) => sameId(entry.team, teamId))?.players || [];

const currentInningsOf = (match) => {
  const index = Math.min(number(match?.currentInnings), Math.max((match?.innings || []).length - 1, 0));
  return match?.innings?.[index] || match?.innings?.[0] || null;
};

const statusLabel = (status) => {
  if (status === "innings-break") return "Innings Break";
  if (status === "pending_tie_resolution") return "Tie Break";
  return status ? status.charAt(0).toUpperCase() + status.slice(1) : "Upcoming";
};

const overValue = (balls) => number(balls) / 6;

const getCrr = (innings) => {
  if (!innings) return "0.00";
  if (innings.runRate) return number(innings.runRate).toFixed(2);
  const overs = overValue(innings.balls);
  return overs ? (number(innings.runs) / overs).toFixed(2) : "0.00";
};

const getTarget = (match) => {
  const currentIndex = number(match?.currentInnings);
  const current = match?.innings?.[currentIndex];
  if (current?.target) return number(current.target);
  if (currentIndex > 0 && match?.innings?.[0]) return number(match.innings[0].runs) + 1;
  return 0;
};

const getRrr = (match, innings) => {
  const target = getTarget(match);
  if (!target || number(match?.currentInnings) === 0) return null;
  const remainingRuns = Math.max(target - number(innings?.runs), 0);
  const remainingBalls = Math.max(number(match?.totalOvers) * 6 - number(innings?.balls), 0);
  if (!remainingBalls) return "0.00";
  return ((remainingRuns / remainingBalls) * 6).toFixed(2);
};

const getResultLine = (match) => {
  if (match?.result?.description) return match.result.description;
  if (match?.status === "completed" && match?.result?.winner) {
    return `${longTeamName(match.result.winner)} won${match.result.margin ? ` by ${match.result.margin}` : ""}`;
  }
  return "";
};

const getTossLine = (match) => {
  if (!match?.tossWinner) return "Toss not updated";
  const decision = match.tossDecision === "bowl" ? "bowl" : "bat";
  return `${longTeamName(match.tossWinner)} chose to ${decision}`;
};

const ballRuns = (ball) => number(ball.runs);

const ballLabel = (ball) => {
  if (ball?.isWicket) return "W";
  if (ball?.isWide) return "Wd";
  if (ball?.isNoBall) return "Nb";
  if (ballRuns(ball) === 0) return "•";
  return String(ballRuns(ball));
};

const ballClass = (ball) => {
  if (ball?.isWicket) return "bg-red-600 text-white";
  if (ball?.isWide || ball?.isNoBall) return "bg-orange-100 text-orange-700 ring-1 ring-orange-200";
  if (ballRuns(ball) === 4) return "bg-blue-600 text-white";
  if (ballRuns(ball) === 6) return "bg-purple-600 text-white";
  if (ballRuns(ball) === 0) return "bg-slate-200 text-slate-600";
  return "bg-slate-700 text-white";
};

const ballResultText = (ball) => {
  if (ball?.runText) return ball.runText;
  if (ball?.isWicket) return "OUT!";
  if (ball?.isWide) return "wide";
  if (ball?.isNoBall) return "no ball";
  if (ballRuns(ball) === 0) return "no run";
  if (ballRuns(ball) === 1) return "1 run";
  if (ballRuns(ball) === 4) return "FOUR";
  if (ballRuns(ball) === 6) return "SIX";
  return `${ballRuns(ball)} runs`;
};

const dismissalParts = (row, players) => {
  if (!row?.isOut) {
    if (row?.isRetiredHurt) return { how: "retired hurt", bowler: "" };
    return { how: "not out", bowler: "" };
  }

  const type = (row.dismissalType || row.wicketType || "out").toLowerCase();
  const bowler = playerName(row.dismissedBy, players);
  const fielder = playerName(row.fielder, players);

  if (type === "bowled") return { how: "b", bowler };
  if (type === "caught") return { how: `c ${fielder}`, bowler };
  if (type === "lbw") return { how: "lbw", bowler };
  if (type === "run out") return { how: `run out (${fielder})`, bowler: "" };
  if (type === "stumped") return { how: `st ${fielder}`, bowler };
  if (type === "hit wicket") return { how: "hit wicket", bowler };
  return { how: type, bowler };
};

const flattenCommentary = (innings) =>
  (innings?.oversHistory || [])
    .map((over) => ({
      ...over,
      balls: [...(over.balls || [])].map((ball, index) => ({
        ...ball,
        displayBall: ball.ballNumber || index + 1,
      })),
    }))
    .reverse();

const EnhancedMatchTabs = ({ match }) => {
  const [activeTab, setActiveTab] = useState("live");
  const [selectedInnings, setSelectedInnings] = useState(0);
  const [visibleOvers, setVisibleOvers] = useState(5);

  const players = useMemo(() => collectPlayers(match), [match]);
  const currentInnings = currentInningsOf(match);
  const currentIndex = Math.min(number(match?.currentInnings), Math.max((match?.innings || []).length - 1, 0));
  const battingTeam = getTeamById(match, currentInnings?.team);
  const bowlingTeam = (match?.teams || []).find((team) => !sameId(team, currentInnings?.team));
  const target = getTarget(match);
  const rrr = getRrr(match, currentInnings);
  const selectedInningsData = match?.innings?.[selectedInnings] || currentInnings;
  const selectedBattingTeam = getTeamById(match, selectedInningsData?.team);
  const isLive = match?.status === "live";

  if (!match) return null;

  const strikerId = idOf(currentInnings?.onStrikeBatsman || currentInnings?.currentBatsman1);
  const batterRows = currentInnings?.batting || [];
  const striker = batterRows.find((row) => sameId(row.player, strikerId));
  const partner = batterRows.find(
    (row) =>
      sameId(row.player, currentInnings?.currentBatsman1) ||
      sameId(row.player, currentInnings?.currentBatsman2)
  );
  const nonStriker = batterRows.find(
    (row) =>
      !sameId(row.player, strikerId) &&
      (sameId(row.player, currentInnings?.currentBatsman1) || sameId(row.player, currentInnings?.currentBatsman2))
  ) || (partner && !sameId(partner.player, strikerId) ? partner : null);
  const bowler = (currentInnings?.bowling || []).find((row) => sameId(row.player, currentInnings?.currentBowler));
  const recentOvers = currentInnings?.oversHistory || [];
  const commentaryOvers = flattenCommentary(currentInnings);
  const currentPartnership = (currentInnings?.partnerships || [])[(currentInnings?.partnerships || []).length - 1] || { runs: 0, balls: 0 };

  return (
    <main className="min-h-screen bg-[#eef2f6] text-slate-900">
      <section className="bg-[#07172f] text-white">
        <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-bold uppercase tracking-[0.2em] text-slate-300">
            <span>BQ-PLAY Live Centre</span>
            <span className="flex items-center gap-2">
              {isLive && <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />}
              {statusLabel(match.status)}
            </span>
          </div>
          <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <h1 className="text-2xl font-black tracking-tight sm:text-4xl">
                {longTeamName(match.teams?.[0])} vs {longTeamName(match.teams?.[1])}
              </h1>
              <p className="mt-2 text-sm text-slate-300">{getTossLine(match)}</p>
              {getResultLine(match) && <p className="mt-1 text-sm font-semibold text-amber-300">{getResultLine(match)}</p>}
            </div>
            <div className="rounded-xl bg-white px-5 py-4 text-right text-slate-950 shadow-lg">
              <div className="text-sm font-black uppercase text-slate-500">{longTeamName(battingTeam)}</div>
              <div className="text-4xl font-black tabular-nums">
                {number(currentInnings?.runs)}/{number(currentInnings?.wickets)}
              </div>
              <div className="text-sm font-bold text-slate-500">
                {formatOvers(currentInnings?.balls)} ov
                {target > 0 && <span className="ml-2 text-orange-600">Target {target}</span>}
              </div>
            </div>
          </div>
        </div>
      </section>

      <nav className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-4 py-2 sm:px-6 lg:px-8">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-black transition ${
                activeTab === tab.id ? "bg-[#ff6b35] text-white shadow" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 lg:px-8">
        {activeTab === "live" && (
          <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
            <section className="space-y-4">
              <ScoreSummary
                innings={currentInnings}
                battingTeam={battingTeam}
                bowlingTeam={bowlingTeam}
                crr={getCrr(currentInnings)}
                rrr={rrr}
                target={target}
                totalOvers={match.totalOvers}
                partnership={currentPartnership}
              />
              <CurrentPlayers
                striker={striker}
                nonStriker={nonStriker}
                bowler={bowler}
                strikerId={strikerId}
                players={players}
              />
              <RecentBalls overs={recentOvers} />
            </section>
            <aside className="space-y-4">
              <MiniInfo match={match} />
              <CommentaryPreview overs={commentaryOvers} players={players} onSwitchTab={setActiveTab} />
            </aside>
          </div>
        )}

        {activeTab === "scorecard" && (
          <ScorecardTab
            match={match}
            innings={selectedInningsData}
            selectedInnings={selectedInnings}
            setSelectedInnings={setSelectedInnings}
            battingTeam={selectedBattingTeam}
            players={players}
          />
        )}

        {activeTab === "commentary" && (
          <CommentaryTab
            overs={commentaryOvers}
            players={players}
            visibleOvers={visibleOvers}
            onLoadMore={() => setVisibleOvers((value) => value + 5)}
          />
        )}

        {activeTab === "info" && <MatchInfoTab match={match} />}

        {activeTab === "stats" && <StatsTab match={match} players={players} />}

        {activeTab === "wagon" && <WagonWheelTab match={match} players={players} />}
      </div>
    </main>
  );
};

function ScoreSummary({ innings, battingTeam, bowlingTeam, crr, rrr, target, totalOvers, partnership }) {
  const required = target ? Math.max(target - number(innings?.runs), 0) : 0;

  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.18em] text-orange-600">Live Score</div>
          <h2 className="mt-2 text-xl font-black">{longTeamName(battingTeam)}</h2>
          <p className="text-sm text-slate-500">Batting against {longTeamName(bowlingTeam)}</p>
        </div>
        <div className="text-right">
          <div className="text-4xl font-black tabular-nums">{number(innings?.runs)}/{number(innings?.wickets)}</div>
          <div className="text-sm font-bold text-slate-500">{formatOvers(innings?.balls)} / {totalOvers || 0} ov</div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Metric label="CRR" value={crr} />
        <Metric label="RRR" value={rrr || "-"} />
        <Metric label="Target" value={target || "-"} />
        <Metric label="Need" value={target ? `${required}` : "-"} />
        <Metric label="Partnership" value={`${number(partnership?.runs)} (${number(partnership?.balls)}b)`} />
      </div>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-black tabular-nums">{value}</div>
    </div>
  );
}

function PlayerLine({ row, label, players, active }) {
  const name = playerName(row?.player, players);
  return (
    <div className={`rounded-lg border p-3 ${active ? "border-orange-300 bg-orange-50" : "border-slate-200 bg-white"}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</div>
          <div className="font-black">{name}{active ? " ✦" : ""}</div>
        </div>
        <div className="text-right font-black tabular-nums">{number(row?.runs)} ({number(row?.balls)})</div>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2 text-center text-xs font-bold text-slate-500">
        <span>4s {number(row?.fours)}</span>
        <span>6s {number(row?.sixes)}</span>
        <span className="col-span-2">SR {strikeRate(row?.runs, row?.balls)}</span>
      </div>
    </div>
  );
}

function CurrentPlayers({ striker, nonStriker, bowler, strikerId, players }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h3 className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Current Batsmen</h3>
        <div className="mt-3 space-y-3">
          <PlayerLine row={striker} label="On strike" players={players} active={sameId(striker?.player, strikerId)} />
          <PlayerLine row={nonStriker} label="Non-striker" players={players} />
        </div>
      </div>
      <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h3 className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Current Bowler</h3>
        <div className="mt-3 rounded-lg bg-slate-50 p-3">
          <div className="font-black">{playerName(bowler?.player, players)}</div>
          <div className="mt-3 grid grid-cols-5 gap-2 text-center text-sm">
            <MetricSmall label="O" value={formatBowlerOvers(bowler)} />
            <MetricSmall label="M" value={number(bowler?.maidens)} />
            <MetricSmall label="R" value={number(bowler?.runs)} />
            <MetricSmall label="W" value={number(bowler?.wickets)} />
            <MetricSmall label="Econ" value={bowler?.economy || economyRate(bowler?.runs, bowler?.balls)} />
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricSmall({ label, value }) {
  return (
    <div>
      <div className="text-[10px] font-black uppercase text-slate-400">{label}</div>
      <div className="font-black tabular-nums">{value}</div>
    </div>
  );
}

function RecentBalls({ overs }) {
  const [overOffset, setOverOffset] = useState(0);
  const safeOvers = overs || [];
  const maxOffset = Math.max(safeOvers.length - 1, 0);
  const windowEnd = Math.max(safeOvers.length - overOffset, 0);
  const windowStart = Math.max(windowEnd - 4, 0);
  const visibleOvers = safeOvers.slice(windowStart, windowEnd);
  const visibleBalls = visibleOvers
    .flatMap((over) => (over.balls || []).map((ball) => ({ ...ball, overNumber: over.overNumber, overRuns: over.runsScored })))
    .slice(-18);

  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Recent Balls</h3>
        <div className="flex gap-2">
          <button type="button" onClick={() => setOverOffset((value) => Math.min(value + 1, maxOffset))} className="rounded bg-slate-100 px-2 py-1 text-xs font-black text-slate-600">&lt;</button>
          <button type="button" onClick={() => setOverOffset((value) => Math.max(value - 1, 0))} className="rounded bg-slate-100 px-2 py-1 text-xs font-black text-slate-600">&gt;</button>
        </div>
      </div>
      <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
        {visibleBalls.length ? (
          visibleBalls.map((ball, index) => {
            const showSeparator = index === 0 || visibleBalls[index - 1]?.overNumber !== ball.overNumber;
            return (
              <React.Fragment key={ball._id || `${ball.overNumber}-${index}`}>
                {showSeparator && (
                  <span className="flex min-w-fit items-center rounded bg-slate-100 px-2 py-1 text-[11px] font-black text-slate-600">
                    {number(ball.overNumber) + 1} ({number(ball.overRuns)})
                  </span>
                )}
                <span className={`flex h-9 min-w-9 items-center justify-center rounded-full px-2 text-xs font-black ${ballClass(ball)}`}>
                  {ballLabel(ball)}
                </span>
              </React.Fragment>
            );
          })
        ) : (
          <p className="text-sm text-slate-500">No balls recorded yet.</p>
        )}
      </div>
    </div>
  );
}

function CommentaryPreview({ overs, players, onSwitchTab }) {
  const allBalls = overs.flatMap((over) => over.balls.map((ball) => ({ ball, over })));
  const latestBall = allBalls[0];
  const recentBalls = allBalls.slice(0, 3);
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Latest Commentary</h3>
        {onSwitchTab && (
          <button
            type="button"
            onClick={() => onSwitchTab("commentary")}
            className="text-[10px] font-black uppercase tracking-widest text-orange-600 hover:underline"
          >
            View All
          </button>
        )}
      </div>
      {latestBall ? (
        <div className="mt-3 space-y-3">
          {recentBalls.map(({ ball, over }, idx) => (
            <CommentaryBall key={ball._id || `${over.overNumber}-${idx}`} over={over} ball={ball} players={players} compact />
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-500">Commentary will appear here after the first ball.</p>
      )}
    </div>
  );
}

function MiniInfo({ match }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <h3 className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Match Info</h3>
      <dl className="mt-3 space-y-2 text-sm">
        <InfoRow label="Venue" value={match.venue || "TBC"} />
        <InfoRow label="Date" value={formatDate(match.startAt)} />
        <InfoRow label="Type" value={match.matchType || "T20"} />
        <InfoRow label="Toss" value={getTossLine(match)} />
      </dl>
    </div>
  );
}

function ScorecardTab({ match, innings, selectedInnings, setSelectedInnings, battingTeam, players }) {
  const extras = innings?.extras || {};
  const totalExtras = number(extras.total) || number(extras.wides) + number(extras.noBalls) + number(extras.byes) + number(extras.legByes) + number(extras.penalties);
  const battingIds = new Set((innings?.batting || []).map((row) => idOf(row.player)));
  const dnb = getPlayingXI(match, innings?.team).filter((player) => !battingIds.has(idOf(player)));

  return (
    <section className="space-y-4">
      <div className="flex gap-2 overflow-x-auto">
        {(match.innings || []).map((inn, index) => {
          const team = getTeamById(match, inn.team);
          return (
            <button
              type="button"
              key={inn._id || index}
              onClick={() => setSelectedInnings(index)}
              className={`rounded-lg px-4 py-2 text-sm font-black ${
                selectedInnings === index ? "bg-[#07172f] text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"
              }`}
            >
              {teamName(team)} innings
            </button>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
          <h2 className="font-black">{longTeamName(battingTeam)}</h2>
          <div className="font-black tabular-nums">{number(innings?.runs)}/{number(innings?.wickets)} ({formatOvers(innings?.balls)} ov)</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-widest text-slate-500">
              <tr>
                <th className="px-4 py-3">Batter</th>
                <th className="px-4 py-3">How Out</th>
                <th className="px-4 py-3">Bowler</th>
                <th className="px-3 py-3 text-right">R</th>
                <th className="px-3 py-3 text-right">B</th>
                <th className="px-3 py-3 text-right">4s</th>
                <th className="px-3 py-3 text-right">6s</th>
                <th className="px-4 py-3 text-right">SR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(innings?.batting || []).map((row) => {
                const dismissal = dismissalParts(row, players);
                return (
                  <tr key={idOf(row.player)} className={!row.isOut ? "border-l-4 border-l-emerald-500" : ""}>
                    <td className="px-4 py-3 font-black">{playerName(row.player, players)}</td>
                    <td className="px-4 py-3 text-slate-500">{dismissal.how}</td>
                    <td className="px-4 py-3 text-slate-500">{dismissal.bowler}</td>
                    <td className="px-3 py-3 text-right font-black">{number(row.runs)}</td>
                    <td className="px-3 py-3 text-right">{number(row.balls)}</td>
                    <td className="px-3 py-3 text-right">{number(row.fours)}</td>
                    <td className="px-3 py-3 text-right">{number(row.sixes)}</td>
                    <td className="px-4 py-3 text-right">{row.strikeRate ? number(row.strikeRate).toFixed(2) : strikeRate(row.runs, row.balls)}</td>
                  </tr>
                );
              })}
              <tr className="bg-slate-50 font-bold">
                <td className="px-4 py-3">Extras</td>
                <td className="px-4 py-3 text-slate-500" colSpan={2}>
                  w {number(extras.wides)}, nb {number(extras.noBalls)}, b {number(extras.byes)}, lb {number(extras.legByes)}
                </td>
                <td className="px-3 py-3 text-right font-black">{totalExtras}</td>
                <td colSpan={4} />
              </tr>
              <tr className="bg-slate-100 font-black">
                <td className="px-4 py-3">Total</td>
                <td className="px-4 py-3" colSpan={2}>{formatOvers(innings?.balls)} Ov (RR: {getCrr(innings)})</td>
                <td className="px-3 py-3 text-right">{number(innings?.runs)}/{number(innings?.wickets)}</td>
                <td colSpan={4} />
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <InfoBlock title="Fall of Wickets">
        {(innings?.fallOfWickets || []).length
          ? innings.fallOfWickets.map((wicket) => `${wicket.wickets}-${wicket.runs} (${playerName(wicket.player, players)}, ${number(wicket.overs).toFixed(1)} ov)`).join(", ")
          : "No wickets yet"}
      </InfoBlock>

      <InfoBlock title="Did Not Bat">
        {dnb.length ? dnb.map((player) => playerName(player, players)).join(", ") : "All listed batters have appeared"}
      </InfoBlock>

      <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 font-black">Bowling</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-widest text-slate-500">
              <tr>
                <th className="px-4 py-3">Bowler</th>
                <th className="px-3 py-3 text-right">O</th>
                <th className="px-3 py-3 text-right">M</th>
                <th className="px-3 py-3 text-right">R</th>
                <th className="px-3 py-3 text-right">W</th>
                <th className="px-3 py-3 text-right">Econ</th>
                <th className="px-3 py-3 text-right">WD</th>
                <th className="px-4 py-3 text-right">NB</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(innings?.bowling || []).map((row) => (
                <tr key={idOf(row.player)}>
                  <td className="px-4 py-3 font-black">{playerName(row.player, players)}</td>
                  <td className="px-3 py-3 text-right">{formatBowlerOvers(row)}</td>
                  <td className="px-3 py-3 text-right">{number(row.maidens)}</td>
                  <td className="px-3 py-3 text-right">{number(row.runs)}</td>
                  <td className="px-3 py-3 text-right font-black">{number(row.wickets)}</td>
                  <td className="px-3 py-3 text-right">{row.economy || economyRate(row.runs, row.balls)}</td>
                  <td className="px-3 py-3 text-right">{number(row.wides)}</td>
                  <td className="px-4 py-3 text-right">{number(row.noBalls)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function CommentaryTab({ overs, players, visibleOvers, onLoadMore }) {
  const visible = overs.slice(0, visibleOvers);
  return (
    <section className="space-y-4">
      {visible.length ? visible.map((over) => (
        <div key={over._id || over.overNumber} className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-4 py-3">
            <div className="text-xs font-black uppercase tracking-widest text-slate-500">
              Over {number(over.overNumber) + 1} - {playerName(over.bowler, players)}
            </div>
            <div className="font-black text-orange-600">{number(over.runsScored)} runs, {number(over.wickets)} wkts</div>
          </div>
          <div className="divide-y divide-slate-100">
            {(over.balls || []).slice().reverse().map((ball, index) => (
              <CommentaryBall key={ball._id || index} over={over} ball={ball} players={players} />
            ))}
          </div>
        </div>
      )) : <div className="rounded-xl bg-white p-6 text-slate-500 shadow-sm ring-1 ring-slate-200">No commentary yet.</div>}

      {overs.length > visibleOvers && (
        <button
          type="button"
          onClick={onLoadMore}
          className="w-full rounded-xl bg-[#07172f] px-4 py-3 font-black text-white"
        >
          Load more commentary
        </button>
      )}
    </section>
  );
}

function CommentaryBall({ over, ball, players, compact = false }) {
  const overText = `${number(over.overNumber)}.${ball.displayBall || ball.ballNumber || 1}`;
  const bowler = ball.bowlerName || playerName(ball.bowler || over.bowler, players);
  const batsman = ball.batsmanName || playerName(ball.batsmanOnStrike, players);
  const text = ball.vividCommentary || ball.commentary || "Played into the field.";
  return (
    <div className={`flex gap-3 ${compact ? "mt-3" : "p-4"}`}>
      <div className="w-12 shrink-0 text-sm font-black tabular-nums text-slate-500">{overText}</div>
      <div className={`flex h-9 min-w-9 shrink-0 items-center justify-center rounded-full px-2 text-xs font-black ${ballClass(ball)}`}>
        {ballLabel(ball)}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-bold">
          {overText} {bowler} to {batsman}, {ballResultText(ball)}.
        </p>
        <p className="mt-1 text-sm leading-6 text-slate-600">{text}</p>
      </div>
    </div>
  );
}

function MatchInfoTab({ match }) {
  const weather = match.weather?.condition
    ? `${match.weather.condition}${match.weather.temperature ? `, ${match.weather.temperature}C` : ""}`
    : "Not available";
  const umpires = (match.umpires || []).map((umpire) => `${umpire.name}${umpire.role ? ` (${umpire.role})` : ""}`).join(", ");
  const address = match.address
    ? [match.address.town, match.address.district, match.address.city, match.address.province, match.address.country].filter(Boolean).join(", ")
    : "";

  return (
    <section className="grid gap-4 md:grid-cols-2">
      <InfoCard title="Match Details">
        <InfoRow label="Venue" value={match.venue || "TBC"} />
        <InfoRow label="Address" value={address || "Not available"} />
        <InfoRow label="Date" value={formatDate(match.startAt)} />
        <InfoRow label="Match Type" value={match.matchType || "T20"} />
        <InfoRow label="Category" value={[match.matchCategory || match.category, match.subCategory, match.ageGroup].filter(Boolean).join(" - ")} />
      </InfoCard>
      <InfoCard title="Officials & Conditions">
        <InfoRow label="Toss" value={getTossLine(match)} />
        <InfoRow label="Umpires" value={umpires || "Not available"} />
        <InfoRow label="Series" value={match.series || "Not available"} />
        <InfoRow label="Weather" value={weather} />
        <InfoRow label="Status" value={statusLabel(match.status)} />
      </InfoCard>
      {(match.teams || []).map((team) => (
        <InfoCard key={idOf(team)} title={`${longTeamName(team)} Playing XI`}>
          <p className="text-sm leading-7 text-slate-700">
            {getPlayingXI(match, team).map((player) => playerName(player)).join(", ") || "Playing XI not announced"}
          </p>
        </InfoCard>
      ))}
    </section>
  );
}

function InfoCard({ title, children }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <h2 className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-slate-500">{title}</h2>
      <dl className="space-y-2">{children}</dl>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 text-sm">
      <dt className="font-bold text-slate-500">{label}</dt>
      <dd className="font-semibold text-slate-800">{value || "Not available"}</dd>
    </div>
  );
}

function InfoBlock({ title, children }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <h3 className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-700">{children}</p>
    </div>
  );
}

function StatsTab({ match, players }) {
  const [analytics, setAnalytics] = useState(null);
  const [partnerships, setPartnerships] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [analyticsRes, partnershipsRes] = await Promise.all([
          api.get(`/matches/${match._id}/analytics`),
          api.get(`/matches/${match._id}/partnerships/${match.currentInnings + 1}`)
        ]);
        setAnalytics(analyticsRes.data);
        setPartnerships(partnershipsRes.data || []);
      } catch (err) {
        console.error("Failed to load stats:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [match._id, match.currentInnings]);

  const inning1 = match.innings?.[0];
  const inning2 = match.innings?.[1];
  const isSecondInnings = match.currentInnings === 1;

  if (loading) {
    return <div className="p-8 text-center text-slate-500">Loading stats...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2">
        {isSecondInnings && analytics?.inning2WinProbBattingTeam ? (
          <WinProbabilityChart
            winProbHistory={analytics?.winProbHistory || []}
            currentBattingProb={analytics.inning2WinProbBattingTeam}
            currentBowlingProb={analytics.inning2WinProbBowlingTeam}
            battingTeamName={inning2?.team?.name || "Batting"}
            bowlingTeamName={inning1?.team?.name || "Bowling"}
          />
        ) : (
          analytics && (
            <ProjectedScoreWidget
              currentScore={inning1?.runs || 0}
              currentWickets={inning1?.wickets || 0}
              currentOvers={(inning1?.overs || 0) + (inning1?.balls || 0) / 6}
              projectedScore={analytics?.inning1ProjectedScore || 0}
              rangeLow={analytics?.inning1ProjectedRangeLow || 0}
              rangeHigh={analytics?.inning1ProjectedRangeHigh || 0}
              projectionHistory={analytics?.inning1ProjectionHistory || []}
            />
          )
        )}
        <BoundariesTracker
          inning1={{
            fours: analytics?.totalFoursInning1 || 0,
            sixes: analytics?.totalSixesInning1 || 0,
            boundaryRuns: analytics?.boundaryRunsInning1 || 0,
            totalRuns: inning1?.runs || 0
          }}
          inning2={{
            fours: analytics?.totalFoursInning2 || 0,
            sixes: analytics?.totalSixesInning2 || 0,
            boundaryRuns: analytics?.boundaryRunsInning2 || 0,
            totalRuns: inning2?.runs || 0
          }}
          total={{
            fours: (analytics?.totalFoursInning1 || 0) + (analytics?.totalFoursInning2 || 0),
            sixes: (analytics?.totalSixesInning1 || 0) + (analytics?.totalSixesInning2 || 0),
            boundaryRuns: (analytics?.boundaryRunsInning1 || 0) + (analytics?.boundaryRunsInning2 || 0)
          }}
        />
      </div>

      <PartnershipWheel
        partnerships={partnerships}
        totalScore={inning1?.runs || 0}
      />
    </div>
  );
}

function WagonWheelTab({ match, players }) {
  const [shots, setShots] = useState([]);
  const [selectedBatsman, setSelectedBatsman] = useState(null);
  const [loading, setLoading] = useState(true);

  const currentInnings = match.innings?.[match.currentInnings];
  const battingPlayers = currentInnings?.batting || [];

  useEffect(() => {
    const fetchShots = async () => {
      try {
        const url = selectedBatsman
          ? `/matches/${match._id}/wagon-wheel/${match.currentInnings + 1}/${selectedBatsman}`
          : `/matches/${match._id}/wagon-wheel/${match.currentInnings + 1}`;
        const res = await api.get(url);
        setShots(res.data || []);
      } catch (err) {
        console.error("Failed to load wagon wheel:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchShots();
  }, [match._id, match.currentInnings, selectedBatsman]);

  if (loading) {
    return <div className="p-8 text-center text-slate-500">Loading wagon wheel...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <label className="text-sm font-medium text-slate-600">Filter by Batsman:</label>
        <select
          value={selectedBatsman || ""}
          onChange={(e) => setSelectedBatsman(e.target.value || null)}
          className="px-4 py-2 rounded-lg border border-slate-300 text-sm"
        >
          <option value="">All Batsmen</option>
          {battingPlayers.map((b) => (
            <option key={b.player?._id || b.player} value={b.player?._id || b.player}>
              {playerName(b.player, players)}
            </option>
          ))}
        </select>
      </div>

      <WagonWheel 
        shots={shots.map(s => {
          const distVal = typeof s.distance === 'number' ? s.distance :
            s.distance === 'boundary' || s.distance === 'six' ? 90 :
            s.distance === 'outfield' ? 60 : 30;
          return {
            runs: s.runs,
            angle: s.direction,
            distance: distVal,
            position: s.position
          };
        })}
        playerName={selectedBatsman ? battingPlayers.find(p => (p.player?._id || p.player) === selectedBatsman)?.player?.name : "All Shots"}
      />
    </div>
  );
}

export default EnhancedMatchTabs;
