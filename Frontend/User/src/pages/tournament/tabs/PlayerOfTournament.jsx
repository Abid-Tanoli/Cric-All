import React, { useState } from "react";
import { Link } from "react-router-dom";
import TournamentAwardsShowcase from "../../../components/TournamentAwardsShowcase";

// ---------------------------------------------------------------------------
// Player of the Tournament
// ---------------------------------------------------------------------------
// Renders the impact ranking computed by Backend/src/services/tournamentImpact.js.
// Every weight and the "How it's calculated" copy come from the API payload, so
// changing a constant on the server updates this card without a frontend edit.

const Breakdown = ({ row }) => {
  const items = [
    ["Batting", row.breakdown?.batting],
    ["Bowling", row.breakdown?.bowling],
    ["Fielding", row.breakdown?.fielding],
    ["Team share", row.breakdown?.teamShare],
    ["Finishing", row.breakdown?.finishing],
    ["Winning", row.breakdown?.winBonus],
    ["Player of the Match", row.breakdown?.manOfMatchBonus],
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg bg-cric-bg px-3 py-2">
          <div className="text-[9px] uppercase tracking-wide text-cric-muted font-bold">{label}</div>
          <div className={`text-sm font-black ${(value || 0) < 0 ? "text-red-600" : "text-cric-text"}`}>
            {value == null ? "—" : Number(value).toFixed(2)}
          </div>
        </div>
      ))}
    </div>
  );
};

const PodiumPlayer = ({ player, position }) => {
  const first = position === 1;
  const initials = (player.name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "?";
  const size = first ? "h-28 w-28 text-3xl" : "h-20 w-20 text-2xl";

  return (
    <div
      className={`flex min-w-0 flex-col items-center rounded-xl border border-cric-border bg-cric-card px-3 py-4 text-center ${
        first ? "order-1 md:order-2 md:scale-105" : position === 2 ? "order-2 md:order-1 md:mt-6" : "order-3 md:mt-6"
      }`}
      data-testid={`podium-place-${position}`}
    >
      <span className="rounded-full bg-amber-500 px-3 py-1 text-[10px] font-black uppercase text-white">
        {position === 1 ? "1st place" : position === 2 ? "2nd place" : "3rd place"}
      </span>
      {player.imageUrl ? (
        <img
          src={player.imageUrl}
          alt={player.name || "Player"}
          className={`${size} mt-3 rounded-full border-4 ${first ? "border-amber-400" : "border-cric-border"} object-cover`}
        />
      ) : (
        <div
          aria-label={`${player.name || "Player"} avatar`}
          className={`${size} mt-3 flex items-center justify-center rounded-full border-4 ${first ? "border-amber-400 bg-amber-500/15 text-amber-700" : "border-cric-border bg-cric-bg text-cric-muted"} font-black`}
          data-testid={`podium-avatar-${player.playerId || position}`}
        >
          {initials}
        </div>
      )}
      <div className="mt-3 min-w-0">
        {player.playerId ? (
          <Link to={`/players/${player.playerId}`} className="break-words font-black text-cric-text hover:text-cric-accent">
            {player.name || "Player"}
          </Link>
        ) : (
          <span className="break-words font-black text-cric-text">{player.name || "Player"}</span>
        )}
        <div className="mt-1 break-words text-xs text-cric-muted">{player.team || ""}</div>
      </div>
    </div>
  );
};

export default function PlayerOfTournament({ data, officialAwards, stats = {} }) {
  const [openId, setOpenId] = useState(null);
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const leader = data?.leader || rows[0] || null;
  const explanation = Array.isArray(data?.explanation) ? data.explanation : [];
  const officialNote = officialAwards?.note || data?.officialNote || "";
  const officialTopPlayers = Array.isArray(officialAwards?.topPlayers)
    ? officialAwards.topPlayers
    : [];
  const legacyOfficialPlayer = officialAwards?.playerOfTournament || data?.officialAward || null;
  const podiumPlayers = officialTopPlayers.length
    ? officialTopPlayers.slice(0, 3)
    : legacyOfficialPlayer
      ? [{ ...legacyOfficialPlayer, position: 1 }]
      : (Array.isArray(data?.topPlayers) ? data.topPlayers : rows.slice(0, 3));
  const isOfficialPodium = officialTopPlayers.length > 0 || Boolean(legacyOfficialPlayer);

  return (
    <>
      <TournamentAwardsShowcase stats={stats} showDerived />
      <div className="bg-cric-card rounded-2xl shadow-sm overflow-hidden border border-cric-border">
      <div className="p-6 border-b border-cric-border bg-gradient-to-r from-amber-500 to-orange-600 text-white">
        <h3 className="text-xl font-black uppercase tracking-tight flex items-center gap-2">
          <span className="text-2xl">🌟</span> Player of the Tournament
        </h3>
        <p className="text-xs text-white/80 mt-1">
          Impact ranking, not just runs or wickets · provisional until the Final is completed
        </p>
        <p className="text-xs text-white/90 mt-2 max-w-3xl">
          Points reward runs, wickets, fielding and your share of the team&apos;s runs and
          wickets, with extra credit for finishing an unbeaten chase and for winning.
        </p>
      </div>

      {podiumPlayers.length > 0 && (
        <section className="border-b border-cric-border px-4 py-5 sm:px-6" data-testid="tournament-podium">
          <h4 className="mb-4 text-center text-xs font-black uppercase tracking-widest text-cric-muted">
            {isOfficialPodium ? "Official Top 3" : "Top 3 by impact points"}
          </h4>
          <div className="mx-auto grid max-w-4xl grid-cols-1 items-end gap-3 md:grid-cols-3">
            {podiumPlayers.slice(0, 3).map((player, index) => (
              <PodiumPlayer
                key={player.playerId || player.position || index}
                player={player}
                position={player.position || index + 1}
              />
            ))}
          </div>
          {officialNote && isOfficialPodium ? (
            <p className="mx-auto mt-3 max-w-3xl text-center text-xs text-cric-muted">{officialNote}</p>
          ) : null}
        </section>
      )}

      {!leader && (
        <div className="px-4 py-8 text-center text-cric-muted">
          The Player of the Tournament ranking appears once matches are completed.
        </div>
      )}

      {leader && (
        <div className="p-6 border-b border-cric-border bg-cric-bg/60">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            {leader.imageUrl ? (
              <img
                src={leader.imageUrl}
                alt={leader.name}
                className="w-20 h-20 rounded-2xl object-cover border-2 border-amber-400 shrink-0"
              />
            ) : (
              <div className="w-20 h-20 rounded-2xl bg-amber-500/15 border-2 border-amber-400 flex items-center justify-center text-2xl font-black text-amber-700 shrink-0">
                {(leader.name || "?").charAt(0)}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-black uppercase tracking-widest text-amber-700">Leader</div>
              {leader.playerId ? (
                <Link to={`/players/${leader.playerId}`} className="text-xl font-black text-cric-text hover:text-cric-accent">
                  {leader.name}
                </Link>
              ) : (
                <span className="text-xl font-black text-cric-text">{leader.name}</span>
              )}
              <div className="text-xs text-cric-muted">
                {leader.team}
                {leader.matches ? ` · ${leader.matches} matches` : ""}
              </div>
            </div>
            <div className="text-left sm:text-right">
              <div className="text-[10px] font-black uppercase tracking-widest text-cric-muted">Impact</div>
              <div className="text-3xl font-black text-amber-700">{leader.impact}</div>
            </div>
          </div>
          <div className="mt-4">
            <Breakdown row={leader} />
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-cric-bg text-cric-muted uppercase text-[11px] font-bold">
              <tr>
                <th className="px-3 py-3">#</th>
                <th className="px-4 py-3">Player</th>
                <th className="px-3 py-3 text-center" title="Matches played">M</th>
                <th className="px-3 py-3 text-center">Runs</th>
                <th className="px-3 py-3 text-center">Wkts</th>
                <th className="px-3 py-3 text-center">Impact</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => {
                const key = row.playerId || row.name;
                const open = openId === key;
                return (
                  <React.Fragment key={key}>
                    <tr
                      className={`hover:bg-cric-bg transition-colors cursor-pointer ${open ? "bg-cric-bg" : ""}`}
                      onClick={() => setOpenId(open ? null : key)}
                      aria-expanded={open}
                    >
                      <td className="px-3 py-3 font-bold text-cric-muted">{row.rank}</td>
                      <td className="px-4 py-3">
                        {row.playerId ? (
                          <Link
                            to={`/players/${row.playerId}`}
                            className="font-bold text-cric-text hover:text-cric-accent"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {row.name}
                          </Link>
                        ) : (
                          <span className="font-bold text-cric-text">{row.name}</span>
                        )}
                        <div className="text-[10px] text-cric-muted">{row.team}</div>
                      </td>
                      <td className="px-3 py-3 text-center" title="Matches played">{row.matches || 0}</td>
                      <td className="px-3 py-3 text-center">{row.runs || 0}</td>
                      <td className="px-3 py-3 text-center">{row.wickets || 0}</td>
                      <td className="px-3 py-3 text-center font-black text-amber-700">{row.impact}</td>
                    </tr>
                    {open && (
                      <tr className="bg-cric-bg/70">
                        <td colSpan={6} className="px-4 py-3">
                          <Breakdown row={row} />
                          <div className="mt-2 text-[10px] text-cric-muted">
                            {row.innings ? `${row.innings} innings · ${row.runs} runs` : "No innings"}
                            {row.ballsBowled ? ` · ${row.oversText} overs · ${row.wickets} wickets` : ""}
                            {row.manOfMatchAwards ? ` · ${row.manOfMatchAwards}x Player of the Match` : ""}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {explanation.length > 0 && (
        <details className="border-t border-cric-border px-4 py-3">
          <summary className="cursor-pointer text-xs font-black uppercase tracking-wide text-cric-muted">
            How points are calculated
          </summary>
          <ul className="mt-3 space-y-1 text-xs text-cric-muted list-disc pl-5">
            {explanation.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="mt-3 text-[10px] text-cric-muted/80">
            Tap any row in the top 10 to see its breakdown. Fielding is only counted where the scorecard records it.
          </p>
        </details>
      )}
      </div>
    </>
  );
}
