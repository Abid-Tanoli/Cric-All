import React, { useEffect, useMemo, useState } from "react";
import { api } from "../services/api";

const idOf = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return String(value._id || value.id || "");
};

const sameId = (a, b) => idOf(a) && idOf(a) === idOf(b);

const playerName = (p) => {
  if (!p) return "Unknown";
  if (typeof p === "string") return p;
  return p.name || `${p.firstName || ""} ${p.lastName || ""}`.trim() || "Player";
};

export default function PlayingXI({ matchId, compact = false, className = "" }) {
  const [playing, setPlaying] = useState(null);
  const [match, setMatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTeam, setActiveTeam] = useState(0);
  const [showStats, setShowStats] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const res = await api.get(`/matches/${matchId}`);
        if (!mounted) return;
        const m = res.data || {};
        setMatch(m);
        if (m.playingXI && m.playingXI.length > 0) {
          setPlaying(
            m.playingXI.map((xi) => ({
              name: xi.team?.name || `Team ${xi.team}`,
              shortName: xi.team?.shortName || xi.team?.name || `Team ${xi.team}`,
              teamId: idOf(xi.team),
              logo: xi.team?.logo,
              players: xi.players || [],
            }))
          );
        } else if (m.teams && m.teams.length) {
          setPlaying(
            m.teams.map((t) => ({
              name: t.name,
              shortName: t.shortName || t.name,
              teamId: idOf(t),
              logo: t.logo,
              players: t.players || t.playingXI || [],
            }))
          );
        } else {
          setPlaying([]);
        }
      } catch (err) {
        console.error("Failed to load playing XI:", err);
        setPlaying([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => (mounted = false);
  }, [matchId]);

  const teamRoles = useMemo(() => {
    return new Map((match?.teamRoles || []).map((entry) => [String(entry.team?._id || entry.team), entry]));
  }, [match]);

  const inningsBattingMap = useMemo(() => {
    const map = new Map();
    (match?.innings || []).forEach(inn => {
      const teamId = idOf(inn.team);
      (inn.batting || []).forEach(b => {
        map.set(idOf(b.player), {
          runs: b.runs || 0,
          balls: b.balls || 0,
          fours: b.fours || 0,
          sixes: b.sixes || 0,
          isOut: b.isOut,
          strikeRate: b.balls ? ((b.runs || 0) / b.balls * 100).toFixed(1) : "-",
        });
      });
    });
    return map;
  }, [match]);

  const inningsBowlingMap = useMemo(() => {
    const map = new Map();
    (match?.innings || []).forEach(inn => {
      (inn.bowling || []).forEach(b => {
        map.set(idOf(b.player), {
          wickets: b.wickets || 0,
          runs: b.runs || 0,
          balls: b.balls || 0,
          economy: b.balls ? (b.runs || 0) / (b.balls / 6) : "-",
        });
      });
    });
    return map;
  }, [match]);

  const playingBattingOrder = useMemo(() => {
    const currentInnings = match?.innings?.[match.currentInnings ?? 0];
    const orderMap = new Map();
    (currentInnings?.batting || []).forEach((b, idx) => {
      orderMap.set(idOf(b.player), idx);
    });
    return orderMap;
  }, [match]);

  const getPlayerStats = (playerId) => {
    const bat = inningsBattingMap.get(playerId);
    const bowl = inningsBowlingMap.get(playerId);
    return { bat, bowl };
  };

  if (loading) {
    return (
      <div className={`${className} ${compact ? "space-y-2" : "space-y-4"}`}>
        {[1, 2].map(i => (
          <div key={i} className="animate-pulse bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-100 h-14" />
            <div className="p-3 space-y-2">
              {[1, 2, 3].map(j => (
                <div key={j} className="h-8 bg-slate-100 rounded" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!playing || playing.length === 0) {
    return (
      <div className={`p-6 text-center bg-white rounded-xl border border-slate-200 ${className}`}>
        <svg className="w-12 h-12 mx-auto mb-3 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <p className="text-sm font-bold text-slate-400">Playing XI not available</p>
      </div>
    );
  }

  const currentInningsIdx = match?.currentInnings ?? 0;
  const battingTeamId = idOf(match?.innings?.[currentInningsIdx]?.team);

  if (compact) {
    return (
      <div className={`space-y-3 text-sm ${className}`}>
        {playing.map((team, idx) => (
          <div key={idx} className="rounded-xl bg-white/5 p-3 border border-slate-700/50">
            <div className="flex items-center gap-2 mb-2">
              {team.logo && <img src={team.logo} alt="" className="w-5 h-5 rounded-full" />}
              <h4 className="font-black uppercase tracking-wide text-white text-xs">{team.name}</h4>
              {sameId(team.teamId, battingTeamId) && (
                <span className="ml-auto text-[9px] text-emerald-400 font-bold">BATTING</span>
              )}
            </div>
            {Array.isArray(team.players) && team.players.length > 0 ? (
              <ol className="space-y-1">
                {team.players.map((p, i) => {
                  const pid = idOf(p);
                  const roles = teamRoles.get(team.teamId) || {};
                  return (
                    <li key={i} className="flex items-center justify-between text-gray-200 text-xs">
                      <span className="truncate">{playerName(p)}</span>
                      <span className="flex gap-1 shrink-0">
                        {sameId(roles.captain, pid) && <span className="text-[9px] text-blue-400 font-black">C</span>}
                        {sameId(roles.viceCaptain, pid) && <span className="text-[9px] text-emerald-400 font-black">VC</span>}
                        {(roles.wicketKeepers || []).some(wk => sameId(wk, pid)) && <span className="text-[9px] text-amber-400 font-black">WK</span>}
                      </span>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="text-gray-400 text-xs">No players listed</p>
            )}
          </div>
        ))}
      </div>
    );
  }

  const team = playing[activeTeam];
  if (!team) return null;

  const teamRolesForTeam = teamRoles.get(team.teamId) || {};

  const sortedPlayers = [...(team.players || [])].sort((a, b) => {
    const orderA = playingBattingOrder.get(idOf(a));
    const orderB = playingBattingOrder.get(idOf(b));
    if (orderA !== undefined && orderB !== undefined) return orderA - orderB;
    if (orderA !== undefined) return -1;
    if (orderB !== undefined) return 1;
    return 0;
  });

  return (
    <div className={`space-y-4 ${className}`}>
      {match?.tossWinner && (
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3">
          <span className="text-lg">🎲</span>
          <p className="text-sm font-semibold text-amber-800">
            {typeof match.tossWinner === "object" ? match.tossWinner.name : match.tossWinner} won the toss and elected to {match.tossDecision || "bat"}
          </p>
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto pb-1">
        {playing.map((team, idx) => (
          <button
            key={idx}
            onClick={() => setActiveTeam(idx)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-black transition-all ${
              activeTeam === idx
                ? "bg-[#031d44] text-white shadow-lg"
                : "bg-white text-slate-600 border border-slate-200 hover:border-slate-300"
            }`}
          >
            {team.logo && <img src={team.logo} alt="" className="w-5 h-5 rounded-full" />}
            <span>{team.name}</span>
            {sameId(team.teamId, battingTeamId) && activeTeam === idx && (
              <span className="text-[9px] bg-emerald-400/20 text-emerald-300 px-1.5 py-0.5 rounded font-bold">BAT</span>
            )}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <div className="bg-[#07172f] px-5 py-4">
          <div className="flex items-center gap-3">
            {team.logo && <img src={team.logo} alt="" className="w-10 h-10 rounded-full ring-2 ring-white/20" />}
            <div>
              <h3 className="text-lg font-black text-white">{team.name}</h3>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                {team.players?.length || 0} players • {sameId(team.teamId, battingTeamId) ? "Currently batting" : match?.status === "completed" ? "Match complete" : "Yet to bat"}
              </p>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => setShowStats(false)}
              className={`px-3 py-1 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${
                !showStats ? "bg-white/20 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              Players
            </button>
            <button
              onClick={() => setShowStats(true)}
              className={`px-3 py-1 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${
                showStats ? "bg-white/20 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              Stats
            </button>
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          {sortedPlayers.length > 0 ? sortedPlayers.map((p, i) => {
            const pid = idOf(p);
            const isCaptain = sameId(teamRolesForTeam.captain, pid);
            const isViceCaptain = sameId(teamRolesForTeam.viceCaptain, pid);
            const isKeeper = (teamRolesForTeam.wicketKeepers || []).some(wk => sameId(wk, pid));
            const stats = getPlayerStats(pid);
            const battingOrder = playingBattingOrder.get(pid);
            const hasBatted = battingOrder !== undefined;
            const role = p.playingRole || p.role || "";

            return (
              <div key={pid || i} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-black text-slate-500">
                    {battingOrder !== undefined ? battingOrder + 1 : i + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-sm font-black text-slate-900">{playerName(p)}</p>
                      {hasBatted && <span className="text-[9px] text-slate-400 font-bold shrink-0">({battingOrder + 1})</span>}
                    </div>
                    {showStats ? (
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                        {stats.bat && (
                          <span className="text-[10px] font-bold text-slate-500">
                            <span className="text-blue-600">{stats.bat.runs}</span>
                            <span className="text-slate-400">({stats.bat.balls}b, {stats.bat.fours}x4, {stats.bat.sixes}x6)</span>
                          </span>
                        )}
                        {stats.bowl && stats.bowl.wickets > 0 && (
                          <span className="text-[10px] font-bold text-slate-500">
                            <span className="text-red-600">{stats.bowl.wickets}/{stats.bowl.runs}</span>
                            <span className="text-slate-400">({stats.bowl.balls ? `${Math.floor(stats.bowl.balls / 6)}.${stats.bowl.balls % 6}` : "0.0"} ov)</span>
                          </span>
                        )}
                        {!stats.bat && !stats.bowl && (
                          <span className="text-[10px] text-slate-400 font-medium">{role || "Yet to feature"}</span>
                        )}
                      </div>
                    ) : (
                      role && <p className="text-[10px] text-slate-400 font-medium mt-0.5">{role}</p>
                    )}
                    <div className="flex gap-1 mt-0.5">
                      {isCaptain && <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[9px] font-black text-blue-700 leading-none">C</span>}
                      {isViceCaptain && <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-black text-emerald-700 leading-none">VC</span>}
                      {isKeeper && <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-black text-amber-700 leading-none">WK</span>}
                      {hasBatted && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-black text-slate-500 leading-none">BAT</span>}
                    </div>
                  </div>
                </div>
                {showStats && stats.bat && (
                  <div className="text-right shrink-0">
                    <p className="text-sm font-black text-slate-800">{stats.bat.runs}</p>
                    <p className="text-[9px] text-slate-400 font-bold">SR {stats.bat.strikeRate}</p>
                  </div>
                )}
              </div>
            );
          }) : (
            <p className="px-5 py-6 text-sm text-slate-400 text-center">No players listed for this team</p>
          )}
        </div>
      </div>

      {playing.length > 1 && (
        <div className="flex gap-2 justify-center">
          {playing.map((team, idx) => (
            <button
              key={idx}
              onClick={() => setActiveTeam(idx)}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                activeTeam === idx
                  ? "bg-[#031d44] text-white"
                  : "bg-slate-100 text-slate-500 hover:bg-slate-200"
              }`}
            >
              {team.shortName || team.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
