// P4: shape the end-of-tournament honours a tournament document carries into
// the rows the Awards tab renders. Pure so it can be unit tested without
// mounting the whole series page.
//
// `series` is the payload of `GET /tournaments/:id`: `winner` and `runnerUp`
// are populated Team refs, and `awards.*` are populated Player refs. Any of
// them may be missing or still be a bare id string, hence the small ref
// helpers.

const refName = (ref) =>
  ref && typeof ref === "object" ? ref.name || ref.fullName || ref.shortName || "" : "";

const refId = (ref) => (ref && typeof ref === "object" ? ref._id : ref);

const refRole = (ref) =>
  ref && typeof ref === "object" ? ref.playingRole || ref.role || "" : "";

export function buildTournamentAwards(series) {
  if (!series || typeof series !== "object") return [];

  return [
    series.winner && {
      title: "Champion",
      name: refName(series.winner),
      key: `team-${refId(series.winner)}`,
      teamId: refId(series.winner),
    },
    series.runnerUp && {
      title: "Runner-up",
      name: refName(series.runnerUp),
      key: `team-${refId(series.runnerUp)}`,
      teamId: refId(series.runnerUp),
    },
    series.awards?.playerOfTournament && {
      title: "Player of the Tournament",
      name: refName(series.awards.playerOfTournament),
      subtitle: refRole(series.awards.playerOfTournament),
      key: `pot-${refId(series.awards.playerOfTournament)}`,
      playerId: refId(series.awards.playerOfTournament),
    },
    series.awards?.bestBatsman && {
      title: "Best Batsman",
      name: refName(series.awards.bestBatsman),
      subtitle: refRole(series.awards.bestBatsman),
      key: `bat-${refId(series.awards.bestBatsman)}`,
      playerId: refId(series.awards.bestBatsman),
    },
    series.awards?.bestBowler && {
      title: "Best Bowler",
      name: refName(series.awards.bestBowler),
      subtitle: refRole(series.awards.bestBowler),
      key: `bowl-${refId(series.awards.bestBowler)}`,
      playerId: refId(series.awards.bestBowler),
    },
  ].filter(Boolean);
}

export default { buildTournamentAwards };
