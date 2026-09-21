import React, { useEffect, useState } from "react";
import { api } from "../services/api";

export default function PointsTable() {
  const [table, setTable] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tournamentName, setTournamentName] = useState("");
  const [tournamentType, setTournamentType] = useState("");

  useEffect(() => {
    const fetchPointsTable = async () => {
      try {
        // Fetch all tournaments and events
        const [tournamentsRes, eventsRes] = await Promise.all([
          api.get("/tournaments"),
          api.get("/events")
        ]);

        const tournaments = tournamentsRes.data || [];
        const events = eventsRes.data || [];

        // Filter for tournament/league/tri-series only
        const validTypes = ['tournament', 'league', 'tri-series'];
        const validTournaments = tournaments.filter(t => validTypes.includes(t.type?.toLowerCase()));
        const validEvents = events.filter(e => validTypes.includes(e.eventType?.toLowerCase()));

        // Use first valid tournament/event
        const activeTournament = validTournaments[0] || validEvents[0];

        if (activeTournament) {
          setTournamentName(activeTournament.name);
          setTournamentType(activeTournament.type || activeTournament.eventType);

          // Fetch points table
          let pointsData;
          if (activeTournament.type) {
            const pointsRes = await api.get(`/tournaments/${activeTournament._id}/points-table`);
            pointsData = pointsRes.data;
          } else {
            // It's an event
            const eventDetail = await api.get(`/events/${activeTournament._id}`);
            pointsData = eventDetail.data.pointsTable || [];
          }

          setTable(Array.isArray(pointsData) ? pointsData : []);
        } else {
          setTable([]);
        }
        setLoading(false);
      } catch (err) {
        console.error("Failed to fetch points table:", err);
        setLoading(false);
        setTable([]);
      }
    };

    fetchPointsTable();
  }, []);

  // Only show for tournament/league/tri-series
  const isValidType = ['tournament', 'league', 'tri-series'].includes(tournamentType?.toLowerCase());

  return (
    <div className="min-h-screen bg-cric-bg text-cric-text font-sans">

      {/* Hero Section */}
      <div className="bg-cric-accent text-white py-16 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-600/10 rounded-full -mr-48 -mt-48 blur-3xl" />
        <div className="max-w-7xl mx-auto px-4 relative">
          <h1 className="text-5xl font-black uppercase tracking-tighter italic mb-4">Points Table</h1>
          <p className="text-blue-200/60 font-black uppercase tracking-widest text-sm">
            {tournamentName ? `${tournamentName} • ${tournamentType}` : 'Official League Standings'}
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-12">
        {!isValidType && !loading ? (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-12 text-center">
            <p className="text-xl font-black text-amber-800 mb-2">Points Table Not Available</p>
            <p className="text-sm text-amber-600">Points tables are only available for Tournaments, Leagues, and Tri-Series competitions.</p>
          </div>
        ) : loading ? (
          <div className="flex flex-col items-center justify-center py-24">
            <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-cric-muted font-black uppercase tracking-widest text-xs">Fetching Standings...</p>
          </div>
        ) : (
          <div className="bg-cric-card rounded-[2.5rem] shadow-xl border border-cric-border overflow-hidden overflow-x-auto">
            <table className="w-full text-left min-w-[800px]">
              <thead>
                <tr className="bg-cric-accent text-white">
                  <th className="px-8 py-6 text-[10px] font-black uppercase tracking-widest">Pos</th>
                  <th className="px-8 py-6 text-[10px] font-black uppercase tracking-widest">Team</th>
                  <th className="px-4 py-6 text-[10px] font-black uppercase tracking-widest text-center">M</th>
                  <th className="px-4 py-6 text-[10px] font-black uppercase tracking-widest text-center text-green-400">W</th>
                  <th className="px-4 py-6 text-[10px] font-black uppercase tracking-widest text-center text-red-400">L</th>
                  <th className="px-4 py-6 text-[10px] font-black uppercase tracking-widest text-center">T/NR</th>
                  <th className="px-4 py-6 text-[10px] font-black uppercase tracking-widest text-center">NRR</th>
                  <th className="px-8 py-6 text-[10px] font-black uppercase tracking-widest text-center bg-blue-600/20">PTS</th>
                  <th className="px-4 py-6 text-[10px] font-black uppercase tracking-widest">Form</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cric-bg">
                {table.length > 0 ? table
                  .sort((a, b) => (b.points || 0) - (a.points || 0) || (b.netRunRate || 0) - (a.netRunRate || 0))
                  .map((t, i) => (
                    <tr key={t._id || t.team?._id} className="group hover:bg-cric-bg transition-colors">
                      <td className="px-8 py-6 font-black text-cric-muted text-lg">{i + 1}</td>
                      <td className="px-8 py-6">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-xl bg-cric-bg border border-cric-border flex items-center justify-center p-2">
                            {t.team?.logo ? <img src={t.team.logo} className="w-full h-full object-contain" /> : <div className="w-full h-full bg-cric-accent rounded-lg flex items-center justify-center font-black text-white text-xs">{t.team?.name?.charAt(0) || 'T'}</div>}
                          </div>
                          <span className="font-bold text-cric-text">{t.team?.name || t.team || 'Team'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-6 font-bold text-cric-muted text-center">{t.matchesPlayed || 0}</td>
                      <td className="px-4 py-6 font-bold text-green-600 text-center">{t.won || 0}</td>
                      <td className="px-4 py-6 font-bold text-red-600 text-center">{t.lost || 0}</td>
                      <td className="px-4 py-6 font-bold text-cric-muted text-center">{(t.tied || 0) + (t.noResult || 0)}</td>
                      <td className="px-4 py-6 font-bold text-cric-accent text-center">{(t.netRunRate || 0).toFixed(3)}</td>
                      <td className="px-8 py-6 font-black text-cric-accent text-2xl text-center bg-cric-bg/50">{t.points || 0}</td>
                      <td className="px-4 py-6">
                        <div className="flex gap-1">
                          {(t.seriesForm || []).map((f, i) => (
                            <span key={i} className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold text-white ${f === "W" ? "bg-green-500" : f === "L" ? "bg-red-500" : "bg-slate-400"}`}>
                              {f}
                            </span>
                          ))}
                          {(!t.seriesForm || t.seriesForm.length === 0) && <span className="text-xs text-cric-muted">-</span>}
                        </div>
                      </td>
                    </tr>
                  )) : (
                  <tr>
                    <td colSpan="9" className="px-8 py-32 text-center">
                      <div className="w-20 h-20 bg-cric-bg rounded-full flex items-center justify-center mx-auto mb-6">
                        <svg className="w-10 h-10 text-cric-muted/40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      </div>
                      <h4 className="text-xl font-black text-cric-accent mb-2">No Points Table Available</h4>
                      <p className="text-cric-muted text-xs">Points tables will be available once matches begin for tournaments, leagues, or tri-series.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isValidType && table.length > 0 && (
        <div className="max-w-7xl mx-auto px-4 pb-12">
          <div className="bg-cric-card border border-cric-border rounded-2xl p-6">
            <p className="text-xs font-bold text-cric-accent">ℹ️ Qualification Rules</p>
            <p className="text-xs text-cric-accent mt-1">Top 4 teams qualify for playoffs. In case of tied points, Net Run Rate (NRR) is the primary tie-breaker.</p>
          </div>
        </div>
      )}
    </div>
  );
}
