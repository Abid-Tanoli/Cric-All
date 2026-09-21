import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
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
    <div className="min-h-screen bg-cric-bg">

      <section className="bg-gradient-to-r from-cric-accent via-cric-accent to-cric-accent py-8 text-white">
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

      <nav className="sticky top-0 z-30 border-b border-cric-border bg-cric-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl gap-2 overflow-x-auto px-4 py-2">
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`whitespace-nowrap rounded-xl px-4 py-2 text-xs font-black uppercase tracking-widest ${activeTab === tab ? "bg-cric-accent text-white" : "text-cric-muted hover:bg-cric-bg"}`}
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
                <div className="rounded-2xl bg-cric-card p-5 shadow-sm ring-1 ring-cric-border">
                  <h2 className="mb-3 text-xs font-black uppercase tracking-widest text-cric-muted">Scores</h2>
                  <div className="space-y-2">
                    {scoreRows.length ? scoreRows.map((score, index) => (
                      <div key={`${score.team}-${index}`} className="flex justify-between rounded-xl bg-cric-bg px-4 py-3">
                        <span className="font-black text-cric-text">{score.team || `Innings ${index + 1}`}</span>
                        <span className="font-black text-cric-text">{score.runs}/{score.wickets} ({score.overs})</span>
                      </div>
                    )) : <p className="text-sm font-bold text-cric-muted">No score available yet.</p>}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "scorecard" && <ScorecardTable scorecard={scorecard?.scorecard || []} />}
            {activeTab === "squads" && <SquadList squads={squads?.squads || []} />}

            {activeTab === "points" && (
              <div className="rounded-2xl bg-cric-card p-5 shadow-sm ring-1 ring-cric-border">
                <h2 className="mb-4 text-xs font-black uppercase tracking-widest text-cric-muted">Fantasy / Match Points</h2>
                {pointsRows.length ? (
                  <div className="overflow-x-auto">
                    <pre className="rounded-xl bg-cric-bg p-4 text-xs text-cric-text">{JSON.stringify(pointsRows, null, 2)}</pre>
                  </div>
                ) : (
                  <p className="text-sm font-bold text-cric-muted">Points are not available for this match.</p>
                )}
              </div>
            )}

            {activeTab === "players" && (
              <div className="rounded-2xl bg-cric-card p-5 shadow-sm ring-1 ring-cric-border">
                <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-cric-muted">Player Search</label>
                <input
                  value={playerSearch}
                  onChange={(event) => setPlayerSearch(event.target.value)}
                  placeholder="Search player name..."
                  className="w-full rounded-xl border border-cric-border bg-cric-bg px-4 py-3 text-sm font-bold outline-none focus:border-cric-accent"
                />
                <div className="mt-4 divide-y divide-cric-border">
                  {players.map((player) => (
                    <div key={player.id || player.name} className="flex justify-between py-3">
                      <span className="font-black text-cric-text">{player.name}</span>
                      <span className="text-xs font-bold text-cric-muted">{player.country || "CricAll"}</span>
                    </div>
                  ))}
                  {playerSearch && players.length === 0 && <p className="py-4 text-sm font-bold text-cric-muted">No players found.</p>}
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
    <div className="rounded-2xl bg-cric-card p-5 shadow-sm ring-1 ring-cric-border">
      <p className="text-[10px] font-black uppercase tracking-widest text-cric-muted">{label}</p>
      <p className="mt-2 text-sm font-black text-cric-accent">{value}</p>
    </div>
  );
}
