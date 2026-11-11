import React from "react";
import { Link } from "react-router-dom";
import { teamInitials } from "../utils/teamDisplay";
import { finalMatchOf, teamId, tournamentChampion } from "../utils/tournamentChampion";

// The Home-tab champions card. It borrows the Final match's result line and
// links both the winning team and that result to their detail pages. Hidden on
// every tournament that has not been decided.
export default function TournamentChampionCard({ tournament, overview = {}, matches = [] }) {
  const champion = tournamentChampion(tournament, overview);
  if (!champion) return null;

  const { winner, runnerUp } = champion;
  const winnerId = teamId(winner);
  const finalMatch = finalMatchOf(matches);
  const result = finalMatch?.result?.description || "";
  const resultId = finalMatch?._id || null;

  return (
    <section
      data-testid="tournament-champion-card"
      aria-label="Tournament champions"
      className="min-w-0 overflow-hidden rounded-2xl border border-amber-300/70 bg-cric-card p-5 shadow-sm dark:border-amber-700/70"
    >
      <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
        <span aria-hidden="true" className="text-xl leading-none">🏆</span>
        <h2 className="text-[10px] font-black uppercase tracking-widest">Champions</h2>
      </div>

      <div className="mt-3 flex min-w-0 items-center gap-4">
        {winner.logo ? (
          <img
            src={winner.logo}
            alt={`${winner.name} logo`}
            className="h-16 w-16 shrink-0 rounded-full border-4 border-amber-400 object-cover"
          />
        ) : (
          <div
            aria-label={`${winner.name} logo`}
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-4 border-amber-400 bg-amber-500/15 text-lg font-black text-amber-700 dark:text-amber-300"
          >
            {teamInitials(winner.name)}
          </div>
        )}
        <div className="min-w-0">
          {winnerId ? (
            <Link
              to={`/teams/${winnerId}`}
              className="block truncate text-xl font-black text-cric-text hover:text-cric-accent"
            >
              {winner.name}
            </Link>
          ) : (
            <p className="block truncate text-xl font-black text-cric-text">{winner.name}</p>
          )}
          {runnerUp && (
            <p className="mt-1 break-words text-xs font-semibold text-cric-muted">
              Runners-up: {runnerUp.name}
            </p>
          )}
        </div>
      </div>

      {result && (
        resultId ? (
          <Link
            to={`/match/${resultId}`}
            data-testid="tournament-champion-result"
            className="mt-4 block break-words text-sm font-bold text-cric-accent hover:underline"
          >
            {result}
          </Link>
        ) : (
          <p data-testid="tournament-champion-result" className="mt-4 break-words text-sm font-bold text-cric-accent">
            {result}
          </p>
        )
      )}
    </section>
  );
}
