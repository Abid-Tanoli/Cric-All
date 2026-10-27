import React from "react";
import { Link } from "react-router-dom";
import { groupMatches } from "../matchUtils";

function StatBox({ value, label, tone = "text-cric-text" }) {
  return (
    <div className="bg-cric-card rounded-xl p-4 border border-cric-border text-center">
      <div className={`text-2xl font-black ${tone}`}>{value}</div>
      <div className="text-[10px] font-bold text-cric-muted uppercase tracking-widest mt-1">{label}</div>
    </div>
  );
}

function MiniMatchLink({ match }) {
  return (
    <Link to={`/match/${match._id}`} className="block p-3 rounded-lg hover:bg-cric-bg transition-colors">
      <p className="font-bold text-sm text-cric-text">
        {(match.teams || []).map((t) => t?.shortName || t?.name).filter(Boolean).join(" vs ") || match.title}
      </p>
      <p className="text-xs text-cric-muted">
        {match.result?.description || (match.startAt ? new Date(match.startAt).toLocaleString() : "Date TBD")}
      </p>
    </Link>
  );
}

export default function HomeTab({ content, matches = [], stats = {}, basePath }) {
  const { live, completed, upcoming } = groupMatches(matches);
  const overview = content?.overview || {};
  const sixes = stats?.boundaryMeter?.sixes ?? stats?.totalSixes ?? 0;
  const fours = stats?.boundaryMeter?.fours ?? stats?.totalFours ?? 0;
  const totalRuns = stats?.totalRuns ?? stats?.tournamentTotals?.runs ?? 0;
  const totalWickets = stats?.totalWickets ?? stats?.tournamentTotals?.wickets ?? 0;

  return (
    <div className="space-y-8">
      {(overview.shortDescription || overview.city) && (
        <div className="bg-cric-card rounded-2xl shadow-sm p-6 border border-cric-border">
          {overview.shortDescription && <p className="text-sm text-cric-text">{overview.shortDescription}</p>}
          {overview.city && (
            <p className="text-xs font-bold text-cric-muted uppercase tracking-widest mt-2">{overview.city}</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <StatBox value={matches.length} label="Total Matches" />
        <StatBox value={live.length} label="Live" tone="text-red-600" />
        <StatBox value={completed.length} label="Completed" tone="text-green-600" />
        <StatBox value={upcoming.length} label="Upcoming" tone="text-blue-600" />
        <StatBox value={sixes} label="Sixes" tone="text-purple-600" />
        <StatBox value={fours} label="Fours" tone="text-purple-600" />
        <StatBox value={totalRuns} label="Total Runs" tone="text-cric-accent" />
        <StatBox value={totalWickets} label="Wickets" tone="text-amber-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-cric-card rounded-2xl shadow-sm p-6 border border-cric-border">
          <h3 className="text-lg font-black text-cric-text uppercase tracking-tight mb-4">Recent Results</h3>
          {completed.length === 0 ? (
            <p className="text-cric-muted text-sm">No completed matches yet.</p>
          ) : (
            <div className="space-y-2">
              {completed.slice(-5).reverse().map((match) => (
                <MiniMatchLink key={match._id} match={match} />
              ))}
            </div>
          )}
        </div>
        <div className="bg-cric-card rounded-2xl shadow-sm p-6 border border-cric-border">
          <h3 className="text-lg font-black text-cric-text uppercase tracking-tight mb-4">Upcoming Fixtures</h3>
          {upcoming.length === 0 ? (
            <p className="text-cric-muted text-sm">No upcoming fixtures.</p>
          ) : (
            <div className="space-y-2">
              {upcoming.slice(0, 5).map((match) => (
                <MiniMatchLink key={match._id} match={match} />
              ))}
            </div>
          )}
        </div>
      </div>

      {live.length > 0 && (
        <div>
          <h3 className="text-lg font-black text-cric-text uppercase tracking-tight mb-4 flex items-center gap-2">
            <span className="w-2 h-6 bg-red-600 rounded-full" /> Live Now
          </h3>
          <div className="space-y-2">
            {live.map((match) => (
              <MiniMatchLink key={match._id} match={match} />
            ))}
          </div>
        </div>
      )}

      {basePath !== undefined && matches.length > 0 && (
        <Link to={`${basePath}/fixtures`} className="inline-block text-sm font-bold text-cric-accent hover:underline">
          View all fixtures &amp; results →
        </Link>
      )}
    </div>
  );
}
