import React, { useEffect, useState } from "react";
import { api } from "../services/api";
import { Link } from "react-router-dom";
import { formatOverFigure } from "../utils/matchHelpers";

export default function Scoreboard({ matchId }) {
  const [match, setMatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeInnings, setActiveInnings] = useState(0);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get(`/matches/${matchId}`);
        setMatch(res.data);
      } catch (err) {
        console.error("Failed to load match:", err.response?.status || err.code, err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [matchId]);

  if (loading) return <div className="p-8 text-center text-cric-muted">Loading scorecard...</div>;
  if (!match) return <div className="p-8 text-center text-cric-muted">Match not found</div>;

  const innings = match.innings || [];
  if (innings.length === 0) {
    return <div className="p-8 text-center text-cric-muted">No innings data yet</div>;
  }

  // Group batting stats by player
  const groupBattingStats = (battingArray) => {
    if (!Array.isArray(battingArray)) return [];
    const grouped = {};
    battingArray.forEach(b => {
      const pId = (b.player?._id || b.player)?.toString();
      if (!pId) return;
      if (!grouped[pId]) {
        grouped[pId] = {
          player: b.player,
          runs: 0,
          balls: 0,
          fours: 0,
          sixes: 0,
          dotBalls: 0,
          isOut: false,
          dismissalType: ""
        };
      }
      grouped[pId].runs += (b.runs || 0);
      grouped[pId].balls += (b.balls || 0);
      grouped[pId].fours += (b.fours || 0);
      grouped[pId].sixes += (b.sixes || 0);
      grouped[pId].dotBalls += (b.dotBalls || 0);
      grouped[pId].isOut = grouped[pId].isOut || b.isOut;
      grouped[pId].dismissalType = grouped[pId].dismissalType || b.dismissalType;
    });
    return Object.values(grouped).map(b => ({
      ...b,
      strikeRate: b.balls > 0 ? ((b.runs / b.balls) * 100).toFixed(2) : '0.00'
    }));
  };

  // Group bowling stats
  const groupBowlingStats = (bowlingArray) => {
    if (!Array.isArray(bowlingArray)) return [];
    const grouped = {};
    bowlingArray.forEach(b => {
      const pId = (b.player?._id || b.player)?.toString();
      if (!pId) return;
      if (!grouped[pId]) {
        grouped[pId] = {
          player: b.player,
          balls: 0,
          maidens: 0,
          runs: 0,
          wickets: 0,
          wides: 0,
          noBalls: 0,
          dotBalls: 0
        };
      }
      grouped[pId].balls += (b.balls || 0);
      grouped[pId].maidens += (b.maidens || 0);
      grouped[pId].runs += (b.runs || 0);
      grouped[pId].wickets += (b.wickets || 0);
      grouped[pId].wides += (b.wides || 0);
      grouped[pId].noBalls += (b.noBalls || 0);
      grouped[pId].dotBalls += (b.dotBalls || 0);
    });
    return Object.values(grouped).map(b => {
      const overs = Math.floor(b.balls / 6);
      const balls = b.balls % 6;
      const econ = (overs + balls / 6) > 0 ? (b.runs / (overs + balls / 6)).toFixed(2) : '0.00';
      return { ...b, overs, balls, oversStr: `${overs}.${balls}`, economy: econ };
    });
  };

  const currentInnings = innings[activeInnings] || {};
  const battingStats = groupBattingStats(currentInnings.batting);
  const bowlingStats = groupBowlingStats(currentInnings.bowling);

  // Get batting team's playing XI
  const battingTeamId = currentInnings.team?._id || currentInnings.team;
  const playingXI = match.playingXI?.find(xi => (xi.team?._id || xi.team) === battingTeamId)?.players || [];

  // Find players who haven't batted yet
  const yetToBat = playingXI.filter(p => !battingStats.find(b => (b.player?._id || b.player) === p._id));
  const isMatchCompleted = match.status === 'completed' || currentInnings.status === 'completed';

  return (
    <div className="space-y-6">
      {/* Match Summary Header */}
      <div className="bg-cric-accent text-white p-6 rounded-2xl">
        <h2 className="text-xs font-black uppercase tracking-widest text-blue-300 mb-4">Match Summary</h2>

        {/* Innings Summary */}
        <div className="space-y-3">
          {innings.map((inn, idx) => (
            <button
              key={idx}
              onClick={() => setActiveInnings(idx)}
              className={`w-full text-left p-4 rounded-xl transition-all ${activeInnings === idx ? 'bg-white/20' : 'bg-white/10 hover:bg-white/15'
                }`}
            >
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-sm font-bold text-blue-200">{match.teams[idx]?.name || `Innings ${idx + 1}`}</p>
                  <p className="text-3xl font-black mt-1">{inn.runs}/{inn.wickets}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-blue-200">{inn.overs}.{inn.balls % 6} ov</p>
                  {inn.runRate > 0 && <p className="text-xs text-blue-300 mt-1">RR: {inn.runRate}</p>}
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Toss Info */}
        {match.tossWinner && (
          <div className="mt-4 pt-4 border-t border-white/10">
            <p className="text-sm font-bold text-blue-200">
              Toss: {match.tossWinner.name} elected to {match.tossDecision === 'bat' ? 'bat' : 'bowl'} first
            </p>
          </div>
        )}
      </div>

      {/* Batting Scorecard */}
      <div className="bg-cric-card rounded-2xl shadow-sm border border-cric-border overflow-hidden">
        <div className="bg-cric-accent px-6 py-4">
          <h3 className="text-lg font-black text-white uppercase tracking-tight">
            {match.teams.find(t => (t._id || t) === battingTeamId)?.name || `Innings ${activeInnings + 1}`} - Batting
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-cric-bg text-[10px] font-black uppercase tracking-widest text-cric-muted">
                <th className="py-3 px-4 text-left">Batter</th>
                <th className="py-3 px-2 text-center">R</th>
                <th className="py-3 px-2 text-center">B</th>
                <th className="py-3 px-2 text-center">4s</th>
                <th className="py-3 px-2 text-center">6s</th>
                <th className="py-3 px-2 text-center">0s</th>
                <th className="py-3 px-4 text-right">SR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cric-border">
              {battingStats.length > 0 ? (
                battingStats.map((b, i) => (
                  <tr key={i} className="hover:bg-cric-bg">
                    <td className="py-3 px-4">
                      <Link to={`/players/${b.player?._id}`} className="font-bold text-cric-accent hover:text-cric-accent hover:underline">
                        {b.player?.name || 'Unknown'}
                      </Link>
                      {b.isOut ? (
                        <span className="block text-[9px] text-cric-muted uppercase mt-0.5">{b.dismissalType || 'out'}</span>
                      ) : (
                        <span className="block text-[9px] text-green-600 uppercase mt-0.5 font-bold">not out</span>
                      )}
                    </td>
                    <td className="py-3 px-2 text-center font-black text-cric-accent">{b.runs}</td>
                    <td className="py-3 px-2 text-center text-cric-muted">{b.balls}</td>
                    <td className="py-3 px-2 text-center text-cric-muted">{b.fours}</td>
                    <td className="py-3 px-2 text-center text-cric-muted">{b.sixes}</td>
                    <td className="py-3 px-2 text-center text-cric-muted">{b.dotBalls || 0}</td>
                    <td className="py-3 px-4 text-right text-cric-muted text-xs">{b.strikeRate}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={7} className="py-8 text-center text-cric-muted">Batting yet to start</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Extras */}
        {currentInnings.extras && (
          <div className="px-6 py-3 bg-cric-bg border-t border-cric-border text-sm">
            <span className="font-bold text-cric-muted">Extras: {currentInnings.extras.total || 0}</span>
            <span className="text-cric-muted ml-2">
              (b {currentInnings.extras.byes || 0}, lb {currentInnings.extras.legByes || 0},
              wd {currentInnings.extras.wides || 0}, nb {currentInnings.extras.noBalls || 0})
            </span>
          </div>
        )}

        {/* Yet to Bat / Did not bat */}
        {yetToBat.length > 0 && (
          <div className="px-6 py-4 border-t border-cric-border">
            <p className="text-[10px] font-black uppercase text-cric-muted tracking-widest mb-2">
              {isMatchCompleted ? 'Did not bat' : 'Yet to bat'}
            </p>
            <div className="flex flex-wrap gap-2">
              {yetToBat.map(p => (
                <Link
                  key={p._id}
                  to={`/players/${p._id}`}
                  className="px-3 py-1.5 bg-cric-bg rounded-full text-xs font-bold text-cric-muted hover:bg-cric-card hover:text-cric-accent transition-colors"
                >
                  {p.name}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Fall of Wickets */}
        {currentInnings.fallOfWickets?.length > 0 && (
          <div className="px-6 py-4 border-t border-cric-border bg-red-50">
            <p className="text-[10px] font-black uppercase text-red-400 tracking-widest mb-2">Fall of Wickets</p>
            <div className="flex flex-wrap gap-2">
              {currentInnings.fallOfWickets.map((fow, idx) => (
                <span key={idx} className="px-3 py-1.5 bg-white rounded-full text-xs font-bold text-red-600 border border-red-200">
                  {fow.player?.name}: {fow.runs}-{fow.wickets}
                  {formatOverFigure(fow.overs) ? ` (${formatOverFigure(fow.overs)} ov)` : ""}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bowling Scorecard */}
      <div className="bg-cric-card rounded-2xl shadow-sm border border-cric-border overflow-hidden">
        <div className="bg-cric-accent px-6 py-4">
          <h3 className="text-lg font-black text-white uppercase tracking-tight">Bowling</h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-cric-bg text-[10px] font-black uppercase tracking-widest text-cric-muted">
                <th className="py-3 px-4 text-left">Bowler</th>
                <th className="py-3 px-2 text-center">O</th>
                <th className="py-3 px-2 text-center">M</th>
                <th className="py-3 px-2 text-center">R</th>
                <th className="py-3 px-2 text-center">W</th>
                <th className="py-3 px-2 text-center">0s</th>
                <th className="py-3 px-2 text-center">WD</th>
                <th className="py-3 px-2 text-center">NB</th>
                <th className="py-3 px-4 text-right">ECON</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cric-border">
              {bowlingStats.length > 0 ? (
                bowlingStats.map((b, i) => (
                  <tr key={i} className="hover:bg-cric-bg">
                    <td className="py-3 px-4">
                      <Link to={`/players/${b.player?._id}`} className="font-bold text-cric-accent hover:text-cric-accent hover:underline">
                        {b.player?.name || 'Unknown'}
                      </Link>
                    </td>
                    <td className="py-3 px-2 text-center text-cric-muted">{b.oversStr}</td>
                    <td className="py-3 px-2 text-center text-cric-muted">{b.maidens}</td>
                    <td className="py-3 px-2 text-center text-cric-muted">{b.runs}</td>
                    <td className="py-3 px-2 text-center font-black text-red-600">{b.wickets}</td>
                    <td className="py-3 px-2 text-center text-cric-muted">{b.dotBalls || 0}</td>
                    <td className="py-3 px-2 text-center text-cric-muted">{b.wides}</td>
                    <td className="py-3 px-2 text-center text-cric-muted">{b.noBalls}</td>
                    <td className="py-3 px-4 text-right text-cric-muted text-xs">{b.economy}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={9} className="py-8 text-center text-cric-muted">Bowling yet to start</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Bowling XI - Who can bowl */}
        {match.bowlingXI?.find(xi => (xi.team?._id || xi.team) !== battingTeamId)?.players?.length > 0 && (
          <div className="px-6 py-4 border-t border-cric-border bg-cric-bg">
            <p className="text-[10px] font-black uppercase text-cric-accent tracking-widest mb-2">Bowling Options</p>
            <div className="flex flex-wrap gap-2">
              {match.bowlingXI.find(xi => (xi.team?._id || xi.team) !== battingTeamId).players.map(p => (
                <Link
                  key={p._id}
                  to={`/players/${p._id}`}
                  className="px-3 py-1.5 bg-cric-card rounded-full text-xs font-bold text-cric-accent border border-cric-border hover:bg-cric-bg transition-colors"
                >
                  {p.name}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Match Status */}
      {isMatchCompleted && match.result && (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-6">
          <h3 className="text-lg font-black text-green-800 uppercase tracking-tight mb-3">Match Result</h3>
          <p className="text-green-700 font-bold">{match.result.description}</p>
          {match.manOfMatch && (
            <div className="mt-4 pt-4 border-t border-green-200">
              <p className="text-[10px] font-black uppercase text-green-400 tracking-widest mb-2">Player of the Match</p>
              <Link to={`/players/${match.manOfMatch._id}`} className="inline-block px-4 py-2 bg-white rounded-full text-green-700 font-bold hover:bg-green-100 transition-colors">
                {match.manOfMatch.name}
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
