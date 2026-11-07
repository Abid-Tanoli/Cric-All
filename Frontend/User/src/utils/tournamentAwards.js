// Shape the end-of-tournament honours a tournament carries into the rows the
// Awards tab and Player of the Tournament card render. Pure so it can be unit
// tested without mounting the whole series page.
//
// Precedence for each player award:
//   1. `officialAwards.*` — organiser-confirmed "Official award".
//   2. `awards.*`         — the older manual honours field.
//   3. derived stats      — the current leader on the statistics payload.
//
// Official awards are presentation only: they never change the computed impact
// points/order, which still comes from `playerOfTournament.rows`.
//
// `series` is the payload of `GET /tournaments/:id`: `winner` and `runnerUp`
// are populated Team refs; `officialAwards.*` and `awards.*` may be populated
// Player refs or the pre-shaped public `officialAwards` block from the stats
// endpoint. Any ref may be missing or a bare id string.

const refName = (ref) =>
  ref && typeof ref === "object" ? ref.name || ref.fullName || ref.shortName || "" : "";

const refId = (ref) => {
  if (!ref || typeof ref !== "object") return ref || undefined;
  return ref._id ?? ref.id ?? ref.playerId ?? undefined;
};

const refRole = (ref) =>
  ref && typeof ref === "object" ? ref.playingRole || ref.role || "" : "";

const looksLikeId = (value) =>
  typeof value === "string" && /^[a-f0-9]{24}$/i.test(value);

const refTeamName = (ref) => {
  if (!ref || typeof ref !== "object") return "";
  const team = ref.team;
  if (typeof team === "string") return looksLikeId(team) ? "" : team;
  if (team && typeof team === "object") return team.name || team.shortName || "";
  return "";
};

const playerRow = ({ title, key, ref, official = false, derived = false, value = "" }) => {
  const name = refName(ref);
  if (!name) return null;
  const playerId = refId(ref);
  return {
    title,
    name,
    // `key` stays stable when the same player wins more than one award.
    key: `${key}-${playerId || name}`,
    playerId: playerId || undefined,
    subtitle: refRole(ref),
    team: refTeamName(ref) || ref?.teamName || "",
    value,
    official,
    derived,
  };
};

const DERIVED_AWARDS = {
  playerOfTournament: (stats) => {
    const leader = stats?.playerOfTournament?.leader;
    if (!leader) return null;
    return {
      title: "Player of the Tournament",
      key: "pot",
      ref: leader,
      value: leader.impact == null ? "" : `${leader.impact} impact points`,
    };
  },
  bestBatsman: (stats) => {
    const leader = stats?.topRunScorers?.[0];
    if (!leader) return null;
    return {
      title: "Best Batsman",
      key: "bat",
      ref: leader,
      value: leader.runs == null ? "" : `${leader.runs} runs`,
    };
  },
  bestBowler: (stats) => {
    const leader = stats?.topWicketTakers?.[0];
    if (!leader) return null;
    return {
      title: "Best Bowler",
      key: "bowl",
      ref: leader,
      value: leader.wickets == null ? "" : `${leader.wickets} wickets`,
    };
  },
};

const PLAYER_AWARD_TITLES = {
  playerOfTournament: "Player of the Tournament",
  bestBatsman: "Best Batsman",
  bestBowler: "Best Bowler",
};

export function buildTournamentAwards(series, stats = {}) {
  if (!series || typeof series !== "object") return [];

  const rows = [
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
  ];

  const officialSource = series.officialAwards || stats?.officialAwards || {};
  for (const [field, title] of Object.entries(PLAYER_AWARD_TITLES)) {
    const officialRef = officialSource?.[field];
    if (officialRef) {
      rows.push(playerRow({ title, key: field, ref: officialRef, official: true }));
      continue;
    }

    const legacyRef = series.awards?.[field];
    if (legacyRef) {
      rows.push(playerRow({ title, key: field, ref: legacyRef }));
      continue;
    }

    const derived = DERIVED_AWARDS[field]?.(stats);
    if (derived) {
      rows.push(
        playerRow({
          title: derived.title,
          key: derived.key,
          ref: derived.ref,
          derived: true,
          value: derived.value,
        }),
      );
    }
  }

  return rows.filter(Boolean);
}

export default { buildTournamentAwards };
