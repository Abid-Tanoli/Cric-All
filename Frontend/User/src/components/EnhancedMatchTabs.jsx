import React, { useMemo, useState, useEffect } from "react";
import { api } from "../services/api";
import WinProbabilityChart from "./WinProbabilityChart";
import ProjectedScoreWidget from "./ProjectedScoreWidget";
import BoundariesTracker from "./BoundariesTracker";
import PartnershipWheel from "./PartnershipWheel";
import WagonWheel from "./WagonWheel";
import SpikeGraph from "./SpikeGraph";
import ManhattanGraph from "./ManhattanGraph";
import WormGraph from "./WormGraph";
import RunRateGraph from "./RunRateGraph";
import WagonZone from "./WagonZone";
import Commentary from "./Commentary";
import PlayingXI from "./PlayingXI";
import Overs from "./Overs";
import LiveStats from "./LiveStats";

const TABS = [
  { id: "live", label: "Live" },
  { id: "scorecard", label: "Scorecard" },
  { id: "commentary", label: "Commentary" },
  { id: "playing-xi", label: "Playing XI" },
  { id: "overs", label: "Overs" },
  { id: "live-stats", label: "Live Stats" },
  { id: "partnerships", label: "Partnerships" },
  { id: "wagon", label: "Wagon Wheel" },
  { id: "graphs", label: "Graphs" },
  { id: "stats", label: "Analytics" },
  { id: "summary", label: "Summary" },
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
  if (ball?.isLegBye) return "LB";
  if (ball?.isBye) return "B";
  if (ballRuns(ball) === 0) return "•";
  return String(ballRuns(ball));
};

const ballClass = (ball) => {
  if (ball?.isWicket) return "bg-red-600 text-white";
  if (ball?.isWide || ball?.isNoBall || ball?.isLegBye || ball?.isBye) return "bg-orange-100 text-orange-700 ring-1 ring-orange-200";
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
  if (ball?.isLegBye) return "leg bye";
  if (ball?.isBye) return "bye";
  if (ballRuns(ball) === 0) return "no run";
  if (ballRuns(ball) === 1) return "1 run";
  if (ballRuns(ball) === 4) return "FOUR";
  if (ballRuns(ball) === 6) return "SIX";
  return `${ballRuns(ball)} runs`;
};

const labelize = (value) =>
  String(value || "")
    .replace(/_/g, "-")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const ballMetaItems = (ball) =>
  [
    ball?.pitchZone || ball?.pitchLength ? `Length: ${labelize(ball.pitchZone || ball.pitchLength)}` : "",
    ball?.pitchLine ? `Line: ${labelize(ball.pitchLine)}` : "",
    ball?.ballMovement && ball.ballMovement !== "none" ? `Movement: ${labelize(ball.ballMovement)}` : "",
    ball?.ballOutcome && ball.ballOutcome !== "played" ? `Outcome: ${labelize(ball.ballOutcome)}` : "",
    ball?.fieldingZone || ball?.nearestPosition || ball?.regionName || ball?.zone
      ? `Area: ${labelize(ball.fieldingZone || ball.nearestPosition || ball.regionName || ball.zone)}`
      : "",
    ball?.shotType || ball?.pitchShotType ? `Shot: ${labelize(ball.shotType || ball.pitchShotType)}` : "",
  ].filter(Boolean);

const overRunsAndWickets = (over) => {
  const balls = over?.balls || [];
  const fallbackRuns = balls.reduce((sum, ball) => sum + number(ball.runs) + (ball.isWide || ball.isNoBall ? 1 : 0), 0);
  const fallbackWickets = balls.filter((ball) => ball.isWicket).length;
  return {
    runs: number(over?.runsScored, fallbackRuns),
    wickets: number(over?.wickets, fallbackWickets),
  };
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

const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
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

const SummaryTab = ({ match, allPlayers }) => {
  const computeMVP = () => {
    const scores = {};
    const resolveName = (player) => {
      if (typeof player === "object" && (player.name || player.fullName)) return player.name || player.fullName;
      const found = allPlayers.find(p => sameId(p, player));
      return found?.name || found?.fullName || "Unknown";
    };
    (match?.innings || []).forEach(inn => {
      (inn.batting || []).forEach(b => {
        if (!b.player) return;
        const key = idOf(b.player);
        if (!scores[key]) scores[key] = { name: resolveName(b.player), player: b.player, runs: 0, ballsFaced: 0, wickets: 0, runsConceded: 0, ballsBowled: 0, catches: 0 };
        scores[key].runs += number(b.runs);
        scores[key].ballsFaced += number(b.ballsFaced);
      });
      (inn.bowling || []).forEach(b => {
        if (!b.player) return;
        const key = idOf(b.player);
        if (!scores[key]) scores[key] = { name: resolveName(b.player), player: b.player, runs: 0, ballsFaced: 0, wickets: 0, runsConceded: 0, ballsBowled: 0, catches: 0 };
        scores[key].wickets += number(b.wickets);
        scores[key].runsConceded += number(b.runs);
        scores[key].ballsBowled += number(b.balls);
      });
    });
    return Object.values(scores)
      .map(s => ({
        ...s,
        strikeRate: s.ballsFaced ? ((s.runs / s.ballsFaced) * 100).toFixed(2) : "0.00",
        economy: s.ballsBowled ? (s.runsConceded / (s.ballsBowled / 6)).toFixed(2) : "0.00",
        impactScore: number(s.runs) + number(s.wickets) * 25 + number(s.catches) * 10,
      }))
      .sort((a, b) => number(b.impactScore) - number(a.impactScore))
      .slice(0, 5);
  };

  const mvpList = useMemo(() => computeMVP(), [match, allPlayers]);

  const mom = match?.manOfMatch || match?.mom;
  const momName = mom ? (typeof mom === "object" ? (mom.name || mom.fullName) : playerName(mom, allPlayers)) : null;

  const firstInnings = match?.innings?.[0];
  const secondInnings = match?.innings?.[1];

  return (
    <div className="space-y-5">
      {/* Result Banner */}
      {(match.status === "completed" || match.result?.winner) && (
        <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 rounded-xl p-5 text-white">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider opacity-80">Result</p>
              <p className="text-lg font-black mt-0.5">{match.result?.description || match.result?.winnerName || "Match Complete"}</p>
              {momName && (
                <div className="flex items-center gap-2 mt-2 bg-white/15 rounded-lg px-3 py-1.5 inline-flex">
                  <span className="text-lg">Trophy</span>
                  <span className="text-sm font-bold">Player of the Match: <span className="underline decoration-yellow-300 decoration-2">{momName}</span></span>
                </div>
              )}
            </div>
            <div className="hidden sm:flex items-center gap-3">
              {(match.teams || []).map((t, i) => (
                <div key={t._id || i} className="text-center">
                  <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center mx-auto mb-1 overflow-hidden">
                    {t.logo ? <img src={t.logo} alt="" className="w-full h-full object-cover" /> : <span className="text-lg font-black">{t.shortName?.charAt(0)}</span>}
                  </div>
                  <p className="text-[10px] font-bold uppercase opacity-80">{t.shortName}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MVP Impact List */}
      {mvpList.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200">
            <h3 className="text-xs font-black text-amber-800 uppercase tracking-wider">MVP Impact List</h3>
          </div>
          <div className="divide-y divide-slate-100">
            {mvpList.map((p, idx) => (
              <div key={idOf(p.player)} className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-50">
                <div className="flex items-center gap-3">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black ${idx === 0 ? "bg-amber-400 text-amber-900" : "bg-slate-100 text-slate-500"}`}>
                    {idx === 0 ? "1" : idx + 1}
                  </span>
                  <div>
                    <p className="text-sm font-bold text-slate-800">{p.name}</p>
                    <p className="text-[10px] text-slate-500">
                      {p.runs > 0 && <span>{p.runs} runs{p.wickets > 0 ? ", " : ""}</span>}
                      {p.wickets > 0 && <span>{p.wickets} wickets</span>}
                      {p.runs === 0 && p.wickets === 0 && <span>0 runs, 0 wickets</span>}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-black text-slate-700">{p.impactScore}</p>
                  <p className="text-[9px] text-slate-400 uppercase">MVP Score</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pre-match / Toss */}
      {match.tossWinner && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Toss Update</h3>
          <div className="flex items-center gap-3">
            <span className="text-2xl">Toss</span>
            <div>
              <p className="text-sm font-bold text-slate-800">
                {typeof match.tossWinner === "object" ? match.tossWinner.name || match.tossWinner.shortName : playerName(match.tossWinner, allPlayers)} won the toss
              </p>
              <p className="text-xs text-slate-500 capitalize font-semibold">Elected to {match.tossDecision || "bat"} first</p>
            </div>
          </div>
          {match.preMatchComments && (
            <div className="mt-3 bg-slate-50 rounded-lg p-3 border border-slate-100">
              <p className="text-xs font-semibold text-slate-500 italic">"{match.preMatchComments}"</p>
              <p className="text-[10px] text-slate-400 font-bold mt-1">- Pre-match Comments</p>
            </div>
          )}
        </div>
      )}

      {/* Innings Summary */}
      {(firstInnings || secondInnings) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[firstInnings, secondInnings].filter(Boolean).map((inn, idx) => {
            const t = match?.teams?.[idx === 0 ? 0 : 1] || match?.teams?.[idx];
            const topBatter = [...(inn.batting || [])].sort((a, b) => number(b.runs) - number(a.runs))[0];
            const topBowler = [...(inn.bowling || [])].sort((a, b) => number(b.wickets) - number(a.wickets))[0];
            return (
              <div key={idx} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className={`px-4 py-2.5 ${idx === 0 ? "bg-blue-50 border-b border-blue-200" : "bg-red-50 border-b border-red-200"}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-white flex items-center justify-center overflow-hidden border border-slate-200">
                        {t?.logo ? <img src={t.logo} alt="" className="w-full h-full object-cover" /> : <span className="text-[9px] font-black text-slate-600">{t?.shortName?.charAt(0)}</span>}
                      </div>
                      <span className="text-xs font-black text-slate-700 uppercase">{t?.shortName || t?.name || `Team ${idx + 1}`}</span>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-black tabular-nums text-slate-800">{inn.runs}/{inn.wickets ?? "-"}</p>
                      <p className="text-[10px] font-bold text-slate-400">Overs: {formatOvers(inn.balls)} - RR: {getCrr(inn)}</p>
                    </div>
                  </div>
                </div>
                <div className="p-3 space-y-2">
                  {topBatter && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-600">Top Batter:</span>
                      <span className="font-bold text-slate-800">
                        {playerName(topBatter.player, allPlayers)} {topBatter.runs}({topBatter.ballsFaced}) - SR {strikeRate(topBatter.runs, topBatter.ballsFaced)}
                      </span>
                    </div>
                  )}
                  {topBowler && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-600">Top Bowler:</span>
                      <span className="font-bold text-slate-800">
                        {playerName(topBowler.player, allPlayers)} {topBowler.wickets}/{topBowler.runs} ({formatBowlerOvers(topBowler)}) - Econ {economyRate(topBowler.runs, topBowler.balls)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Best Performances - Bowlers */}
      {match && (() => {
        const allBowling = (match.innings || []).flatMap(inn =>
          (inn.bowling || []).map(b => ({ ...b, team: inn.team }))
        ).filter(b => number(b.wickets) > 0 || number(b.maidens) > 0);
        const topBowlers = [...allBowling].sort((a, b) => number(b.wickets) - number(a.wickets) || number(a.runs) - number(b.runs)).slice(0, 4);
        if (topBowlers.length === 0) return null;
        return (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
              <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Best Performances - Bowlers</h3>
            </div>
            <div className="divide-y divide-slate-100">
              {topBowlers.map((b, idx) => (
                <div key={idx} className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-50">
                  <div className="flex items-center gap-3">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black ${idx === 0 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                      {idx + 1}
                    </span>
                    <div>
                      <p className="text-sm font-bold text-slate-800">{playerName(b.player, allPlayers)}</p>
                      <p className="text-[10px] text-slate-500">{b.team?.shortName || b.team?.name}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-black text-slate-700">
                      {number(b.wickets)}/{number(b.runs)}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      {formatBowlerOvers(b)} - Econ {economyRate(b.runs, b.balls)}
                      {number(b.maidens) > 0 && ` - ${b.maidens}M`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Post-match Reactions */}
      {(match.result?.postMatchComments || match.result?.captainComments) && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Post-Match Reactions</h3>
          <div className="space-y-3">
            {match.result?.captainComments && (
              <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                <p className="text-xs font-semibold text-slate-500 italic">"{match.result.captainComments}"</p>
                <p className="text-[10px] text-slate-400 font-bold mt-1">- Captain's Comments</p>
              </div>
            )}
            {match.result?.postMatchComments && (
              <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                <p className="text-xs font-semibold text-slate-500 italic">"{match.result.postMatchComments}"</p>
                <p className="text-[10px] text-slate-400 font-bold mt-1">- Post-match Comments</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Key Moments */}
      {match && (() => {
        const allBalls = (match.innings || []).flatMap((inn, innIdx) => {
          const team = match.teams?.find(t => sameId(t._id, inn.team));
          return (inn.overs || []).flatMap(over =>
            (over.balls || []).map((ball, bIdx) => {
              const runs = ballRuns(ball);
              const overStr = `${over.overNumber}.${ball.ballNumber || bIdx + 1}`;
              return { ...ball, runs, overStr, team: team?.shortName || team?.name || `Innings ${innIdx + 1}`, innings: innIdx };
            })
          );
        });
        const topMoments = [
          ...allBalls.filter(b => b.runs === 6).slice(0, 3),
          ...allBalls.filter(b => b.isWicket).slice(0, 3),
          ...allBalls.filter(b => b.runs === 4).slice(0, 3),
        ].sort((a, b) => {
          const pri = (b) => b.runs === 6 ? 2 : b.isWicket ? 2 : 1;
          return pri(b) - pri(a) || 0;
        }).slice(0, 6);
        if (topMoments.length === 0) return null;
        return (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200">
              <h3 className="text-xs font-black text-amber-800 uppercase tracking-wider">Key Moments</h3>
            </div>
            <div className="divide-y divide-slate-100">
              {topMoments.map((ball, i) => {
                const batterName = typeof ball.player === "object" ? ball.player.name || ball.player.fullName : playerName(ball.player, allPlayers);
                const bowlerName = typeof ball.bowler === "object" ? ball.bowler.name || ball.bowler.fullName : (ball.bowler ? playerName(ball.bowler, allPlayers) : null);
                return (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                    <span className={`text-lg ${ball.runs === 6 ? 'text-purple-600' : ball.runs === 4 ? 'text-blue-600' : 'text-red-600'}`}>
                      {ball.runs === 6 ? '6' : ball.runs === 4 ? '4' : 'W'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-800 truncate">
                        {ball.runs === 6 && <span className="text-purple-600">SIX! </span>}
                        {ball.runs === 4 && <span className="text-blue-600">FOUR! </span>}
                        {batterName}
                        {ball.runs > 0 && <span> {batterName ? '' : ''} {ball.runs} runs</span>}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        {bowlerName && <span>Bowled by {bowlerName} - </span>}
                        <span>Over {ball.overStr} - {ball.team}</span>
                        {ball.isWicket && <span className="text-red-500 font-bold"> - WICKET</span>}
                      </p>
                    </div>
                    {ball.runs > 0 && (
                      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-black text-sm ${
                        ball.runs === 6 ? 'bg-purple-100 text-purple-700' : ball.runs === 4 ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-700'
                      }`}>
                        {ball.runs}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Match Details */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
          <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Match Details</h3>
        </div>
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          {match.venue && (
            <div>
              <span className="font-bold text-slate-400 block text-[10px] uppercase">Venue</span>
              <span className="font-semibold text-slate-700">{match.venue}{match.address ? `, ${match.address}` : ""}</span>
            </div>
          )}
          {match.startAt && (
            <div>
              <span className="font-bold text-slate-400 block text-[10px] uppercase">Date</span>
              <span className="font-semibold text-slate-700">{new Date(match.startAt).toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</span>
            </div>
          )}
          {match.tossWinner && (
            <div>
              <span className="font-bold text-slate-400 block text-[10px] uppercase">Toss</span>
              <span className="font-semibold text-slate-700">{typeof match.tossWinner === "object" ? match.tossWinner.name : playerName(match.tossWinner, allPlayers)} won, elected to {match.tossDecision || "bat"}</span>
            </div>
          )}
          {match.matchType && (
            <div>
              <span className="font-bold text-slate-400 block text-[10px] uppercase">Format</span>
              <span className="font-semibold text-slate-700 capitalize">{match.matchType.replace(/_/g, " ")}</span>
            </div>
          )}
          {match.tournament?.name && (
            <div>
              <span className="font-bold text-slate-400 block text-[10px] uppercase">Series</span>
              <span className="font-semibold text-slate-700">{match.tournament.name}</span>
            </div>
          )}
          {match.season && (
            <div>
              <span className="font-bold text-slate-400 block text-[10px] uppercase">Season</span>
              <span className="font-semibold text-slate-700">{match.season}</span>
            </div>
          )}
          {(match.umpires?.length > 0) && (
            <div>
              <span className="font-bold text-slate-400 block text-[10px] uppercase">Umpires</span>
              <span className="font-semibold text-slate-700">{match.umpires.map(u => typeof u === "object" ? u.name : u).join(", ")}</span>
            </div>
          )}
          {match.matchReferee && (
            <div>
              <span className="font-bold text-slate-400 block text-[10px] uppercase">Match Referee</span>
              <span className="font-semibold text-slate-700">{typeof match.matchReferee === "object" ? match.matchReferee.name : match.matchReferee}</span>
            </div>
          )}
          {match.weather && (
            <div>
              <span className="font-bold text-slate-400 block text-[10px] uppercase">Weather</span>
              <span className="font-semibold text-slate-700">{typeof match.weather === "object" ? `${match.weather.condition || match.weather.description || ""} ${match.weather.temp ? `- ${match.weather.temp}C` : ""}`.trim() : match.weather}</span>
            </div>
          )}
        </div>
      </div>

      {/* No data state */}
      {(!firstInnings && !secondInnings && !match.tossWinner && match.status !== "completed") && (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
          <p className="text-3xl mb-2">Info</p>
          <p className="text-sm font-bold text-slate-400">Match details will appear here once the match begins</p>
        </div>
      )}
    </div>
  );
};

const EnhancedMatchTabs = ({ match, matchId }) => {
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
    <main className="min-h-screen bg-white text-slate-900">
      <section className="bg-[#0b66c3] text-white shadow-sm">
        <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-bold uppercase tracking-[0.16em] text-blue-100">
            <span>BQ-PLAY Live Scores</span>
            <span className="flex items-center gap-2">
              {isLive && <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />}
              {statusLabel(match.status)}
            </span>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <h1 className="text-xl font-black tracking-tight sm:text-3xl">
                {longTeamName(match.teams?.[0])} vs {longTeamName(match.teams?.[1])}
              </h1>
              <p className="mt-2 text-sm text-blue-100">{match.venue || "Venue TBC"} · {match.matchType || "Match"} · {getTossLine(match)}</p>
              {getResultLine(match) && <p className="mt-1 text-sm font-semibold text-amber-100">{getResultLine(match)}</p>}
            </div>
            <div className="rounded-lg bg-white px-5 py-3 text-right text-slate-950 shadow-lg">
              <div className="text-xs font-black uppercase text-slate-500">{longTeamName(battingTeam)}</div>
              <div className="text-3xl font-black tabular-nums">
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
        <div className="mx-auto flex max-w-7xl gap-6 overflow-x-auto px-4 py-0 sm:px-6 lg:px-8">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`whitespace-nowrap border-b-2 px-0 py-4 text-sm font-black transition ${
                activeTab === tab.id ? "border-[#0b66c3] text-[#0b66c3]" : "border-transparent text-slate-600 hover:text-slate-900"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        {activeTab === "live" && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
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
                striker={striker}
                nonStriker={nonStriker}
                bowler={bowler}
                strikerId={strikerId}
                players={players}
              />
              <CurrentPlayers
                striker={striker}
                nonStriker={nonStriker}
                bowler={bowler}
                strikerId={strikerId}
                players={players}
              />
              <RecentBalls overs={recentOvers} />
              <CommentaryPreview overs={commentaryOvers} players={players} onSwitchTab={setActiveTab} />
            </section>
            <aside className="space-y-4">
              <MiniInfo match={match} />
              <ScoreBreakdown match={match} />
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

        {activeTab === "playing-xi" && <PlayingXITab match={match} players={players} />}

        {activeTab === "overs" && <OversTab matchId={matchId || match?._id} />}

        {activeTab === "live-stats" && <LiveStatsTab matchId={matchId || match?._id} />}

        {activeTab === "summary" && <SummaryTab match={match} allPlayers={players} />}

        {activeTab === "partnerships" && (
          <PartnershipsTab match={match} innings={currentInnings} players={players} />
        )}

        {activeTab === "graphs" && (
          <GraphsTab match={match} matchId={matchId} innings={currentInnings} />
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
  const remainingBalls = target ? Math.max(number(totalOvers) * 6 - number(innings?.balls), 0) : 0;

  return (
    <div className="border-b border-slate-200 bg-white pb-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-red-600">
            <span className="h-2 w-2 rounded-full bg-red-500" />
            Live
          </div>
          <h2 className="mt-3 text-2xl font-black">{longTeamName(battingTeam)}</h2>
          <p className="text-sm text-slate-600">Batting against {longTeamName(bowlingTeam)}</p>
          {target > 0 && (
            <p className="mt-3 text-base font-semibold text-slate-900">
              {longTeamName(battingTeam)} need {required} runs from {remainingBalls} balls.
            </p>
          )}
        </div>
        <div className="text-right">
          <div className="text-4xl font-black tabular-nums text-slate-950">{number(innings?.runs)}/{number(innings?.wickets)}</div>
          <div className="text-sm font-bold text-slate-500">
            ({formatOvers(innings?.balls)}/{totalOvers || 0} ov{target > 0 ? `, T:${target}` : ""})
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-600">
        <span>Current RR: <strong className="text-slate-900">{crr}</strong></span>
        {rrr && <span>Required RR: <strong className="text-slate-900">{rrr}</strong></span>}
        <span>Partnership: <strong className="text-slate-900">{number(partnership?.runs)} ({number(partnership?.balls)}b)</strong></span>
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
          <div className="font-black">{name}{active ? " *" : ""}</div>
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
  const batterRows = [striker, nonStriker].filter(Boolean);

  return (
    <div className="overflow-hidden border-b border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-slate-100 text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">
            <tr>
              <th className="px-3 py-2">Batters</th>
              <th className="px-3 py-2 text-right">R</th>
              <th className="px-3 py-2 text-right">B</th>
              <th className="px-3 py-2 text-right">4s</th>
              <th className="px-3 py-2 text-right">6s</th>
              <th className="px-3 py-2 text-right">SR</th>
              <th className="px-3 py-2 text-right">This Bowler</th>
              <th className="px-3 py-2 text-right">Last 5 ov</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {batterRows.length ? batterRows.map((row) => {
              const active = sameId(row?.player, strikerId);
              return (
                <tr key={idOf(row?.player)} className={active ? "bg-blue-50/50" : ""}>
                  <td className="px-3 py-2 font-black text-slate-950">
                    {playerName(row?.player, players)}
                    {active && <span className="ml-1 text-red-600">*</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-black tabular-nums">{number(row?.runs)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{number(row?.balls)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{number(row?.fours)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{number(row?.sixes)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{strikeRate(row?.runs, row?.balls)}</td>
                  <td className="px-3 py-2 text-right text-slate-500">-</td>
                  <td className="px-3 py-2 text-right text-slate-500">-</td>
                </tr>
              );
            }) : (
              <tr>
                <td className="px-3 py-4 text-slate-500" colSpan={8}>Current batters will appear after scoring starts.</td>
              </tr>
            )}
          </tbody>
          <thead className="bg-slate-100 text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">
            <tr>
              <th className="px-3 py-2">Bowlers</th>
              <th className="px-3 py-2 text-right">O</th>
              <th className="px-3 py-2 text-right">M</th>
              <th className="px-3 py-2 text-right">R</th>
              <th className="px-3 py-2 text-right">W</th>
              <th className="px-3 py-2 text-right">Econ</th>
              <th className="px-3 py-2 text-right">0s</th>
              <th className="px-3 py-2 text-right">Wd/Nb</th>
            </tr>
          </thead>
          <tbody>
            {bowler ? (
              <tr>
                <td className="px-3 py-2 font-black text-slate-950">{playerName(bowler?.player, players)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatBowlerOvers(bowler)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{number(bowler?.maidens)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{number(bowler?.runs)}</td>
                <td className="px-3 py-2 text-right font-black tabular-nums">{number(bowler?.wickets)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{bowler?.economy || economyRate(bowler?.runs, bowler?.balls)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{number(bowler?.dots || bowler?.dotBalls)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{number(bowler?.wides)}/{number(bowler?.noBalls)}</td>
              </tr>
            ) : (
              <tr>
                <td className="px-3 py-4 text-slate-500" colSpan={8}>Current bowler will appear after scoring starts.</td>
              </tr>
            )}
          </tbody>
        </table>
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
    <div className="border-b border-slate-200 bg-white py-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Recent Balls</h3>
        <div className="flex gap-2">
          <button type="button" onClick={() => setOverOffset((value) => Math.min(value + 1, maxOffset))} className="rounded bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-600 transition-all hover:bg-slate-200">&lsaquo;</button>
          <button type="button" onClick={() => setOverOffset((value) => Math.max(value - 1, 0))} className="rounded bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-600 transition-all hover:bg-slate-200">&rsaquo;</button>
        </div>
      </div>
      <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
        {visibleBalls.length ? (
          visibleBalls.map((ball, index) => {
            const showSeparator = index === 0 || visibleBalls[index - 1]?.overNumber !== ball.overNumber;
            return (
              <React.Fragment key={ball._id || `${ball.overNumber}-${index}`}>
                {showSeparator && (
                  <span className="flex min-w-fit items-center rounded bg-slate-100 px-2.5 py-2 text-[11px] font-black text-slate-700">
                    {number(ball.overNumber) + 1} ov
                  </span>
                )}
                <span className={`flex h-9 min-w-9 items-center justify-center rounded px-2 text-xs font-black ${ballClass(ball)}`}>
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
  const recentBalls = allBalls.slice(0, 6);
  const recentOvers = new Map();
  recentBalls.forEach(({ ball, over }) => {
    const key = over.overNumber;
    if (!recentOvers.has(key)) recentOvers.set(key, { over, balls: [] });
    recentOvers.get(key).balls.push(ball);
  });
  return (
    <div className="bg-white py-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-black text-slate-950">Match Centre</h3>
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
          {Array.from(recentOvers.values()).slice(0, 2).map(({ over, balls }) => (
            <div key={over.overNumber} className="border-t border-slate-200 pt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Over {number(over.overNumber) + 1}</span>
                <span className="text-[9px] text-slate-500 font-bold">
                  {number(over.runsScored)} run{number(over.runsScored) !== 1 ? "s" : ""}
                  {number(over.wickets) > 0 && ` | ${over.wickets} wkt`}
                </span>
              </div>
              <div className="mb-2 flex flex-wrap gap-1">
                {balls.map((b, i) => <BallBadge key={i} ball={b} small />)}
              </div>
              <div className="space-y-1">
                {balls.slice().reverse().map((ball, idx) => (
                  <CommentaryBall key={ball._id || idx} over={over} ball={ball} players={players} compact />
                ))}
              </div>
            </div>
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
    <div className="border-b border-slate-200 bg-white pb-4">
      <h3 className="text-lg font-black text-slate-950">Match Info</h3>
      <dl className="mt-3 space-y-2 text-sm">
        <InfoRow label="Venue" value={match.venue || "TBC"} />
        <InfoRow label="Date" value={formatDate(match.startAt)} />
        <InfoRow label="Type" value={match.matchType || "T20"} />
        <InfoRow label="Toss" value={getTossLine(match)} />
      </dl>
    </div>
  );
}

function ScoreBreakdown({ match }) {
  const innings = match?.innings || [];
  const phases = [
    { label: "Power Play", start: 0, end: 6 },
    { label: "Middle Overs", start: 6, end: Math.max(number(match?.totalOvers) - 5, 6) },
    { label: "Final Overs", start: Math.max(number(match?.totalOvers) - 5, 0), end: number(match?.totalOvers) || 20 },
  ];

  const phaseScore = (inn, phase) => {
    const overs = inn?.oversHistory || [];
    const selected = overs.filter((over) => number(over.overNumber) >= phase.start && number(over.overNumber) < phase.end);
    if (!selected.length) return "-";
    const runs = selected.reduce((sum, over) => sum + overRunsAndWickets(over).runs, 0);
    const wickets = selected.reduce((sum, over) => sum + overRunsAndWickets(over).wickets, 0);
    return `${runs}/${wickets}`;
  };

  return (
    <div className="bg-white pt-4">
      <h3 className="text-lg font-black text-slate-950">Scoring Breakdown</h3>
      <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
        <div className="grid grid-cols-[1fr_repeat(2,minmax(70px,1fr))] bg-slate-50 px-3 py-2 text-xs font-black text-slate-700">
          <span>Phase</span>
          {innings.slice(0, 2).map((inn, index) => (
            <span key={inn?._id || index} className="text-right">{teamName(getTeamById(match, inn?.team))}</span>
          ))}
        </div>
        <div className="divide-y divide-slate-100">
          {phases.map((phase) => (
            <div key={phase.label} className="grid grid-cols-[1fr_repeat(2,minmax(70px,1fr))] px-3 py-3 text-sm">
              <span className="font-semibold text-slate-700">{phase.label}</span>
              {innings.slice(0, 2).map((inn, index) => (
                <span key={`${phase.label}-${inn?._id || index}`} className="text-right font-black tabular-nums text-slate-900">
                  {phaseScore(inn, phase)}
                </span>
              ))}
              {innings.length < 2 && <span className="text-right font-black text-slate-400">-</span>}
            </div>
          ))}
        </div>
      </div>
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

      <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h3 className="text-xs font-black uppercase tracking-[0.18em] text-slate-500 mb-3">Fall of Wickets</h3>
        {(innings?.fallOfWickets || []).length ? (
          <div className="space-y-2">
            {innings.fallOfWickets.map((w, i) => (
              <div key={i} className="flex items-center gap-3 text-sm bg-slate-50 rounded-lg px-3 py-2">
                <span className="font-black text-slate-700 min-w-[3rem]">{w.wickets}-{w.runs}</span>
                <span className="text-slate-500 flex-1">{playerName(w.player, players)}</span>
                <span className="text-xs font-bold text-slate-400">{number(w.overs).toFixed(1)} ov</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400">No wickets yet</p>
        )}
      </div>

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

function BallBadge({ ball, small = false }) {
  const isWicket = ball.isWicket;
  const notation = isWicket ? "W" : (ball.runs === 0 && !ball.isWide && !ball.isNoBall) ? "." : String(ball.runs || 0);
  const isFour = ball.runs === 4 && !ball.isWide && !ball.isNoBall && !ball.isWicket;
  const isSix = ball.runs === 6 && !ball.isWide && !ball.isNoBall && !ball.isWicket;
  const isWide = ball.isWide;
  const isNoBall = ball.isNoBall;
  const base = small ? "w-6 h-6 text-[9px] rounded-md" : "w-9 h-9 text-xs rounded-lg";
  const color = isWicket
    ? "bg-red-600 text-white shadow-red-500/40"
    : isSix ? "bg-purple-600 text-white shadow-purple-500/40"
      : isFour ? "bg-blue-600 text-white shadow-blue-500/40"
        : (isWide || isNoBall) ? "bg-amber-500 text-white shadow-amber-500/40"
          : "bg-slate-200 text-slate-600";
  return (
    <div className={`${base} ${color} flex items-center justify-center font-black shrink-0 shadow`}>
      {notation}
    </div>
  );
}

function CommentaryTab({ overs, players, visibleOvers, onLoadMore }) {
  const [filter, setFilter] = useState('all');
  const [compact, setCompact] = useState(false);

  const filteredOvers = useMemo(() => {
    if (filter === 'all') return overs.slice(0, visibleOvers);
    return overs.filter(over => {
      return (over.balls || []).some(ball => {
        if (filter === 'fours' && ballRuns(ball) === 4) return true;
        if (filter === 'sixes' && ballRuns(ball) === 6) return true;
        if (filter === 'wickets' && ball?.isWicket) return true;
        return false;
      });
    }).slice(0, visibleOvers);
  }, [overs, filter, visibleOvers]);

  const visible = filteredOvers;

  return (
    <section className="space-y-4">
      {/* Filter bar */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-2 flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1">
          {[
            { key: 'all', label: 'All' },
            { key: 'fours', label: 'Fours', color: 'bg-blue-600' },
            { key: 'sixes', label: 'Sixes', color: 'bg-purple-600' },
            { key: 'wickets', label: 'Wickets', color: 'bg-red-600' },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
                filter === f.key
                  ? `${f.color || 'bg-[#031d44]'} text-white`
                  : 'text-slate-500 hover:text-slate-800 bg-slate-100'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setCompact(c => !c)}
          className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
            compact ? 'bg-[#031d44] text-white' : 'text-slate-500 hover:text-slate-800 bg-slate-100'
          }`}
        >
          {compact ? 'Full View' : 'Compact'}
        </button>
      </div>

      {visible.length ? visible.map((over) => (
        <div key={over._id || over.overNumber} className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          {/* Over block - BallByBallFeed style */}
          <div className="p-4">
            {/* Over Header Summary */}
            <div className="bg-slate-50 rounded-xl p-4 mb-3 border border-slate-200">
              <div className="flex justify-between items-start flex-wrap gap-2">
                <div>
                  <span className="text-[#ff6b35] font-black text-base">Over {number(over.overNumber) + 1}</span>
                  <span className="text-slate-500 text-xs ml-3">
                    {overRunsAndWickets(over).runs} run{overRunsAndWickets(over).runs !== 1 ? "s" : ""}
                    {overRunsAndWickets(over).wickets > 0 && <span className="text-red-500"> | {overRunsAndWickets(over).wickets} wkt{overRunsAndWickets(over).wickets !== 1 ? "s" : ""}</span>}
                  </span>
                </div>
                <div className="text-right text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                  {playerName(over.bowler, players)}
                </div>
              </div>
              {over.summary && (
                <p className="text-slate-500 text-xs italic mt-2 leading-relaxed border-t border-slate-200 pt-2">
                  {over.summary}
                </p>
              )}
              <div className="flex gap-1.5 mt-2 flex-wrap">
                {(over.balls || []).map((b, i) => (
                  <BallBadge key={i} ball={b} small />
                ))}
              </div>
            </div>

            {/* Ball-by-ball */}
            <div className={compact ? "space-y-1" : "space-y-1"}>
              {(over.balls || []).slice().reverse().map((ball, index) => (
                <CommentaryBall key={ball._id || index} over={over} ball={ball} players={players} compact={compact} />
              ))}
            </div>
          </div>
        </div>
      )) : (
        <div className="rounded-xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
          <p className="text-3xl mb-3">Commentary</p>
          <p className="text-sm font-black text-slate-400">
            {filter === 'all' ? 'No commentary yet.' : `No ${filter} in this match.`}
          </p>
          {filter !== 'all' && (
            <button onClick={() => setFilter('all')} className="mt-2 text-xs font-bold text-blue-600 hover:underline">
              Show all commentary
            </button>
          )}
        </div>
      )}

      {filter === 'all' && overs.length > visibleOvers && (
        <button
          type="button"
          onClick={onLoadMore}
          className="w-full rounded-xl bg-gradient-to-r from-[#031d44] to-[#0a2d5e] px-4 py-3.5 font-black text-white text-sm hover:from-[#0a2d5e] hover:to-[#031d44] transition-all shadow-md"
        >
          Load More Commentary
        </button>
      )}
    </section>
  );
}

function CommentaryBall({ over, ball, players, compact = false }) {
  const ballNum = ball.displayBall || ball.ballNumber || 1;
  const overText = `${number(over.overNumber)}.${ballNum}`;
  const bowler = ball.bowlerName || playerName(ball.bowler || over.bowler, players);
  const batsman = ball.batsmanName || playerName(ball.batsmanOnStrike, players);
  const text = ball.vividCommentary || ball.commentary || "";
  const runs = ballRuns(ball);
  const isBoundary = runs === 4;
  const isSix = runs === 6;
  const isWicket = ball?.isWicket;
  const isWide = ball?.isWide;
  const isNoBall = ball?.isNoBall;
  const metaItems = ballMetaItems(ball);

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-4 py-1.5 hover:bg-slate-50 text-xs">
        <span className="text-[10px] font-bold text-slate-400 w-8 shrink-0">{overText}</span>
        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-black shrink-0 ${ballClass(ball)}`}>
          {ballLabel(ball)}
        </span>
        <span className="font-semibold text-slate-700 truncate">{batsman}</span>
        <span className="text-slate-300 mx-1">-</span>
        <span className="font-bold text-slate-500">{ballResultText(ball)}</span>
        {text && <span className="text-slate-400 truncate ml-1">- {text}</span>}
      </div>
    );
  }

  return (
    <div className={`p-3 rounded-xl transition-all ${isWicket ? "bg-red-50 border border-red-200" : "hover:bg-slate-50"}`}>
      <div className="flex items-center gap-3">
        <BallBadge ball={ball} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-slate-900 font-bold text-sm leading-tight">
              {overText} {bowler} to {batsman}, {isWicket ? "OUT!" : ballResultText(ball)}
            </span>
          </div>
        </div>
      </div>
      {text && (
        <p className="ml-12 mt-1.5 text-xs text-slate-500 italic leading-relaxed">{text}</p>
      )}
      {metaItems.length > 0 && (
        <div className="ml-12 mt-2 flex flex-wrap gap-1.5">
          {metaItems.map((item) => (
            <span key={item} className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-slate-500">
              {item}
            </span>
          ))}
        </div>
      )}
      {ball.angle !== undefined && (
        <div className="ml-12 mt-1.5 flex items-center gap-1.5">
          <div className="w-3.5 h-3.5 rounded-full border border-slate-200 flex items-center justify-center">
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{
                backgroundColor: isSix ? '#a855f7' : isBoundary ? '#3b82f6' : '#94a3b8',
                transform: `rotate(${ball.angle || 0}deg)`,
              }}
            />
          </div>
          <span className="text-[9px] font-bold text-slate-400 uppercase">
            {ball.regionName || ball.zone || ''}
          </span>
          {ball.distance && (
            <span className="text-[9px] text-slate-400">{Math.round(ball.distance)}m</span>
          )}
        </div>
      )}
    </div>
  );
}

function PlayingXITab({ match, players }) {
  const currentTeamId = match?.innings?.[match?.currentInnings || 0]?.team;
  const rolesByTeam = new Map((match?.teamRoles || []).map((entry) => [idOf(entry.team), entry]));

  const inningsForTeam = (teamId) => (match?.innings || []).find((innings) => sameId(innings.team, teamId));

  return (
    <section className="space-y-4">
      <div className="rounded-xl bg-[#07172f] p-5 text-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-orange-300">Playing XI</p>
            <h2 className="mt-1 text-2xl font-black">Team Sheets</h2>
            <p className="mt-1 text-sm text-slate-300">{getTossLine(match)}</p>
          </div>
          <div className="rounded-lg bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-widest">
            {statusLabel(match?.status)}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {(match?.teams || []).map((team) => {
          const teamId = idOf(team);
          const xi = getPlayingXI(match, team).length ? getPlayingXI(match, team) : (team.players || []);
          const roles = rolesByTeam.get(teamId) || {};
          const innings = inningsForTeam(teamId);
          const battingIds = new Set((innings?.batting || []).map((row) => idOf(row.player)));

          return (
            <div key={teamId || team?.name} className={`overflow-hidden rounded-xl bg-white shadow-sm ring-1 ${sameId(currentTeamId, teamId) ? "ring-orange-300" : "ring-slate-200"}`}>
              <div className={`px-4 py-3 ${sameId(currentTeamId, teamId) ? "bg-orange-50" : "bg-slate-50"} border-b border-slate-200`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white ring-1 ring-slate-200">
                      {team.logo ? <img src={team.logo} alt={longTeamName(team)} className="h-full w-full object-cover" /> : <span className="font-black text-slate-700">{teamName(team).charAt(0)}</span>}
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-black text-slate-900">{longTeamName(team)}</h3>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                        {xi.length || 0} players {sameId(currentTeamId, teamId) ? "- batting now" : ""}
                      </p>
                    </div>
                  </div>
                  <div className="text-right text-[10px] font-black uppercase tracking-widest text-slate-500">
                    {innings ? `${number(innings.runs)}/${number(innings.wickets)} (${formatOvers(innings.balls)})` : "Not started"}
                  </div>
                </div>
              </div>

              <div className="divide-y divide-slate-100">
                {(xi.length ? xi : Array.from({ length: 11 })).map((player, index) => {
                  const playerId = idOf(player);
                  const isCaptain = sameId(roles.captain, playerId);
                  const isViceCaptain = sameId(roles.viceCaptain, playerId);
                  const isKeeper = (roles.wicketKeepers || []).some((keeper) => sameId(keeper, playerId));
                  const hasBatted = battingIds.has(playerId);

                  return (
                    <div key={playerId || index} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-black text-slate-500">
                          {index + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-black text-slate-900">{player ? playerName(player, players) : `Player ${index + 1}`}</p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {isCaptain && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[9px] font-black uppercase text-blue-700">C</span>}
                            {isViceCaptain && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-black uppercase text-emerald-700">VC</span>}
                            {isKeeper && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-black uppercase text-amber-700">WK</span>}
                            {hasBatted && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-black uppercase text-slate-500">Batted</span>}
                          </div>
                        </div>
                      </div>
                      <span className="text-[10px] font-bold uppercase text-slate-400">{player?.playingRole || player?.role || ""}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
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

      {/* Spike Graph - Productive Shots */}
      {inning1 && (
        <div className="pt-2">
          <SpikeGraph
            shots={(inning1?.oversHistory || []).flatMap(o => (o.balls || []).map(b => ({
              angle: b.angle,
              runs: b.runs,
              batsman: b.batsmanOnStrike,
            }))).filter(s => s.angle !== undefined)}
            playerName={inning1?.team?.shortName || inning1?.team?.name || "Innings 1"}
          />
        </div>
      )}

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

function PartnershipsTab({ match, innings, players }) {
  const [partnershipData, setPartnershipData] = useState([]);
  const [loading, setLoading] = useState(true);
  const allInnings = match?.innings || [];

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const results = await Promise.all(
          allInnings.map((_, idx) =>
            api.get(`/matches/${match._id}/partnerships/${idx + 1}`).then(r => r.data)
          )
        );
        setPartnershipData(results);
      } catch (err) {
        console.error("Failed to load partnerships:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, [match._id]);

  if (loading) return <div className="text-center text-slate-500 py-8">Loading partnerships...</div>;

  const formatPartnerships = (partnerships, innIdx) => {
    if (!partnerships || partnerships.length === 0) {
      return <p className="text-sm text-slate-500 py-4">No partnerships recorded for this innings.</p>;
    }
    const inn = allInnings[innIdx];
    return (
      <div className="space-y-3">
        {partnerships.map((p, i) => {
          const isActive = p.isActive;
          return (
            <div
              key={p._id || i}
              className={`rounded-xl border p-4 transition-all ${
                isActive
                  ? 'border-green-300 bg-green-50 shadow-sm'
                  : 'border-slate-200 bg-white'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  {p.wicketNumber}{ordinal(p.wicketNumber)} Wicket Partnership
                  {isActive && <span className="ml-2 text-green-600 text-[9px]">(Current)</span>}
                </span>
                {p.runs > 0 && (
                  <span className="text-xs font-bold text-slate-400">
                    {((p.runs / (inn?.runs || 1)) * 100).toFixed(1)}% of score
                  </span>
                )}
              </div>
              {/* Visual progress bar */}
              {inn?.runs > 0 && (
                <div className="w-full bg-slate-100 rounded-full h-1.5 mb-3">
                  <div
                    className={`h-1.5 rounded-full transition-all ${
                      p.runs > 50 ? 'bg-emerald-500' : p.runs > 30 ? 'bg-blue-500' : 'bg-slate-400'
                    }`}
                    style={{ width: `${Math.max(2, (p.runs / inn.runs) * 100)}%` }}
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-black">{p.runs || 0}</span>
                    <span className="text-sm text-slate-500">runs</span>
                  </div>
                  <div className="flex gap-3 text-xs text-slate-500 mt-1">
                    <span>{p.balls || 0} balls</span>
                    <span>SR: {p.balls > 0 ? ((p.runs / p.balls) * 100).toFixed(1) : '0.0'}</span>
                  </div>
                </div>
                <div className="text-right text-sm">
                  <div className="font-medium">{playerName(p.batsman1Id || p.batsman1, players)}</div>
                  <div className="font-medium">{playerName(p.batsman2Id || p.batsman2, players)}</div>
                  {p.fours > 0 || p.sixes > 0 ? (
                    <div className="text-xs text-slate-400 mt-1">
                      {p.fours > 0 && <span className="text-blue-500">{p.fours} 4s </span>}
                      {p.sixes > 0 && <span className="text-purple-500">{p.sixes} 6s</span>}
                    </div>
                  ) : null}
                </div>
              </div>
              {/* Over range */}
              {(p.startOver != null || p.endOver != null) && (
                <div className="mt-2 text-[10px] font-bold text-slate-400 flex gap-2">
                  {p.startOver != null && <span>From Over {p.startOver}</span>}
                  {p.endOver != null && <span>To Over {p.endOver}</span>}
                  {p.startOver != null && p.endOver != null && (
                    <span>({(p.endOver - (p.startOver || 0)).toFixed(1)} ov span)</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-8">
      {allInnings.map((inn, idx) => (
        <section key={idx}>
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-sm font-black">
              {teamName(getTeamById(match, inn.team))} Innings
            </h2>
            <span className="text-xs font-bold text-slate-400">
              {inn.runs || 0}/{inn.wickets || 0} ({formatOvers(inn.balls)} ov)
            </span>
          </div>
          {formatPartnerships(partnershipData[idx], idx)}
        </section>
      ))}
    </div>
  );
}

function OversTab({ matchId }) {
  return (
    <section>
      <Overs matchId={matchId} />
    </section>
  );
}

function LiveStatsTab({ matchId }) {
  return (
    <section>
      <LiveStats matchId={matchId} />
    </section>
  );
}

function GraphsTab({ match, matchId, innings }) {
  const [graphData, setGraphData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!matchId && !match?._id) return;
    api.get(`/matches/${matchId || match._id}/graph-data`)
      .then(res => setGraphData(res.data))
      .catch(() => setGraphData(null))
      .finally(() => setLoading(false));
  }, [matchId, match?._id]);

  if (loading) return <div className="text-center text-slate-500 py-8">Loading graphs...</div>;
  if (!graphData) return <div className="text-center text-slate-500 py-8">No graph data available</div>;

  const inn1 = match?.innings?.[0];
  const inn2 = match?.innings?.[1];

  return (
    <div className="space-y-8">
      {/* Manhattan Graph */}
      <section>
        <h3 className="text-sm font-black mb-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
          Runs Per Over (Manhattan)
        </h3>
        <ManhattanGraph match={match} innings={0} />
      </section>

      {/* Worm Graph */}
      <section>
        <h3 className="text-sm font-black mb-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-500"></span>
          Innings Progression (Worm)
        </h3>
        <WormGraph match={match} />
      </section>

      {/* Run Rate Graph */}
      {inn2 && (
        <section>
          <h3 className="text-sm font-black mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500"></span>
            Run Rate Comparison
          </h3>
          <RunRateGraph match={match} />
        </section>
      )}

      {/* Win Probability */}
      {graphData.winProbability?.length > 0 && (
        <section>
          <h3 className="text-sm font-black mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-rose-500"></span>
            Win Probability
          </h3>
          <WinProbabilityChart
            winProbHistory={graphData.winProbability}
            currentBattingProb={graphData.winProbability[graphData.winProbability.length - 1]?.team1 || 50}
            currentBowlingProb={graphData.winProbability[graphData.winProbability.length - 1]?.team2 || 50}
            battingTeamName={inn2?.team?.name || match?.teams?.[0]?.name || "Team 1"}
            bowlingTeamName={inn1?.team?.name || match?.teams?.[1]?.name || "Team 2"}
          />
        </section>
      )}

      {/* Wagon Zone */}
      <section>
        <h3 className="text-sm font-black mb-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-purple-500"></span>
          Shot Zone Analysis
        </h3>
        <WagonZone matchId={matchId || match._id} match={match} innings={match.currentInnings || 0} />
      </section>
    </div>
  );
}

export default EnhancedMatchTabs;


