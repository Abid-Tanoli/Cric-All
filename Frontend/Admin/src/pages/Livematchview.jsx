import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';
import { useSelector } from 'react-redux';
import WagonWheel from '../components/ScoreManagement/WagonWheel';
import PartnershipBuilder from '../components/ScoreManagement/PartnershipBuilder';

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
const TABS = ['Live', 'Scorecard', 'Commentary', 'Stats', 'Overs', 'Playing XI', 'Wagon Wheel', 'Partnerships', 'Photos', 'Videos', 'Blogs'];

export default function LiveMatchView() {
  const { id } = useParams();
  const { token } = useSelector((state) => state.auth);
  
  const [activeTab, setActiveTab] = useState('Live');
  const [matchData, setMatchData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchMatch = async () => {
    try {
      const res = await axios.get(`${API_URL}/matches/${id}`);
      setMatchData(res.data);
    } catch (err) {
      setError('Failed to load match data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMatch();
    const interval = setInterval(fetchMatch, 5000); // Poll every 5s for live updates
    return () => clearInterval(interval);
  }, [id]);

  if (loading && !matchData) {
    return <div className="min-h-screen bg-[#0f172a] flex items-center justify-center text-white"><div className="animate-spin rounded-full h-16 w-16 border-t-4 border-[#22c55e]"></div></div>;
  }
  if (error || !matchData) return <div className="min-h-screen bg-[#0f172a] flex items-center justify-center text-red-500">{error || 'Match not found'}</div>;

  const currentInningsIndex = matchData.currentInnings || 0;
  const currentInnings = matchData.innings[currentInningsIndex] || {};
  const isMatchOver = matchData.status === 'completed';

  // Team Details
  const team1 = matchData.teams[0];
  const team2 = matchData.teams[1];
  const inn1 = matchData.innings[0] || {};
  const inn2 = matchData.innings[1];
  
  const currentBattingTeamId = currentInnings.team?._id || currentInnings.team;
  const isTeam1Batting = currentBattingTeamId === team1._id;
  const battingTeam = isTeam1Batting ? team1 : team2;
  const bowlingTeam = isTeam1Batting ? team2 : team1;

  // Active Batsmen & Bowler
  const activeBatsmen = (currentInnings.batting || []).filter(b => !b.isOut && b.player).slice(0, 2);
  const strikerId = currentInnings.onStrikeBatsman?._id || currentInnings.onStrikeBatsman;
  
  const oversHistory = currentInnings.oversHistory || [];
  const currentOverData = oversHistory.length > 0 ? oversHistory[oversHistory.length - 1] : null;
  const activeBowlerId = currentInnings.currentBowler?._id || currentInnings.currentBowler;
  const activeBowlerData = (currentInnings.bowling || []).find(b => (b.player?._id || b.player) === activeBowlerId);

  // Fall of wickets formatting
  const getFOW = (innings) => {
    const sortedBatters = [...(innings.batting || [])].sort((a,b) => a.position - b.position);
    let fallWickets = [];
    let r = 0;
    sortedBatters.forEach(b => {
        if(b.isOut) {
            r++;
            fallWickets.push(`${r}-${b.runs} (${b.player?.name || 'Player'}, ${b.balls}b)`);
        }
    });
    return fallWickets.join(', ');
  };

  const getExtras = (innings) => {
      const e = innings.extras || { wides:0, noBalls:0, byes:0, legByes:0 };
      return `(w: ${e.wides}, nb: ${e.noBalls}, b: ${e.byes}, lb: ${e.legByes})`;
  };

  const calculateCRR = (innings) => {
      return innings.runRate ? innings.runRate.toFixed(2) : ((innings.runs || 0) / (Math.max(1, innings.balls || 1) / 6)).toFixed(2);
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Rajdhani:wght@500;600;700&display=swap');
        .font-rajdhani { font-family: 'Rajdhani', sans-serif; }
        .font-inter { font-family: 'Inter', sans-serif; }
        .custom-scrollbar::-webkit-scrollbar { height: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #0f172a; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
        @keyframes pulse-dot { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.5); opacity: 0.5; } }
        .animate-pulse-dot { animation: pulse-dot 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
      `}</style>

      <div className="min-h-screen bg-[#0f172a] text-[#f1f5f9] font-inter">
        
        {/* TOP NAVBAR */}
        <div className="sticky top-0 z-50 bg-[#0f172a] border-b border-[#334155] shadow-md">
          <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
            <div className="flex items-center gap-6">
              <Link to="/admin/live" className="text-2xl font-bold font-rajdhani text-white flex items-center gap-2 hover:opacity-80">
                <span className="text-[#22c55e]">🏏</span> AdminLive
              </Link>
              <div className="hidden md:block text-sm text-[#94a3b8] font-medium border-l border-[#334155] pl-6">
                {team1?.name} vs {team2?.name} · {matchData.series || matchData.matchType} · <span className={!isMatchOver ? "text-[#ef4444] font-bold uppercase" : "text-[#94a3b8]"}>{matchData.status}</span>
              </div>
            </div>
            <div className="flex items-center gap-4 text-[#94a3b8]">
                <Link to="/admin/score" className="text-sm font-bold bg-[#3b82f6] text-white px-4 py-1.5 rounded-lg hover:bg-[#2563eb] transition shadow">Manage Score</Link>
            </div>
          </div>

          <div className="max-w-7xl mx-auto px-4">
            <div className="flex overflow-x-auto custom-scrollbar">
              {TABS.map(tab => (
                <button 
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-3 whitespace-nowrap text-sm font-bold transition flex flex-col relative ${activeTab === tab ? 'text-[#22c55e]' : 'text-[#94a3b8] hover:text-white'}`}
                >
                  {tab}
                  {activeTab === tab && <div className="absolute bottom-0 left-0 w-full h-[3px] bg-[#22c55e] rounded-t-md"></div>}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* MATCH HEADER */}
        <div className="bg-[#1e293b] border-b border-[#334155]">
          <div className="max-w-7xl mx-auto px-4 py-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
              
              <div className="flex-1 w-full text-center md:text-left">
                {!isMatchOver ? (
                  <div className="inline-flex items-center gap-2 bg-[#0f172a] rounded-full px-3 py-1 mb-4 border border-[#ef4444]/30">
                    <div className="w-2 h-2 rounded-full bg-[#ef4444] animate-pulse-dot"></div>
                    <span className="text-[#ef4444] text-xs font-bold uppercase tracking-widest">LIVE</span>
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-2 bg-[#0f172a] rounded-full px-3 py-1 mb-4 border border-[#94a3b8]/30">
                    <span className="text-[#94a3b8] text-xs font-bold uppercase tracking-widest">COMPLETED</span>
                  </div>
                )}
                
                <div className="flex items-center justify-between md:justify-start md:gap-10 mb-2">
                  <div className="flex items-center gap-3">
                    {team1?.logo ? <img src={team1.logo} alt="" className="w-8 h-8 rounded-full" /> : <div className="w-8 h-8 bg-gray-700 rounded-full flex items-center justify-center font-bold">{team1?.name?.charAt(0)}</div>}
                    <div>
                      <h2 className="text-xl font-bold font-rajdhani text-white">{team1?.name}</h2>
                      <div className="text-[#94a3b8] text-sm text-left">{inn1?.overs || 0}.{inn1?.balls%6||0} Ov</div>
                    </div>
                  </div>
                  <div className={`text-3xl font-bold font-rajdhani ${isTeam1Batting ? 'text-[#22c55e]' : 'text-white'}`}>{inn1?.runs || 0}/{inn1?.wickets || 0}</div>
                </div>
                
                <div className="flex items-center justify-between md:justify-start md:gap-3 mb-2 opacity-60">
                   <div className="text-[#94a3b8] font-bold text-sm">VS</div>
                </div>

                <div className="flex items-center justify-between md:justify-start md:gap-10">
                  <div className="flex items-center gap-3">
                    {team2?.logo ? <img src={team2.logo} alt="" className="w-8 h-8 rounded-full" /> : <div className="w-8 h-8 bg-gray-700 rounded-full flex items-center justify-center font-bold">{team2?.name?.charAt(0)}</div>}
                    <div>
                      <h2 className="text-xl font-bold font-rajdhani text-white">{team2?.name}</h2>
                      <div className="text-[#94a3b8] text-sm text-left">{inn2 ? `${inn2.overs}.${inn2.balls%6} Ov` : 'Yet to bat'}</div>
                    </div>
                  </div>
                  <div className={`text-3xl font-bold font-rajdhani ${!isTeam1Batting ? 'text-[#22c55e]' : 'text-white'}`}>{inn2?.runs || 0}/{inn2?.wickets || 0}</div>
                </div>
              </div>

              <div className="w-full md:w-[400px] flex flex-col gap-4">
                <div className="text-[#22c55e] text-center md:text-right text-sm font-bold bg-[#22c55e]/10 py-2 px-4 rounded border border-[#22c55e]/20">
                  {matchData.result?.description || (currentInnings.target ? `${battingTeam?.name} needs ${currentInnings.target - currentInnings.runs} runs` : `${battingTeam?.name} elected to bat first`)}
                </div>
                
                <div className="bg-[#0f172a] p-4 rounded-xl border border-[#334155]">
                  <div className="flex justify-between text-xs font-bold mb-2 uppercase">
                    <span className="text-[#3b82f6]">{team1?.shortName || team1?.name} 50%</span>
                    <span className="text-white">Win Prob</span>
                    <span className="text-[#ef4444]">{team2?.shortName || team2?.name} 50%</span>
                  </div>
                  <div className="w-full h-2 rounded-full overflow-hidden flex">
                    <div className="bg-[#3b82f6] h-full" style={{ width: '50%' }}></div>
                    <div className="bg-[#ef4444] h-full" style={{ width: '50%' }}></div>
                  </div>
                </div>
                
                <div className="text-right text-xs text-[#94a3b8]">
                  {matchData.venue} • {new Date(matchData.startAt).toLocaleDateString()}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* MAIN CONTENT AREA */}
        <div className="max-w-7xl mx-auto px-4 py-8">
          
          {activeTab === 'Live' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                
                <div className="bg-[#1e293b] rounded-xl border border-[#334155] p-6 shadow-lg">
                  <h3 className="text-[#94a3b8] text-xs font-bold uppercase tracking-widest mb-4">Batting - {battingTeam?.name}</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="text-[#94a3b8] text-xs border-b border-[#334155]">
                        <tr>
                          <th className="pb-2 font-normal">Batsman</th>
                          <th className="pb-2 font-normal text-right">R</th>
                          <th className="pb-2 font-normal text-right">B</th>
                          <th className="pb-2 font-normal text-right">4s</th>
                          <th className="pb-2 font-normal text-right">6s</th>
                          <th className="pb-2 font-normal text-right">SR</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#334155]/50">
                        {activeBatsmen.length === 0 && <tr><td colSpan="6" className="py-4 text-center text-sm text-[#94a3b8]">No batsmen selected yet</td></tr>}
                        {activeBatsmen.map(b => (
                          <tr key={b.player._id}>
                            <td className={`py-3 font-bold text-white ${strikerId === b.player._id ? 'border-l-2 border-[#22c55e] pl-3' : 'pl-4'}`}>
                              {b.player.name} {strikerId === b.player._id ? '*' : ''}
                            </td>
                            <td className="py-3 text-right font-bold text-white">{b.runs}</td>
                            <td className="py-3 text-right text-[#94a3b8]">{b.balls}</td>
                            <td className="py-3 text-right text-[#94a3b8]">{b.fours}</td>
                            <td className="py-3 text-right text-[#94a3b8]">{b.sixes}</td>
                            <td className="py-3 text-right text-[#94a3b8]">{b.strikeRate.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-8 overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="text-[#94a3b8] text-xs border-b border-[#334155]">
                        <tr>
                          <th className="pb-2 font-normal">Bowler</th>
                          <th className="pb-2 font-normal text-right">O</th>
                          <th className="pb-2 font-normal text-right">M</th>
                          <th className="pb-2 font-normal text-right">R</th>
                          <th className="pb-2 font-normal text-right pr-2">W</th>
                          <th className="pb-2 font-normal text-right">ECON</th>
                        </tr>
                      </thead>
                      <tbody>
                        {!activeBowlerData ? <tr><td colSpan="6" className="py-4 text-center text-sm text-[#94a3b8]">No bowler selected</td></tr> : (
                          <tr>
                            <td className="py-3 font-bold text-white pl-4">{activeBowlerData.player?.name}</td>
                            <td className="py-3 text-right text-[#94a3b8]">{activeBowlerData.overs}.{activeBowlerData.balls % 6}</td>
                            <td className="py-3 text-right text-[#94a3b8]">{activeBowlerData.maidens}</td>
                            <td className="py-3 text-right text-[#94a3b8]">{activeBowlerData.runs}</td>
                            <td className="py-3 text-right font-bold text-[#ef4444] pr-2">{activeBowlerData.wickets}</td>
                            <td className="py-3 text-right text-[#94a3b8]">{activeBowlerData.economy.toFixed(2)}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-6 pt-6 border-t border-[#334155]">
                    <div className="flex items-center gap-4">
                      <span className="text-xs text-[#94a3b8] uppercase font-bold tracking-widest">Recent Balls</span>
                      <div className="flex gap-2 font-rajdhani font-bold flex-wrap">
                        {(!currentOverData || currentOverData.balls.length === 0) && <span className="text-sm text-[#94a3b8] font-inter font-normal">No balls bowled in this over</span>}
                        {(currentOverData?.balls || []).map((ball, idx) => (
                           <span key={idx} className={`w-7 h-7 flex items-center justify-center rounded-full text-white text-xs shadow-sm ${ball.isWicket ? 'bg-[#ef4444] shadow-[0_0_8px_rgba(239,68,68,0.4)]' : ball.runs === 6 ? 'bg-[#f59e0b]' : ball.runs === 4 ? 'bg-[#3b82f6]' : ball.isWide||ball.isNoBall ? 'bg-[#8b5cf6]' : 'bg-[#1e293b] border border-[#334155]'}`}>
                             {ball.isWicket ? 'W' : ball.isWide ? `${ball.runs}wd` : ball.isNoBall ? `${ball.runs}nb` : ball.runs}
                           </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-1 space-y-6">
                <div className="bg-[#1e293b] rounded-xl border border-[#334155] p-5 shadow-lg">
                  <h3 className="text-xs font-bold text-[#94a3b8] uppercase tracking-widest mb-4">Innings Stats</h3>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center bg-[#0f172a] p-3 rounded">
                      <span className="text-sm text-[#94a3b8]">Current RR</span>
                      <span className="font-rajdhani font-bold text-xl text-white">{calculateCRR(currentInnings)}</span>
                    </div>
                    {currentInnings.target && (
                      <div className="flex justify-between items-center bg-[#0f172a] p-3 rounded border border-[#22c55e]/30">
                        <span className="text-sm text-[#94a3b8]">Required RR</span>
                        <span className="font-rajdhani font-bold text-xl text-[#22c55e]">
                          {((currentInnings.target - currentInnings.runs) / (Math.max(1, (matchData.totalOvers * 6) - (currentInnings.balls||0)) / 6)).toFixed(2)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between items-center bg-[#0f172a] p-3 rounded">
                      <span className="text-sm text-[#94a3b8]">Extras</span>
                      <span className="font-rajdhani font-bold text-lg text-white">{(currentInnings.extras?.wides||0) + (currentInnings.extras?.noBalls||0) + (currentInnings.extras?.byes||0) + (currentInnings.extras?.legByes||0)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'Scorecard' && (
            <div className="space-y-8">
              {matchData.innings.map((inn, innIdx) => {
                if (!inn.team) return null;
                const isCurrent = innIdx === currentInningsIndex;
                const tm = matchData.teams.find(t => t._id === (inn.team._id || inn.team)) || inn.team;
                
                return (
                  <div key={innIdx} className={`bg-[#1e293b] rounded-xl border border-[#334155] shadow-lg overflow-hidden ${isCurrent && !isMatchOver ? 'ring-2 ring-[#22c55e]/50 relative' : ''}`}>
                    <div className="bg-[#0f172a] px-6 py-4 flex justify-between items-center border-b border-[#334155]">
                      <h3 className="font-bold text-lg text-white">{tm?.name} Innings {isCurrent && !isMatchOver && <span className="ml-2 px-2 py-0.5 rounded text-[10px] font-bold bg-[#ef4444] text-white tracking-widest uppercase">Live</span>}</h3>
                      <span className={`font-rajdhani font-bold text-xl ${isCurrent && !isMatchOver ? 'text-[#22c55e]' : 'text-white'}`}>{inn.runs}/{inn.wickets} <span className="text-sm text-[#94a3b8] font-inter font-normal">({inn.overs}.{inn.balls%6} Ov)</span></span>
                    </div>
                    
                    <div className="overflow-x-auto">
                      <table className="w-full text-left whitespace-nowrap">
                        <thead className="bg-[#1e293b] text-[#94a3b8] text-xs uppercase border-b border-[#334155]">
                          <tr>
                            <th className="px-6 py-3 font-semibold">Batsman</th>
                            <th className="px-6 py-3 font-semibold">Dismissal</th>
                            <th className="px-4 py-3 font-semibold text-right">R</th>
                            <th className="px-4 py-3 font-semibold text-right">B</th>
                            <th className="px-4 py-3 font-semibold text-right">4s</th>
                            <th className="px-4 py-3 font-semibold text-right">6s</th>
                            <th className="px-4 py-3 font-semibold text-right">SR</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#334155] text-sm">
                          {inn.batting.map(b => (
                            <tr key={b.player?._id} className="hover:bg-[#0f172a]/50 transition">
                              <td className="px-6 py-4 font-bold text-[#f1f5f9]">{b.player?.name}</td>
                              <td className={`px-6 py-4 ${b.isOut ? 'text-[#94a3b8]' : 'font-medium text-[#22c55e]'}`}>
                                {b.isOut ? (b.dismissalType ? `${b.dismissalType}` : 'out') : 'not out'}
                              </td>
                              <td className="px-4 py-4 text-right font-bold text-white">{b.runs}</td>
                              <td className="px-4 py-4 text-right text-[#94a3b8]">{b.balls}</td>
                              <td className="px-4 py-4 text-right text-[#94a3b8]">{b.fours}</td>
                              <td className="px-4 py-4 text-right text-[#94a3b8]">{b.sixes}</td>
                              <td className="px-4 py-4 text-right text-[#94a3b8]">{b.strikeRate.toFixed(2)}</td>
                            </tr>
                          ))}
                          <tr className="bg-[#0f172a]">
                            <td className="px-6 py-4 font-bold text-[#f1f5f9]">Extras</td>
                            <td className="px-6 py-4 text-[#94a3b8]">{getExtras(inn)}</td>
                            <td className="px-4 py-4 text-right font-bold text-white">
                              {(inn.extras?.wides||0) + (inn.extras?.noBalls||0) + (inn.extras?.byes||0) + (inn.extras?.legByes||0)}
                            </td>
                            <td colSpan="4"></td>
                          </tr>
                          <tr className="bg-[#1e293b] border-t-2 border-[#334155]">
                            <td className="px-6 py-4 font-bold text-white text-lg">TOTAL</td>
                            <td className="px-6 py-4 text-[#94a3b8]">{inn.overs}.{inn.balls%6} Ov (RR: {calculateCRR(inn)})</td>
                            <td className={`px-4 py-4 text-right font-bold ${isCurrent && !isMatchOver ? 'text-[#22c55e]' : 'text-white'} text-lg`}>{inn.runs}/{inn.wickets}</td>
                            <td colSpan="4"></td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    <div className="p-6 bg-[#0f172a] border-y border-[#334155]">
                      <h4 className="text-xs font-bold uppercase text-[#94a3b8] tracking-widest mb-2">Fall of wickets</h4>
                      <p className="text-sm leading-relaxed text-[#f1f5f9]">{getFOW(inn) || 'None yet'}</p>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left whitespace-nowrap">
                        <thead className="bg-[#1e293b] text-[#94a3b8] text-xs uppercase border-b border-[#334155]">
                          <tr>
                            <th className="px-6 py-3 font-semibold">Bowler</th>
                            <th className="px-4 py-3 font-semibold text-right">O</th>
                            <th className="px-4 py-3 font-semibold text-right">M</th>
                            <th className="px-4 py-3 font-semibold text-right">R</th>
                            <th className="px-4 py-3 font-semibold text-right text-[#ef4444]">W</th>
                            <th className="px-4 py-3 font-semibold text-right">ECON</th>
                            <th className="px-4 py-3 font-semibold text-right">WD</th>
                            <th className="px-4 py-3 font-semibold text-right">NB</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#334155] text-sm">
                          {inn.bowling.map(b => (
                            <tr key={b.player?._id} className="hover:bg-[#0f172a]/50 transition">
                              <td className="px-6 py-4 font-bold text-[#f1f5f9]">{b.player?.name}</td>
                              <td className="px-4 py-4 text-right">{b.overs}.{b.balls%6}</td>
                              <td className="px-4 py-4 text-right">{b.maidens}</td>
                              <td className="px-4 py-4 text-right">{b.runs}</td>
                              <td className="px-4 py-4 text-right font-bold text-[#ef4444]">{b.wickets}</td>
                              <td className="px-4 py-4 text-right text-[#94a3b8]">{b.economy.toFixed(2)}</td>
                              <td className="px-4 py-4 text-right text-[#94a3b8]">{b.wides}</td>
                              <td className="px-4 py-4 text-right text-[#94a3b8]">{b.noBalls}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {activeTab === 'Overs' && (
             <div className="bg-[#1e293b] rounded-xl border border-[#334155] shadow-lg overflow-hidden">
                <div className="bg-[#0f172a] px-6 py-4 flex justify-between items-center border-b border-[#334155]">
                  <h3 className="font-bold text-lg text-white">Over-by-over Analysis</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left whitespace-nowrap">
                        <thead className="bg-[#1e293b] text-[#94a3b8] text-xs uppercase border-b border-[#334155]">
                          <tr>
                              <th className="px-6 py-4 font-semibold w-16 text-center">Over</th>
                              <th className="px-4 py-4 font-semibold">Bowler</th>
                              <th className="px-6 py-4 font-semibold">Ball by ball</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#334155] text-sm font-rajdhani">
                          {[...oversHistory].reverse().map((o, idx) => {
                             const bowlerName = (currentInnings.bowling || []).find(b => (b.player?._id || b.player) === o.bowler)?.player?.name || 'Unknown';
                             return (
                               <tr key={idx} className="hover:bg-[#0f172a]/50 transition">
                                 <td className="px-6 py-5 text-center font-bold text-lg text-white">{o.overNumber}</td>
                                 <td className="px-4 py-5 text-[#f1f5f9] font-inter font-bold">{bowlerName}</td>
                                 <td className="px-6 py-5">
                                    <div className="flex gap-2">
                                        {(o.balls || []).map((ball, bIdx) => (
                                          <span key={bIdx} className={`w-8 h-8 flex items-center justify-center rounded-full text-white text-xs font-bold font-inter shadow-sm ${ball.isWicket ? 'bg-[#ef4444] shadow-[0_0_8px_rgba(239,68,68,0.4)]' : ball.runs === 6 ? 'bg-[#f59e0b]' : ball.runs === 4 ? 'bg-[#3b82f6]' : ball.isWide||ball.isNoBall ? 'bg-[#8b5cf6]' : 'bg-[#1e293b] border border-[#334155]'}`}>
                                            {ball.isWicket ? 'W' : ball.isWide ? `${ball.runs}wd` : ball.isNoBall ? `${ball.runs}nb` : ball.runs}
                                          </span>
                                        ))}
                                    </div>
                                 </td>
                               </tr>
                             )
                          })}
                        </tbody>
                    </table>
                </div>
             </div>
          )}

          {activeTab === 'Playing XI' && (() => {
            const getSquadForTeam = (teamId) => {
              const squad = (matchData.squad15 || []).find(s => (s.team?._id || s.team) === teamId);
              if (squad?.players?.length > 0) return { players: squad.players, meta: squad };
              const pxi = (matchData.playingXI || []).find(p => (p.team?._id || p.team) === teamId);
              return { players: pxi?.players || [], meta: null };
            };
            return (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {matchData.teams.map((team, idx) => {
                  const { players, meta } = getSquadForTeam(team._id);
                  const capId = meta?.captain?._id || meta?.captain;
                  const vcId = meta?.viceCaptain?._id || meta?.viceCaptain;
                  const wkIds = (meta?.wicketKeepers || []).map(w => w?._id || w);
                  return (
                    <div key={team._id} className="bg-[#1e293b] rounded-xl border border-[#334155] shadow-lg overflow-hidden">
                      <div className="bg-[#0f172a] px-6 py-4 flex items-center justify-between border-b border-[#334155]">
                        <h3 className="font-bold text-lg text-white">{team.name} Squad</h3>
                        <span className="text-xs text-[#94a3b8] font-bold">{players.length} players</span>
                      </div>
                      {players.length === 0 ? (
                        <div className="p-10 text-center text-sm text-[#94a3b8]">No squad selected yet</div>
                      ) : (
                        <div className="divide-y divide-[#334155]/50 px-2 lg:px-6 py-2">
                          {players.map((p, i) => {
                            const pid = p._id || p;
                            const isCap = capId === pid;
                            const isVC = vcId === pid;
                            const isWK = wkIds.includes(pid);
                            return (
                              <div key={pid} className="flex items-center justify-between py-3 hover:bg-[#0f172a]/30 px-4 rounded transition">
                                <div className="flex items-center gap-3">
                                  <span className="w-6 h-6 rounded-full bg-[#334155] flex items-center justify-center text-[10px] font-bold text-white">{i+1}</span>
                                  <div>
                                    <div className="font-bold text-white text-[15px]">{p.name || 'Player'}</div>
                                    <div className="text-[10px] text-[#94a3b8]">{p.playingRole || ''}</div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  {isCap && <span className="px-2 py-0.5 bg-[#f59e0b]/10 text-[#f59e0b] rounded text-[9px] font-bold border border-[#f59e0b]/20">C</span>}
                                  {isVC && <span className="px-2 py-0.5 bg-purple-500/10 text-purple-400 rounded text-[9px] font-bold border border-purple-500/20">VC</span>}
                                  {isWK && <span className="px-2 py-0.5 bg-[#3b82f6]/10 text-[#3b82f6] rounded text-[9px] font-bold border border-[#3b82f6]/20">WK</span>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {activeTab === 'Wagon Wheel' && (
            <WagonWheel battingData={currentInnings.batting} innings={currentInnings} />
          )}

          {activeTab === 'Partnerships' && (
            <PartnershipBuilder batting={currentInnings.batting} ballByBall={currentInnings.ballByBall || currentInnings.balls || []} />
          )}

          {activeTab === 'Stats' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-[#1e293b] rounded-xl border border-[#334155] p-6">
                <h3 className="text-[#94a3b8] text-xs font-bold uppercase tracking-widest mb-4">Batting Stats - {battingTeam?.name}</h3>
                <div className="space-y-4">
                  {currentInnings.batting?.map(b => (
                    <div key={b.player?._id} className="flex justify-between items-center bg-[#0f172a] p-3 rounded">
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-white">{b.player?.name}</span>
                        {b.isOut && <span className="text-xs text-[#ef4444]">({b.dismissalType})</span>}
                      </div>
                      <div className="text-right">
                        <span className="font-rajdhani font-bold text-lg text-white">{b.runs}</span>
                        <span className="text-xs text-[#94a3b8]"> ({b.balls}b)</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              
              <div className="bg-[#1e293b] rounded-xl border border-[#334155] p-6">
                <h3 className="text-[#94a3b8] text-xs font-bold uppercase tracking-widest mb-4">Bowling Stats - {bowlingTeam?.name}</h3>
                <div className="space-y-4">
                  {currentInnings.bowling?.map(b => (
                    <div key={b.player?._id} className="flex justify-between items-center bg-[#0f172a] p-3 rounded">
                      <span className="font-bold text-white">{b.player?.name}</span>
                      <div className="text-right">
                        <span className="font-rajdhani font-bold text-lg text-white">{b.wickets}/{b.runs}</span>
                        <span className="text-xs text-[#94a3b8]"> (ER: {b.economy})</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Placeholders for unused tabs designed by prompt */}
          {['Table', 'Photos', 'Videos', 'Blogs', 'Commentary'].includes(activeTab) && (
            <div className="bg-[#1e293b] p-20 text-center rounded-xl border border-[#334155] shadow border-dashed">
              <h2 className="text-2xl font-bold font-rajdhani text-white mb-2">{activeTab}</h2>
              <p className="text-[#94a3b8]">Live dynamic matching for this tab is under construction.</p>
            </div>
          )}

        </div>
      </div>
    </>
  );
}