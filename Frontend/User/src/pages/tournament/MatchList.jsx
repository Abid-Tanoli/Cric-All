import React from "react";
import { Link } from "react-router-dom";
import { normalizeStatus } from "./matchUtils";

// A single fixture / result card. Deliberately mirrors the card the existing
// public Series page renders so the hub looks unchanged to a returning visitor,
// but reads only fields the match payload actually carries.
export function FixtureCard({ match }) {
  if (!match) return null;
  const status = normalizeStatus(match.status);
  const teams = match.teams || [];
  const innings = match.innings || [];
  const isLive = status === "live" || status === "innings_break" || status === "toss_done";
  const isCompleted = status === "completed" || status === "abandoned";

  return (
    <Link
      to={`/match/${match._id}`}
      className={`block bg-cric-card rounded-xl shadow-sm overflow-hidden border hover:shadow-md transition-all ${
        isLive ? "border-red-200" : "border-cric-border"
      }`}
    >
      <div className="p-4">
        <div className="flex items-center justify-between mb-3 gap-2">
          <span className="text-[10px] font-bold text-cric-muted uppercase tracking-wider truncate">
            {match.matchNumber ? `Match ${match.matchNumber}` : match.title || match.round || ""}
          </span>
          {isLive ? (
            <span className="px-2 py-0.5 bg-red-600 text-white rounded-full text-[9px] font-bold uppercase shrink-0">
              {status.replace("_", " ")}
            </span>
          ) : (
            <span className="text-[10px] font-bold text-cric-muted shrink-0 truncate">
              {match.startAt ? new Date(match.startAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : match.venue}
            </span>
          )}
        </div>

        {innings.length > 0 ? (
          <div className="space-y-2">
            {innings.slice(0, 2).map((inn, idx) => {
              const team = typeof inn.team === "object" ? inn.team : teams[idx] || {};
              const balls = Number(inn.balls) || 0;
              return (
                <div key={idx} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {team?.logo && <img src={team.logo} alt="" className="w-6 h-6 rounded-full object-cover" />}
                    <span className="font-bold text-sm text-cric-text uppercase">{team?.shortName || team?.name || "TBD"}</span>
                  </div>
                  <span className="font-black text-sm text-cric-text">
                    {inn.runs || 0}/{inn.wickets || 0}
                    <span className="text-xs text-cric-muted font-bold">
                      {" "}({Math.floor(balls / 6)}.{balls % 6})
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center justify-center gap-4 py-2">
            {teams.length === 0 && <span className="font-bold text-sm text-cric-text">To be decided</span>}
            {teams.map((team, idx) => (
              <React.Fragment key={team?._id || idx}>
                {idx > 0 && <span className="text-xs font-black text-cric-muted">VS</span>}
                <div className="flex flex-col items-center flex-1">
                  {team?.logo && <img src={team.logo} alt="" className="w-8 h-8 rounded-full object-cover mb-1" />}
                  <span className="font-bold text-xs text-cric-text uppercase text-center">{team?.shortName || team?.name}</span>
                </div>
              </React.Fragment>
            ))}
          </div>
        )}

        {isCompleted && match.result?.description && (
          <div className="mt-3 pt-3 border-t border-cric-border">
            <p className="text-sm font-bold text-green-700">{match.result.description}</p>
          </div>
        )}
        {!isCompleted && !isLive && match.startAt && (
          <p className="mt-3 pt-3 border-t border-cric-border text-center text-[10px] text-cric-muted font-bold">
            {new Date(match.startAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            {match.venue ? ` - ${match.venue}` : ""}
          </p>
        )}
      </div>
    </Link>
  );
}

/** A titled, colour-dotted section of fixture cards. */
export function MatchGroup({ title, color = "bg-cric-muted", matches = [] }) {
  if (!matches.length) return null;
  return (
    <div data-testid={`match-group-${title}`}>
      <h2 className="text-xl font-black text-cric-text uppercase tracking-tight mb-4 flex items-center gap-2">
        <span className={`w-2 h-6 ${color} rounded-full`} />
        {title} ({matches.length})
      </h2>
      <div className="grid grid-cols-1 gap-3">
        {matches.map((match) => (
          <FixtureCard key={match._id} match={match} />
        ))}
      </div>
    </div>
  );
}

export default FixtureCard;
