import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../services/api";
import MatchSummaryCard from "../components/MatchSummaryCard";
import { teamOfInnings } from "../utils/matchHelpers";

export default function Summary() {
  const { matchId } = useParams();
  const [match, setMatch] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadMatch = async () => {
      try {
        const res = await api.get(`/matches/${matchId}`);
        setMatch(res.data);
      } catch (err) {
        console.error("Failed to load match:", err);
      } finally {
        setLoading(false);
      }
    };
    loadMatch();
  }, [matchId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0e14] flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-[#ff6b35] border-t-transparent"></div>
      </div>
    );
  }

  if (!match) {
    return (
      <div className="min-h-screen bg-[#0a0e14] flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-black text-white mb-2 uppercase tracking-widest">Match Signal Lost</h2>
          <Link to="/" className="text-[#ff6b35] hover:underline font-bold">Return to Base</Link>
        </div>
      </div>
    );
  }

  const isMatchCompleted = match.status === 'completed';
  const team1 = match.teams?.[0];
  const team2 = match.teams?.[1];

  const calculateMVP = () => {
    if (!isMatchCompleted) return null;
    const allPlayers = [];
    match.innings?.forEach((innings) => {
      const battingTeamId = innings.team?._id || innings.team;
      innings.batting?.forEach(bat => {
        const playerId = bat.player?._id || bat.player;
        let points = (bat.runs || 0) + (bat.fours || 0) * 2 + (bat.sixes || 0) * 3;
        const existing = allPlayers.find(p => p.playerId === playerId);
        if (existing) existing.points += points;
        else allPlayers.push({ playerId, playerName: bat.player?.name, points, role: 'batter' });
      });
      innings.bowling?.forEach(bowl => {
        const playerId = bowl.player?._id || bowl.player;
        let points = (bowl.wickets || 0) * 25;
        const existing = allPlayers.find(p => p.playerId === playerId);
        if (existing) existing.points += points;
        else allPlayers.push({ playerId, playerName: bowl.player?.name, points, role: 'bowler' });
      });
    });
    return allPlayers.sort((a, b) => b.points - a.points).slice(0, 5);
  };

  const mvpList = calculateMVP();

  return (
    <div className="min-h-screen bg-[#0a0e14] text-slate-300 pb-20">
      {/* Header */}
      <div className="bg-[#141b24] border-b border-white/5 py-12">
        <div className="max-w-7xl mx-auto px-10">
            <div className="text-[10px] font-black text-[#ff6b35] uppercase tracking-[0.5em] mb-4">Post Match Analysis</div>
            <h1 className="text-5xl md:text-7xl font-black font-raj uppercase italic tracking-tighter text-white leading-none">
                Match <span className="text-[#ff6b35]">Summary</span>
            </h1>
            <p className="text-cric-muted font-bold mt-4 uppercase tracking-widest">{match.venue} • {new Date(match.startAt).toLocaleDateString()}</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-10 py-12 space-y-12">
        {/* Result Card */}
        {match.result && (
          <div className="bg-gradient-to-br from-[#ff6b35] to-[#ffb400] rounded-[3rem] p-12 shadow-2xl relative overflow-hidden group">
            <div className="absolute -right-20 -top-20 w-80 h-80 bg-white/10 rounded-full blur-3xl group-hover:bg-white/20 transition-all duration-700" />
            <h2 className="text-[10px] font-black uppercase tracking-[0.4em] mb-6 text-white/80">Official Result</h2>
            <p className="text-4xl md:text-6xl font-black font-raj text-white uppercase italic leading-none mb-8">{match.result.description}</p>
            
            {match.manOfMatch && (
              <div className="pt-8 border-t border-white/20 flex flex-col md:flex-row items-center gap-8">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.4em] text-white/60 mb-4">Player of the Match</p>
                  <div className="flex items-center gap-6">
                    <div className="w-20 h-20 bg-white/20 rounded-[2rem] flex items-center justify-center text-3xl font-black text-white shadow-xl">
                      {match.manOfMatch.name?.charAt(0)}
                    </div>
                    <div>
                      <p className="text-3xl font-black font-raj text-white uppercase italic tracking-tight">{match.manOfMatch.name}</p>
                      <p className="text-sm font-bold text-white/60 uppercase tracking-widest">{match.manOfMatch.playingRole || 'Match Winner'}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Innings Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {match.innings?.map((inn, idx) => (
            <div key={idx} className="bg-[#141b24] rounded-[2.5rem] border border-white/5 overflow-hidden shadow-xl">
              <div className="p-8 border-b border-white/5 flex justify-between items-center">
                <h3 className="text-xl font-black font-raj text-white uppercase italic tracking-tight">
                    {teamOfInnings(match, inn, idx)?.name}
                </h3>
                <div className="text-sm font-bold text-cric-muted uppercase tracking-widest">{inn.status}</div>
              </div>
              <div className="p-10 space-y-10">
                <div className="flex justify-between items-end">
                    <div>
                        <div className="text-7xl font-black font-raj text-white leading-none">{inn.runs}/{inn.wickets}</div>
                        <div className="text-sm font-bold text-cric-muted mt-2 uppercase tracking-widest">{inn.overs}.{inn.balls % 6} Overs</div>
                    </div>
                    <div className="text-right">
                        <div className="text-[10px] font-black text-cric-muted uppercase tracking-widest mb-1">Innings RR</div>
                        <div className="text-3xl font-black font-raj text-[#ffb400] italic">{(inn.runs / (inn.balls/6 || 1)).toFixed(2)}</div>
                    </div>
                </div>

                {/* Top Batter */}
                <div className="space-y-4">
                    <div className="text-[10px] font-black text-cric-muted uppercase tracking-[0.3em]">Top Performer</div>
                    {inn.batting?.sort((a,b)=>b.runs-a.runs).slice(0, 1).map((b, i) => (
                        <div key={i} className="flex justify-between items-center bg-white/2 p-6 rounded-3xl border border-white/5">
                            <div className="font-black font-raj text-2xl text-white uppercase italic">{b.player?.name}</div>
                            <div className="text-3xl font-black font-raj text-[#ff6b35]">{b.runs}<span className="text-sm text-cric-muted ml-1">({b.balls})</span></div>
                        </div>
                    ))}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* MVP Section */}
        {mvpList && (
           <div className="bg-[#141b24] rounded-[3rem] border border-white/5 p-12 shadow-2xl">
              <h3 className="text-[10px] font-black text-purple-500 uppercase tracking-[0.5em] mb-12">Performance Impact Rankings</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
                {mvpList.map((p, idx) => (
                    <div key={idx} className="bg-white/2 p-8 rounded-[2rem] border border-white/5 text-center space-y-4 hover:border-purple-500/50 transition-all group">
                        <div className="w-12 h-12 bg-purple-500/10 rounded-2xl flex items-center justify-center mx-auto text-purple-500 font-black group-hover:bg-purple-500 group-hover:text-white transition-all">#{idx+1}</div>
                        <div className="font-black font-raj text-xl text-white uppercase italic truncate">{p.playerName}</div>
                        <div className="text-2xl font-black font-raj text-purple-400">{p.points.toFixed(0)}</div>
                        <div className="text-[9px] font-bold text-cric-muted uppercase tracking-widest">Impact Pts</div>
                    </div>
                ))}
              </div>
           </div>
        )}

        {/* Match Summary Card */}
        <div className="bg-[#141b24] rounded-[3rem] border border-white/5 p-8 md:p-12 shadow-2xl">
          <h3 className="text-[10px] font-black text-[#ff6b35] uppercase tracking-[0.5em] mb-8">Share Match</h3>
          <MatchSummaryCard match={match} />
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row justify-center gap-6 pt-6">
          <Link to={`/match/${matchId}`} className="px-10 py-5 bg-[#ff6b35] text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-[#ff8c61] transition-all shadow-xl shadow-[#ff6b35]/20 text-center">
            View Live Dashboard
          </Link>
          <Link to="/" className="px-10 py-5 bg-white/5 text-cric-muted rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-white/10 transition-all border border-white/5 text-center">
            Return to Tournament
          </Link>
        </div>
      </div>
    </div>
  );
}
