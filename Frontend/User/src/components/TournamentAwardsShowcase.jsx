import React from "react";
import { Link } from "react-router-dom";

const valueOf = (source, key) => source?.[key] == null ? null : source[key];

function initials(name) {
  return String(name || "?")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "?";
}

function statLine(kind, player, rows) {
  const saved = player.stats || {};
  const row = rows.find((entry) => String(entry.playerId) === String(player.playerId));
  const source = Object.keys(saved).length ? saved : row || {};
  const parts = kind === "playerOfTournament"
    ? [
        valueOf(source, "matches") != null && `${source.matches} matches`,
        valueOf(source, "runs") != null && `${source.runs} runs`,
        valueOf(source, "wickets") != null && `${source.wickets} wickets`,
      ]
    : kind === "bestBatsman"
      ? [
          valueOf(source, "runs") != null && `${source.runs} runs`,
          (valueOf(source, "highest") ?? valueOf(source, "highestText")) != null &&
            `High score ${source.highest ?? source.highestText}`,
          valueOf(source, "strikeRate") != null && `SR ${source.strikeRate}`,
        ]
      : [
          valueOf(source, "wickets") != null && `${source.wickets} wickets`,
          valueOf(source, "economy") != null && `Econ ${source.economy}`,
          valueOf(source, "bestFigures") != null && `Best ${source.bestFigures}`,
        ];
  return parts.filter(Boolean).join(" · ");
}

function AwardCard({ title, kind, player, rows }) {
  if (!player) return null;
  const summary = statLine(kind, player, rows);
  const photo = player.imageUrl;
  const official = player.official !== false;

  const content = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-300">
          {official ? "Official award" : "Top by stats"}
        </span>
        <span aria-hidden="true" className="text-xl text-amber-500">🏆</span>
      </div>
      <div className="mt-4 flex min-w-0 items-center gap-4">
        {photo ? (
          <img
            src={photo}
            alt={player.name || "Player"}
            className="h-24 w-24 shrink-0 rounded-full border-4 border-amber-400 object-cover"
          />
        ) : (
          <div
            aria-label={`${player.name || "Player"} avatar`}
            className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full border-4 border-amber-400 bg-amber-500/15 text-2xl font-black text-amber-700 dark:text-amber-300"
          >
            {initials(player.name)}
          </div>
        )}
        <div className="min-w-0">
          <h3 className="break-words text-base font-black text-cric-text">{title}</h3>
          <p className="mt-1 break-words text-sm font-bold text-cric-text">{player.name}</p>
          {player.team && <p className="mt-0.5 break-words text-xs text-cric-muted">{player.team}</p>}
        </div>
      </div>
      {summary && <p className="mt-4 text-xs font-semibold text-cric-muted">{summary}</p>}
    </>
  );

  const className = "block min-w-0 rounded-xl border border-amber-300/70 bg-cric-card p-4 shadow-sm transition-colors hover:border-amber-500 dark:border-amber-700/70 dark:hover:border-amber-400";
  return player.playerId ? (
    <Link to={`/players/${player.playerId}`} className={className} data-testid={`award-card-${kind}`}>
      {content}
    </Link>
  ) : (
    <article className={className} data-testid={`award-card-${kind}`}>
      {content}
    </article>
  );
}

export default function TournamentAwardsShowcase({ stats = {}, showDerived = false }) {
  const officialAwards = stats.officialAwards || {};
  const officialTop = officialAwards.topPlayers?.[0] || officialAwards.playerOfTournament;
  const hasOfficialAwards = Boolean(
    officialTop || officialAwards.bestBatsman || officialAwards.bestBowler,
  );
  const allowDerived = showDerived || hasOfficialAwards;
  const impactRows = stats.playerOfTournament?.rows || [];
  const definitions = [
    {
      kind: "playerOfTournament",
      title: "Player of the Tournament",
      official: officialTop,
      derived: stats.playerOfTournament?.leader || impactRows[0],
      rows: impactRows,
    },
    {
      kind: "bestBatsman",
      title: "Best Batsman",
      official: officialAwards.bestBatsman,
      derived: stats.topRunScorers?.[0],
      rows: stats.topRunScorers || [],
    },
    {
      kind: "bestBowler",
      title: "Best Bowler",
      official: officialAwards.bestBowler,
      derived: stats.topWicketTakers?.[0],
      rows: stats.topWicketTakers || [],
    },
  ];
  const awards = definitions.map((item) => {
    const player = item.official || (allowDerived ? item.derived : null);
    return player ? { ...item, player: { ...player, official: Boolean(item.official) } } : null;
  }).filter(Boolean);

  if (awards.length === 0) return null;

  return (
    <section className="min-w-0" aria-label="Tournament awards" data-testid="tournament-awards-showcase">
      <h2 className="mb-4 text-lg font-black uppercase tracking-tight text-cric-text">Tournament Awards</h2>
      <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-3">
        {awards.map((award) => (
          <AwardCard
            key={award.kind}
            title={award.title}
            kind={award.kind}
            player={award.player}
            rows={award.rows}
          />
        ))}
      </div>
    </section>
  );
}