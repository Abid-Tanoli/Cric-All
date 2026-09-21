import React, { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";

const statCategories = [
  {
    key: "batting",
    label: "Batting",
    stats: [
      { key: "matches", label: "Matches" },
      { key: "innings", label: "Innings" },
      { key: "notOuts", label: "Not Outs" },
      { key: "runs", label: "Runs", highlight: true },
      { key: "highScore", label: "High Score" },
      { key: "average", label: "Average", compute: (s) => { const no = s.notOuts || 0; const inns = s.innings || 0; return inns > no ? ((s.runs || 0) / (inns - no)).toFixed(2) : s.runs > 0 ? (s.runs || 0).toFixed(2) : "0.00"; } },
      { key: "strikeRate", label: "Strike Rate" },
      { key: "hundreds", label: "100s" },
      { key: "fifties", label: "50s" },
      { key: "fours", label: "4s" },
      { key: "sixes", label: "6s" },
    ],
  },
  {
    key: "bowling",
    label: "Bowling",
    stats: [
      { key: "bowlingInnings", label: "Innings", fallback: "innings" },
      { key: "balls", label: "Balls" },
      { key: "runsConceded", label: "Runs" },
      { key: "wickets", label: "Wickets", highlight: true },
      { key: "bestBowling", label: "BBI" },
      { key: "economy", label: "Economy" },
      { key: "bowlAvg", label: "Average", compute: (s) => s.wickets > 0 ? ((s.runsConceded || 0) / s.wickets).toFixed(2) : "0.00" },
      { key: "fourWickets", label: "4w" },
      { key: "fiveWickets", label: "5w" },
    ],
  },
  {
    key: "fielding",
    label: "Fielding",
    stats: [
      { key: "catches", label: "Catches" },
      { key: "stumpings", label: "Stumpings" },
      { key: "runOuts", label: "Run Outs" },
    ],
  },
];

const PlayerComparison = () => {
  const [players, setPlayers] = useState([]);
  const [player1, setPlayer1] = useState(null);
  const [player2, setPlayer2] = useState(null);
  const [search1, setSearch1] = useState("");
  const [search2, setSearch2] = useState("");
  const [results1, setResults1] = useState([]);
  const [results2, setResults2] = useState([]);
  const [loading, setLoading] = useState(false);

  const handleSearch = async (query, setResults) => {
    if (query.length < 2) { setResults([]); return; }
    try {
      const res = await api.get(`/players?search=${encodeURIComponent(query)}&limit=8`);
      setResults(res.data.players || []);
    } catch {
      setResults([]);
    }
  };

  const selectPlayer = (player, setter, setSearch, setResults) => {
    setter(player);
    setSearch(player.name);
    setResults([]);
  };

  const getStats = (p) => p?.stats || {};

  const statRow = (stat, p1Stats, p2Stats) => {
    const val1 = stat.compute ? stat.compute(p1Stats) : (p1Stats[stat.key] ?? p1Stats[stat.fallback] ?? 0);
    const val2 = stat.compute ? stat.compute(p2Stats) : (p2Stats[stat.key] ?? p2Stats[stat.fallback] ?? 0);

    const num1 = parseFloat(val1);
    const num2 = parseFloat(val2);

    let better = "none";
    if (!isNaN(num1) && !isNaN(num2)) {
      if (stat.key === "economy" || stat.key === "bowlAvg") {
        better = num1 < num2 ? "p1" : num2 < num1 ? "p2" : "none";
      } else {
        better = num1 > num2 ? "p1" : num2 > num1 ? "p2" : "none";
      }
    }

    return (
      <tr key={stat.key} className="border-b border-cric-border/50 hover:bg-cric-bg/50">
        <td className="py-2.5 pr-3 text-[10px] font-bold text-cric-muted uppercase tracking-wider">{stat.label}</td>
        <td className={`py-2.5 px-3 text-center font-black ${better === "p1" ? "text-green-600" : "text-cric-text"}`}>{val1}</td>
        <td className={`py-2.5 px-3 text-center font-black ${better === "p2" ? "text-green-600" : "text-cric-text"}`}>{val2}</td>
      </tr>
    );
  };

  return (
    <div className="min-h-screen bg-cric-bg text-cric-text font-sans">

      <div className="bg-gradient-to-r from-cric-text to-slate-800 text-white">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <Link to="/players" className="inline-flex items-center gap-2 text-white/60 hover:text-white mb-6 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span className="text-sm font-bold">Back to Players</span>
          </Link>
          <h1 className="text-4xl md:text-5xl font-black uppercase tracking-tighter italic">
            Player <span className="text-cric-accent">Comparison</span>
          </h1>
          <p className="text-white/60 text-sm font-bold mt-2 uppercase tracking-widest">Compare two players side by side</p>
        </div>
      </div>

      {/* Player Selection */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
          {/* Player 1 */}
          <div className="bg-cric-card rounded-xl border border-cric-border p-6">
            <h3 className="text-xs font-black text-cric-muted uppercase tracking-widest mb-4">Player 1</h3>
            <input
              type="text"
              placeholder="Search player..."
              value={search1}
              onChange={(e) => { setSearch1(e.target.value); handleSearch(e.target.value, setResults1); }}
              className="w-full bg-cric-bg border border-cric-border rounded-lg px-4 py-2.5 text-sm font-bold text-cric-text placeholder-cric-muted/50 focus:outline-none focus:border-cric-accent mb-2"
            />
            {results1.length > 0 && (
              <div className="bg-cric-card border border-cric-border rounded-lg overflow-hidden shadow-lg">
                {results1.map((p) => (
                  <button
                    key={p._id}
                    onClick={() => selectPlayer(p, setPlayer1, setSearch1, setResults1)}
                    className="w-full text-left px-4 py-2.5 hover:bg-cric-bg text-sm font-bold text-cric-text border-b border-cric-border/50 last:border-b-0 transition-colors"
                  >
                    {p.name}
                    {p.team?.name && <span className="text-cric-muted font-normal ml-2">({p.team.name})</span>}
                  </button>
                ))}
              </div>
            )}
            {player1 && (
              <div className="mt-4 bg-cric-bg rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-cric-accent rounded-full flex items-center justify-center text-white font-black text-sm">
                    {player1.name?.charAt(0)}
                  </div>
                  <div>
                    <p className="font-black text-cric-text">{player1.name}</p>
                    <p className="text-[10px] font-bold text-cric-muted uppercase tracking-widest">{player1.playingRole || player1.role || "Player"}</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Player 2 */}
          <div className="bg-cric-card rounded-xl border border-cric-border p-6">
            <h3 className="text-xs font-black text-cric-muted uppercase tracking-widest mb-4">Player 2</h3>
            <input
              type="text"
              placeholder="Search player..."
              value={search2}
              onChange={(e) => { setSearch2(e.target.value); handleSearch(e.target.value, setResults2); }}
              className="w-full bg-cric-bg border border-cric-border rounded-lg px-4 py-2.5 text-sm font-bold text-cric-text placeholder-cric-muted/50 focus:outline-none focus:border-cric-accent mb-2"
            />
            {results2.length > 0 && (
              <div className="bg-cric-card border border-cric-border rounded-lg overflow-hidden shadow-lg">
                {results2.map((p) => (
                  <button
                    key={p._id}
                    onClick={() => selectPlayer(p, setPlayer2, setSearch2, setResults2)}
                    className="w-full text-left px-4 py-2.5 hover:bg-cric-bg text-sm font-bold text-cric-text border-b border-cric-border/50 last:border-b-0 transition-colors"
                  >
                    {p.name}
                    {p.team?.name && <span className="text-cric-muted font-normal ml-2">({p.team.name})</span>}
                  </button>
                ))}
              </div>
            )}
            {player2 && (
              <div className="mt-4 bg-cric-bg rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-cric-accent rounded-full flex items-center justify-center text-white font-black text-sm">
                    {player2.name?.charAt(0)}
                  </div>
                  <div>
                    <p className="font-black text-cric-text">{player2.name}</p>
                    <p className="text-[10px] font-bold text-cric-muted uppercase tracking-widest">{player2.playingRole || player2.role || "Player"}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Comparison Table */}
        {player1 && player2 && (
          <div className="space-y-8">
            {statCategories.map((category) => {
              const p1Stats = getStats(player1);
              const p2Stats = getStats(player2);
              const hasAny = category.stats.some((s) => {
                const v1 = s.compute ? s.compute(p1Stats) : (p1Stats[s.key] ?? p1Stats[s.fallback] ?? 0);
                const v2 = s.compute ? s.compute(p2Stats) : (p2Stats[s.key] ?? p2Stats[s.fallback] ?? 0);
                return (v1 !== 0 && v1 !== "0.00" && v1 !== "0") || (v2 !== 0 && v2 !== "0.00" && v2 !== "0");
              });
              if (!hasAny) return null;

              return (
                <div key={category.key} className="bg-cric-card rounded-xl border border-cric-border overflow-hidden">
                  <div className="bg-cric-accent px-6 py-4">
                    <h3 className="text-lg font-black text-white uppercase tracking-tight">{category.label}</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-[10px] font-black uppercase tracking-widest text-cric-muted bg-cric-bg">
                          <th className="py-3 px-4 text-left">Stat</th>
                          <th className="py-3 px-3 text-center">{player1.name}</th>
                          <th className="py-3 px-3 text-center">{player2.name}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-cric-border/50">
                        {category.stats.map((stat) => statRow(stat, p1Stats, p2Stats))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* No Selection State */}
        {(!player1 || !player2) && (
          <div className="text-center py-16">
            <svg className="w-16 h-16 mx-auto text-cric-muted/30 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            <p className="text-cric-muted font-black uppercase tracking-widest text-sm mb-2">
              {!player1 && !player2 ? "Search and select two players above" : "Select the second player to compare"}
            </p>
            <p className="text-cric-muted/60 text-xs font-bold">Compare batting, bowling, and fielding stats side by side</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default PlayerComparison;
