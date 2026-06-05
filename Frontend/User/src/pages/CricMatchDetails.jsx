import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import Header from "../components/Header";
import Loader from "../components/cricapi/Loader";
import ErrorState from "../components/cricapi/ErrorState";
import ScorecardTable from "../components/cricapi/ScorecardTable";
import SquadList from "../components/cricapi/SquadList";
import LiveScoreCard from "../components/cricapi/LiveScoreCard";
import { getMatchPoints, getMatchScorecard, getMatchSquad, searchPlayers } from "../services/cricApi";

const TABS = ["overview", "scorecard", "squads", "points", "players"];

export default function CricMatchDetails() {
  const { matchId } = useParams();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState((location.hash || "#overview").replace("#", ""));
  const [scorecard, setScorecard] = useState(null);
  const [squads, setSquads] = useState(null);
  const [points, setPoints] = useState(null);
  const [players, setPlayers] = useState([]);
  const [playerSearch, setPlayerSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadMatch = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [scorecardData, squadData, pointsData] = await Promise.all([
        getMatchScorecard(matchId, 0),
        getMatchSquad(matchId).catch(() => ({ squads: [] })),
        getMatchPoints(matchId).catch(() => ({ points: [] })),
      ]);
      setScorecard(scorecardData);
      setSquads(squadData);
      setPoints(pointsData);
    } catch (err) {
      setError(err.message || "Failed to load match details");
    } finally {
      setLoading(false);
    }
  }, [matchId]);

  useEffect(() => {
    loadMatch();
  }, [loadMatch]);

  useEffect(() => {
    const hashTab = (location.hash || "#overview").replace("#", "");
    if (TABS.includes(hashTab)) setActiveTab(hashTab);
  }, [location.hash]);

  useEffect(() => {
    if (!playerSearch.trim()) {
      setPlayers([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        setPlayers(await searchPlayers(playerSearch, 0));
      } catch {
        setPlayers([]);
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [playerSearch]);

  const match = scorecard?.match;
  const scoreRows = match?.score || [];
  const pointsRows = useMemo(() => Array.isArray(points?.points) ? points.points : [], [points]);

  return (
    <div className="min-h-screen bg-[#f0f2f5]">
      <Header />

      <section className="bg-gradient-to-r from-[#031d44] via-[#0a2d5e] to-[#031d44] py-8 text-white">
        <div className="mx-auto max-w-7xl px-4">
          <Link to="/series" className="text-xs font-black uppercase tracking-widest text-blue-200 hover:text-white">Back to series</Link>
          <h1 className="mt-4 text-3xl font-black uppercase tracking-tight">{match?.name || "Match Details"}</h1>
          {match && (
            <p className="mt-2 text-sm font-semibold text-blue-200">
              {match.matchType || "Match"} {match.venue ? `- ${match.venue}` : ""}
            </p>
          )}
        </div>
      </section>

      <nav className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl gap-2 overflow-x-auto px-4 py-2">
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`whitespace-nowrap rounded-xl px-4 py-2 text-xs font-black uppercase tracking-widest ${activeTab === tab ? "bg-[#ff6b35] text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              {tab}
            </button>
          ))}
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-4 py-8">
        {loading ? (
          <Loader label="Loading match details..." />
        ) : error ? (
          <ErrorState message={error} onRetry={loadMatch} />
        ) : (
          <>
            {activeTab === "overview" && (
              <div className="space-y-5">
                {match && <LiveScoreCard match={match} />}
                <div className="grid gap-4 md:grid-cols-3">
                  <InfoTile label="Status" value={match?.status || "Unknown"} />
                  <InfoTile label="Date" value={match?.date ? new Date(match.date).toLocaleString() : "TBC"} />
                  <InfoTile label="Venue" value={match?.venue || "Venue TBA"} />
                </div>
                <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                  <h2 className="mb-3 text-xs font-black uppercase tracking-widest text-slate-500">Scores</h2>
                  <div className="space-y-2">
                    {scoreRows.length ? scoreRows.map((score, index) => (
                      <div key={`${score.team}-${index}`} className="flex justify-between rounded-xl bg-slate-50 px-4 py-3">
                        <span className="font-black text-slate-700">{score.team || `Innings ${index + 1}`}</span>
                        <span className="font-black text-slate-900">{score.runs}/{score.wickets} ({score.overs})</span>
                      </div>
                    )) : <p className="text-sm font-bold text-slate-500">No score available yet.</p>}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "scorecard" && <ScorecardTable scorecard={scorecard?.scorecard || []} />}
            {activeTab === "squads" && <SquadList squads={squads?.squads || []} />}

            {activeTab === "points" && (
              <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <h2 className="mb-4 text-xs font-black uppercase tracking-widest text-slate-500">Fantasy / Match Points</h2>
                {pointsRows.length ? (
                  <div className="overflow-x-auto">
                    <pre className="rounded-xl bg-slate-50 p-4 text-xs text-slate-700">{JSON.stringify(pointsRows, null, 2)}</pre>
                  </div>
                ) : (
                  <p className="text-sm font-bold text-slate-500">Points are not available for this match.</p>
                )}
              </div>
            )}

            {activeTab === "players" && (
              <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-400">Player Search</label>
                <input
                  value={playerSearch}
                  onChange={(event) => setPlayerSearch(event.target.value)}
                  placeholder="Search player name..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-blue-500"
                />
                <div className="mt-4 divide-y divide-slate-100">
                  {players.map((player) => (
                    <div key={player.id || player.name} className="flex justify-between py-3">
                      <span className="font-black text-slate-800">{player.name}</span>
                      <span className="text-xs font-bold text-slate-500">{player.country || "BQ-PLAY"}</span>
                    </div>
                  ))}
                  {playerSearch && players.length === 0 && <p className="py-4 text-sm font-bold text-slate-500">No players found.</p>}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function InfoTile({ label, value }) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
      <p className="mt-2 text-sm font-black text-[#031d44]">{value}</p>
    </div>
  );
}
