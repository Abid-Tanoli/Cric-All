import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../services/api";
import Header from "../components/Header";
import BlogGallery from "../components/BlogGallery";
import BoundaryMeter from "../components/BoundaryMeter";

export default function Series() {
  const { seriesId } = useParams();
  const [series, setSeries] = useState(null);
  const [matches, setMatches] = useState([]);
  const [squads, setSquads] = useState([]);
  const [stats, setStats] = useState({ topRunScorers: [], topWicketTakers: [], boundaryMeter: { sixes: 0, fours: 0, mostSixes: [], mostFours: [] } });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("matches");

  useEffect(() => { loadData(); }, [seriesId]);

  const loadData = async () => {
    try {
      setLoading(true);
      let seriesData = null;
      let matchesData = [];
      let squadData = [];

      const endpoints = [
        { url: `/series/${seriesId}`, matchesField: 'matches', squadsField: null },
        { url: `/events/${seriesId}`, matchesField: 'matches', squadsField: 'eventSquads' },
        { url: `/tournaments/${seriesId}`, matchesField: 'matches', squadsField: 'tournamentSquads' }
      ];

      for (const ep of endpoints) {
        try {
          const res = await api.get(ep.url);
          seriesData = res.data;
          matchesData = seriesData.matches || [];
          if (ep.squadsField) {
            squadData = seriesData[ep.squadsField] || [];
          }
          break;
        } catch (e) {
          console.log(`Failed ${ep.url}:`, e.message);
        }
      }

      if (!seriesData) {
        try {
          const matchRes = await api.get(`/matches/${seriesId}`);
          seriesData = {
            _id: matchRes.data._id,
            name: matchRes.data.title || "Match",
            format: matchRes.data.matchType || "T20",
            status: matchRes.data.status || "upcoming"
          };
          matchesData = [matchRes.data];
        } catch (e4) {
          console.log("Not a match either");
        }
        
        if (!seriesData) {
          setSeries(null);
          setLoading(false);
          return;
        }
      }

      // Resolve match IDs or populate matches if they come as references
      const matchIds = matchesData.map(m => m._id || m).filter(Boolean);
      const allMatches = await Promise.all(
        matchIds.map(id => api.get(`/matches/${id}`).catch(() => null))
      );
      const validMatches = allMatches.filter(r => r?.data).map(r => r.data);

      setSeries(seriesData);
      setMatches(validMatches);
      setSquads(squadData);

      // Calculate stats from completed matches
      const completedMatches = validMatches.filter(m => m?.status === "completed");
      const matchDetails = await Promise.all(
        completedMatches.map(m => api.get(`/matches/${m._id}`).catch(() => ({ data: m })))
      );
      const playerStats = calculateStats(matchDetails.map(r => r.data));
      setStats(playerStats);
    } catch (err) {
      console.error("Failed to load series:", err);
    } finally {
      setLoading(false);
    }
  };

  const calculateStats = (completedMatches) => {
    const battingStats = {};
    const bowlingStats = {};

    completedMatches.forEach(match => {
      if (!match.innings) return;
      match.innings.forEach(innings => {
        // Batting stats
        (innings.batting || []).forEach(b => {
          if (!battingStats[b.player?._id || b.player]) {
            battingStats[b.player?._id || b.player] = {
              playerId: b.player?._id || b.player,
              name: b.player?.name || "Unknown",
              team: innings.team?.name || "Unknown",
              teamId: innings.team?._id,
              matches: 0, innings: 0, runs: 0, balls: 0, fours: 0, sixes: 0,
              highest: 0, notOuts: 0, average: 0, strikeRate: 0, fifties: 0, hundreds: 0
            };
          }
          const s = battingStats[b.player?._id || b.player];
          s.matches = Math.max(s.matches, 1);
          s.innings += 1;
          s.runs += b.runs || 0;
          s.balls += b.balls || 0;
          s.fours += b.fours || 0;
          s.sixes += b.sixes || 0;
          if (b.runs > s.highest) s.highest = b.runs;
          if (!b.isOut) s.notOuts += 1;
          if (b.runs >= 50 && b.runs < 100) s.fifties += 1;
          if (b.runs >= 100) s.hundreds += 1;
        });

        // Bowling stats
        (innings.bowling || []).forEach(b => {
          if (!bowlingStats[b.player?._id || b.player]) {
            bowlingStats[b.player?._id || b.player] = {
              playerId: b.player?._id || b.player,
              name: b.player?.name || "Unknown",
              team: innings.team?.name || "Unknown",
              teamId: innings.team?._id,
              matches: 0, overs: 0, balls: 0, maidens: 0, runs: 0, wickets: 0,
              average: 0, economy: 0, best: "0/0", fourWickets: 0, fiveWickets: 0
            };
          }
          const s = bowlingStats[b.player?._id || b.player];
          s.matches = Math.max(s.matches, 1);
          s.overs += b.overs || 0;
          s.balls += b.balls || 0;
          s.maidens += b.maidens || 0;
          s.runs += b.runs || 0;
          s.wickets += b.wickets || 0;
          const fig = `${b.wickets || 0}/${b.runs || 0}`;
          if (b.wickets > 0) {
            const currentBest = s.best.split("/").map(Number);
            if (b.wickets > currentBest[0] || (b.wickets === currentBest[0] && b.runs < currentBest[1])) {
              s.best = fig;
            }
          }
          if (b.wickets >= 4) s.fourWickets += 1;
          if (b.wickets >= 5) s.fiveWickets += 1;
        });
      });
    });

    // Calculate averages
    Object.values(battingStats).forEach(s => {
      s.average = s.innings - s.notOuts > 0 ? (s.runs / (s.innings - s.notOuts)).toFixed(2) : s.runs.toFixed(2);
      s.strikeRate = s.balls > 0 ? ((s.runs / s.balls) * 100).toFixed(2) : "0.00";
    });
    Object.values(bowlingStats).forEach(s => {
      s.average = s.wickets > 0 ? (s.runs / s.wickets).toFixed(2) : "-";
      s.economy = s.overs > 0 ? (s.runs / s.overs).toFixed(2) : "-";
    });

    const topRunScorers = Object.values(battingStats).sort((a, b) => b.runs - a.runs).slice(0, 20);
    const topWicketTakers = Object.values(bowlingStats).sort((a, b) => b.wickets - a.wickets).slice(0, 20);
    const boundaryPlayers = Object.values(battingStats);
    const boundaryMeter = {
      sixes: boundaryPlayers.reduce((sum, player) => sum + (player.sixes || 0), 0),
      fours: boundaryPlayers.reduce((sum, player) => sum + (player.fours || 0), 0),
      mostSixes: boundaryPlayers
        .filter(player => player.sixes > 0)
        .sort((a, b) => b.sixes - a.sixes)
        .slice(0, 5)
        .map(player => ({ playerId: player.playerId, name: player.name, team: player.team, count: player.sixes })),
      mostFours: boundaryPlayers
        .filter(player => player.fours > 0)
        .sort((a, b) => b.fours - a.fours)
        .slice(0, 5)
        .map(player => ({ playerId: player.playerId, name: player.name, team: player.team, count: player.fours }))
    };

    return { topRunScorers, topWicketTakers, boundaryMeter };
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f0f2f5] flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent"></div>
      </div>
    );
  }

  if (!series) {
    return (
      <div className="min-h-screen bg-[#f0f2f5] flex items-center justify-center">
        <div className="text-center">
          <p className="text-2xl font-black text-[#031d44] uppercase">Series not found</p>
          <Link to="/series" className="text-blue-600 hover:underline mt-4 block">Back to Series</Link>
        </div>
      </div>
    );
  }

  const tabs = [
    { key: "matches", label: "Matches" },
    { key: "points", label: "Points Table" },
    { key: "stats", label: "Stats" },
    { key: "squads", label: "Squads" },
  ];

  const completedMatches = matches.filter(m => m.status === "completed");
  const upcomingMatches = matches.filter(m => m.status === "upcoming" || m.status === "scheduled");

  return (
    <div className="bg-[#f0f2f5] min-h-screen">
      <Header />

      {/* Series Header */}
      <div className="bg-gradient-to-r from-[#031d44] via-[#0a2d5e] to-[#031d44] text-white">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <div className="flex items-center gap-3 text-sm text-blue-300 mb-4">
            <Link to="/" className="hover:text-white transition-colors">Home</Link>
            <span>-</span>
            <span>{series.name}</span>
          </div>

          <div className="flex items-center gap-6">
            {series.logo ? (
              <img src={series.logo} alt={series.name} className="w-24 h-24 rounded-2xl object-cover border-2 border-white/20" />
            ) : (
              <div className="w-24 h-24 rounded-2xl bg-white/10 flex items-center justify-center border-2 border-white/20">
                <span className="text-4xl font-black text-white/80">{series.name?.charAt(0)}</span>
              </div>
            )}
            <div>
              <h1 className="text-3xl font-black uppercase tracking-tight mb-2">{series.name}</h1>
              <div className="flex items-center gap-4 text-sm text-blue-200 flex-wrap">
                <span className="px-3 py-1 bg-white/10 rounded-full text-xs font-bold uppercase">{series.eventType?.replace('-', ' ') || series.type}</span>
                <span className="px-3 py-1 bg-white/10 rounded-full text-xs font-bold uppercase">{series.format}</span>
                <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${series.status === "live" ? "bg-red-600 text-white animate-pulse" :
                    series.status === "completed" ? "bg-green-600 text-white" : "bg-blue-500 text-white"
                  }`}>{series.status}</span>
                <span className="text-xs">{series.totalMatches || matches.length} Matches</span>
              </div>
              <p className="text-sm text-blue-200 mt-2">
                {series.startDate ? new Date(series.startDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ""}
                {series.endDate && ` - ${new Date(series.endDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`}
                {series.venue && ` - ${series.venue}`}
              </p>
            </div>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="bg-white/5 backdrop-blur-md border-t border-white/10 overflow-x-auto">
          <div className="max-w-7xl mx-auto px-4 flex">
            {tabs.map(t => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`px-6 py-4 text-xs font-black uppercase tracking-widest transition-all relative shrink-0 ${activeTab === t.key ? "text-white" : "text-blue-200/50 hover:text-white"
                  }`}
              >
                {t.label}
                {activeTab === t.key && <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-red-600 rounded-t" />}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Matches Tab */}
        {activeTab === "matches" && (
          <div className="space-y-8">
            {/* Completed Matches */}
            {completedMatches.length > 0 && (
              <div>
                <h2 className="text-xl font-black text-[#031d44] uppercase tracking-tight mb-4 flex items-center gap-2">
                  <span className="w-2 h-6 bg-green-600 rounded-full"></span>
                  Results ({completedMatches.length})
                </h2>
                <div className="space-y-3">
                  {completedMatches.map(match => (
                    <Link
                      key={match._id}
                      to={`/match/${match._id}`}
                      className="block bg-white rounded-xl shadow-md overflow-hidden border border-slate-200 hover:shadow-lg transition-all"
                    >
                      <div className="p-4">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                            {match.matchNumber ? `Match ${match.matchNumber}` : match.title}
                          </span>
                          <span className="text-[10px] font-bold text-slate-400">
                            {match.venue}
                          </span>
                        </div>
                        <div className="space-y-2">
                          {match.innings?.map((inn, idx) => {
                            const team = match.teams?.[idx] || {};
                            return (
                              <div key={idx} className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  {team.logo && <img src={team.logo} alt={team.name} className="w-6 h-6 rounded-full object-cover" />}
                                  <span className="font-bold text-sm text-slate-800 uppercase">{team.shortName || team.name}</span>
                                </div>
                                <span className="font-black text-sm text-slate-800">
                                  {inn.runs || 0}/{inn.wickets || 0} <span className="text-xs text-slate-500 font-bold">({inn.overs || 0}.{inn.balls % 6 || 0})</span>
                                </span>
                              </div>
                            );
                          })}
                        </div>
                        {match.result?.description && (
                          <div className="mt-3 pt-3 border-t border-slate-100">
                            <p className="text-sm font-bold text-green-700">{match.result.description}</p>
                          </div>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Upcoming Matches */}
            {upcomingMatches.length > 0 && (
              <div>
                <h2 className="text-xl font-black text-[#031d44] uppercase tracking-tight mb-4 flex items-center gap-2">
                  <span className="w-2 h-6 bg-blue-600 rounded-full"></span>
                  Upcoming ({upcomingMatches.length})
                </h2>
                <div className="space-y-3">
                  {upcomingMatches.map(match => (
                    <Link
                      key={match._id}
                      to={`/match/${match._id}`}
                      className="block bg-white rounded-xl shadow-md overflow-hidden border border-slate-200 hover:shadow-lg transition-all"
                    >
                      <div className="p-4">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                            {match.matchNumber ? `Match ${match.matchNumber}` : match.title}
                          </span>
                          <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-[9px] font-bold uppercase">
                            {new Date(match.startAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                        </div>
                        <div className="flex items-center justify-center gap-6 py-2">
                          {match.teams?.map((team, idx) => (
                            <div key={idx} className="flex flex-col items-center flex-1">
                              {team.logo && <img src={team.logo} alt={team.name} className="w-10 h-10 rounded-full object-cover mb-2" />}
                              <span className="font-bold text-sm text-slate-800 uppercase text-center">{team.shortName || team.name}</span>
                            </div>
                          ))}
                          <span className="text-2xl font-black text-slate-300">VS</span>
                        </div>
                        <p className="text-center text-[10px] text-slate-500 font-bold mt-2">
                          {new Date(match.startAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} - {match.venue}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Points Table Tab */}
        {activeTab === "points" && series.pointsTable && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-200">
              <div className="p-6 border-b border-slate-200 bg-gradient-to-r from-[#031d44] to-[#0a2d5e] text-white">
                <h3 className="text-xl font-black uppercase tracking-tight">Points Table</h3>
                <p className="text-xs text-blue-200 mt-1">{series.name}</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 text-slate-600 uppercase text-[11px] font-bold">
                    <tr>
                      <th className="px-4 py-3">Pos</th>
                      <th className="px-4 py-3">Team</th>
                      <th className="px-2 py-3 text-center">M</th>
                      <th className="px-2 py-3 text-center">W</th>
                      <th className="px-2 py-3 text-center">L</th>
                      <th className="px-2 py-3 text-center">T/NR</th>
                      <th className="px-4 py-3 text-center">NRR</th>
                      <th className="px-4 py-3 text-center">For</th>
                      <th className="px-4 py-3 text-center">Against</th>
                      <th className="px-4 py-3 text-center bg-blue-50 text-blue-800">PTS</th>
                      <th className="px-4 py-3">Form</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {[...series.pointsTable]
                      .sort((a, b) => b.points - a.points || b.netRunRate - a.netRunRate)
                      .map((entry, idx) => (
                        <tr key={idx} className={`${idx < 4 ? "bg-green-50/30" : "hover:bg-slate-50"} transition-colors`}>
                          <td className="px-4 py-4 font-bold text-slate-400">{idx + 1}</td>
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded bg-white border flex items-center justify-center overflow-hidden">
                                {entry.team?.logo ? <img src={entry.team.logo} className="w-6 h-6 object-contain" /> : <div className="text-[10px] font-bold">{entry.team?.shortName || "T"}</div>}
                              </div>
                              <span className="font-bold text-slate-800">{entry.team?.name}</span>
                            </div>
                          </td>
                          <td className="px-2 py-4 text-center font-medium">{entry.matchesPlayed || 0}</td>
                          <td className="px-2 py-4 text-center text-green-600 font-bold">{entry.won || 0}</td>
                          <td className="px-2 py-4 text-center text-red-600 font-bold">{entry.lost || 0}</td>
                          <td className="px-2 py-4 text-center text-slate-500 font-medium">{(entry.tied || 0) + (entry.noResult || 0)}</td>
                          <td className="px-4 py-4 text-center font-bold text-blue-600">{(entry.netRunRate || 0).toFixed(3)}</td>
                          <td className="px-4 py-4 text-center text-[11px]">
                            <span className="block font-bold">{entry.for || 0}</span>
                            <span className="text-slate-400">{entry.wicketsAgainst || 0} wkts</span>
                          </td>
                          <td className="px-4 py-4 text-center text-[11px]">
                            <span className="block font-bold">{entry.against || 0}</span>
                            <span className="text-slate-400">{entry.wicketsFor || 0} wkts</span>
                          </td>
                          <td className="px-4 py-4 text-center font-black bg-blue-50 text-blue-900 text-lg">{entry.points || 0}</td>
                          <td className="px-4 py-4">
                            <div className="flex gap-1">
                              {entry.seriesForm?.map((f, i) => (
                                <span key={i} className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold text-white ${f === "W" ? "bg-green-500" : f === "L" ? "bg-red-500" : "bg-slate-400"}`}>
                                  {f}
                                </span>
                              ))}
                              {!entry.seriesForm?.length && <span className="text-xs text-slate-300">-</span>}
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <div className="p-4 bg-slate-50 border-t border-slate-200">
                <p className="text-xs text-slate-500">Top 4 teams qualify for playoffs</p>
              </div>
            </div>
          </div>
        )}

        {/* Stats Tab */}
        {activeTab === "stats" && (
          <div className="space-y-8">
            <BoundaryMeter stats={stats.boundaryMeter || {}} />

            {/* Most Runs */}
            <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-200">
              <div className="p-6 border-b border-slate-200 bg-gradient-to-r from-blue-600 to-blue-700 text-white">
                <h3 className="text-xl font-black uppercase tracking-tight flex items-center gap-2">
                  <span className="text-2xl">🏏</span> Most Runs
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 text-slate-600 uppercase text-[11px] font-bold">
                    <tr>
                      <th className="px-4 py-3">#</th>
                      <th className="px-4 py-3">Player</th>
                      <th className="px-2 py-3 text-center">Mat</th>
                      <th className="px-2 py-3 text-center">Inn</th>
                      <th className="px-2 py-3 text-center">NO</th>
                      <th className="px-4 py-3 text-center font-black text-blue-800 bg-blue-50">Runs</th>
                      <th className="px-4 py-3 text-center">HS</th>
                      <th className="px-4 py-3 text-center">Avg</th>
                      <th className="px-4 py-3 text-center">SR</th>
                      <th className="px-4 py-3 text-center">50s</th>
                      <th className="px-4 py-3 text-center">100s</th>
                      <th className="px-4 py-3 text-center">4s</th>
                      <th className="px-4 py-3 text-center">6s</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {stats.topRunScorers.map((s, idx) => (
                      <tr key={s.playerId} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 font-bold text-slate-400">{idx + 1}</td>
                        <td className="px-4 py-3">
                          <div className="font-bold text-slate-800">{s.name}</div>
                          <div className="text-[10px] text-slate-500">{s.team}</div>
                        </td>
                        <td className="px-2 py-3 text-center">{s.matches}</td>
                        <td className="px-2 py-3 text-center">{s.innings}</td>
                        <td className="px-2 py-3 text-center">{s.notOuts}</td>
                        <td className="px-4 py-3 text-center font-black text-blue-800 bg-blue-50/50 text-lg">{s.runs}</td>
                        <td className="px-4 py-3 text-center font-bold">{s.highest}</td>
                        <td className="px-4 py-3 text-center">{s.average}</td>
                        <td className="px-4 py-3 text-center">{s.strikeRate}</td>
                        <td className="px-4 py-3 text-center">{s.fifties > 0 && <span className="px-1.5 py-0.5 bg-slate-100 rounded font-bold">{s.fifties}</span>}</td>
                        <td className="px-4 py-3 text-center">{s.hundreds > 0 && <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-800 rounded font-bold">{s.hundreds}</span>}</td>
                        <td className="px-4 py-3 text-center">{s.fours}</td>
                        <td className="px-4 py-3 text-center">{s.sixes}</td>
                      </tr>
                    ))}
                    {stats.topRunScorers.length === 0 && (
                      <tr><td colSpan="13" className="px-4 py-8 text-center text-slate-500">No batting stats available yet</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Most Wickets */}
            <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-200">
              <div className="p-6 border-b border-slate-200 bg-gradient-to-r from-green-600 to-green-700 text-white">
                <h3 className="text-xl font-black uppercase tracking-tight flex items-center gap-2">
                  <span className="text-2xl">⚾</span> Most Wickets
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 text-slate-600 uppercase text-[11px] font-bold">
                    <tr>
                      <th className="px-4 py-3">#</th>
                      <th className="px-4 py-3">Player</th>
                      <th className="px-2 py-3 text-center">Mat</th>
                      <th className="px-2 py-3 text-center">Ov</th>
                      <th className="px-4 py-3 text-center font-black text-green-800 bg-green-50">Wkts</th>
                      <th className="px-4 py-3 text-center">BBI</th>
                      <th className="px-4 py-3 text-center">Avg</th>
                      <th className="px-4 py-3 text-center">Econ</th>
                      <th className="px-4 py-3 text-center">SR</th>
                      <th className="px-4 py-3 text-center">4W</th>
                      <th className="px-4 py-3 text-center">5W</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {stats.topWicketTakers.map((s, idx) => (
                      <tr key={s.playerId} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 font-bold text-slate-400">{idx + 1}</td>
                        <td className="px-4 py-3">
                          <div className="font-bold text-slate-800">{s.name}</div>
                          <div className="text-[10px] text-slate-500">{s.team}</div>
                        </td>
                        <td className="px-2 py-3 text-center">{s.matches}</td>
                        <td className="px-2 py-3 text-center">{s.overs}</td>
                        <td className="px-4 py-3 text-center font-black text-green-800 bg-green-50/50 text-lg">{s.wickets}</td>
                        <td className="px-4 py-3 text-center font-bold">{s.best}</td>
                        <td className="px-4 py-3 text-center">{s.average}</td>
                        <td className="px-4 py-3 text-center">{s.economy}</td>
                        <td className="px-4 py-3 text-center">{s.balls > 0 && s.wickets > 0 ? ((s.balls / s.wickets) * 6).toFixed(1) : "-"}</td>
                        <td className="px-4 py-3 text-center">{s.fourWickets > 0 && <span className="px-1.5 py-0.5 bg-slate-100 rounded font-bold">{s.fourWickets}</span>}</td>
                        <td className="px-4 py-3 text-center">{s.fiveWickets > 0 && <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-800 rounded font-bold">{s.fiveWickets}</span>}</td>
                      </tr>
                    ))}
                    {stats.topWicketTakers.length === 0 && (
                      <tr><td colSpan="11" className="px-4 py-8 text-center text-slate-500">No bowling stats available yet</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Squads Tab */}
        {activeTab === "squads" && (
          <div className="space-y-6">
            <h2 className="text-xl font-black text-[#031d44] uppercase tracking-tight flex items-center gap-2">
              <span className="w-2 h-6 bg-purple-600 rounded-full"></span>
              Team Squads
            </h2>
            {squads.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-xl p-12 text-center border border-slate-200">
                <p className="text-slate-500 font-bold">Squads not announced yet</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {squads.map(squad => (
                  <div key={squad.team?._id} className="bg-white rounded-xl shadow-lg overflow-hidden border border-slate-200">
                    <div className="bg-gradient-to-r from-[#031d44] to-[#0a2d5e] text-white p-4">
                      <div className="flex items-center gap-3">
                        {squad.team?.logo && <img src={squad.team.logo} alt={squad.team.name} className="w-10 h-10 rounded-lg object-cover" />}
                        <div>
                          <h3 className="text-lg font-black uppercase">{squad.team?.name}</h3>
                          <p className="text-[10px] text-blue-200 font-bold">{squad.players?.length || 0} Players</p>
                        </div>
                      </div>
                    </div>
                    <div className="p-4">
                      {/* Captain & VC */}
                      <div className="flex items-center gap-4 mb-3 text-xs font-bold">
                        <span className="text-blue-600">C: {squad.players?.find(p => p._id === squad.captain)?.name || "TBD"}</span>
                        <span className="text-green-600">VC: {squad.players?.find(p => p._id === squad.viceCaptain)?.name || "TBD"}</span>
                        <span className="text-orange-600">WK: {squad.wicketKeepers?.length || 0}</span>
                      </div>
                      {/* Players Grid */}
                      <div className="flex flex-wrap gap-2">
                        {squad.players?.map(p => {
                          const isC = p._id === squad.captain;
                          const isVC = p._id === squad.viceCaptain;
                          const isWK = squad.wicketKeepers?.includes(p._id);
                          return (
                            <Link
                              key={p._id}
                              to={`/players/${p._id}`}
                              className="px-3 py-1.5 bg-slate-100 hover:bg-blue-100 hover:text-blue-700 rounded-lg text-xs font-bold transition-colors flex items-center gap-1"
                            >
                              {p.name}
                              {isC && <span className="text-blue-600">(C)</span>}
                              {isVC && <span className="text-green-600">(VC)</span>}
                              {isWK && <span className="text-orange-600">(WK)</span>}
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Blog Gallery */}
        <div className="mt-12">
          <BlogGallery category="Series" relatedId={seriesId} />
        </div>
      </div>
    </div>
  );
}
