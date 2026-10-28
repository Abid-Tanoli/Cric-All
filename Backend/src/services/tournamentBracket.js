import { inningsTotals } from "./tournamentStats.js";

// ---------------------------------------------------------------------------
// Public knockout bracket
// ---------------------------------------------------------------------------
//
// The points table is meaningless for a pure knockout, so the hub swaps it for
// this bracket. It is derived from the same Match documents the Fixtures tab
// uses: a stage match that exists (published or not) is shown with its teams,
// score and winner; a later stage that has not been drawn yet gets a
// "Winner QF1"-style placeholder. A published semi-final already carries the
// quarter-final winners as its teams, so it auto-appears here with no extra
// write.

export const BRACKET_STAGES = Object.freeze([
  { stage: "quarter_final", label: "Quarter Finals", short: "QF" },
  { stage: "semi_final", label: "Semi Finals", short: "SF" },
  { stage: "final", label: "Final", short: "F" },
]);
const THIRD_PLACE = { stage: "third_place", label: "Third Place", short: "3rd" };

const idOf = (value) => {
  if (!value) return "";
  if (typeof value === "object") return String(value._id || value.id || "");
  return String(value);
};

/** Map a stored stage/round/stageLabel onto a bracket stage key. */export function normalizeBracketStage(match) {
  const raw = String(match?.stage || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["quarter_final", "quarterfinal", "quarterfinals", "qf"].includes(raw)) return "quarter_final";
  if (["semi_final", "semifinal", "semifinals", "semi", "sf"].includes(raw)) return "semi_final";
  if (["third_place", "thirdplace", "third_place_playoff", "3rd_place", "3rd"].includes(raw)) {
    return "third_place";
  }
  if (["final", "f"].includes(raw)) return "final";

  // Legacy fixtures only have `round` / `stageLabel` strings.
  const text = String(match?.stageLabel || match?.round || "").trim().toLowerCase();
  if (!text) return "";
  if (/quarter|\bqf\b/.test(text)) return "quarter_final";
  if (/semi|\bsf\b/.test(text)) return "semi_final";
  if (/third|3rd/.test(text)) return "third_place";
  if (/^final\b|\bfinal\b/.test(text)) return "final";
  return "";
}

function formatOvers(balls) {
  const safe = Number(balls) || 0;
  return `${Math.floor(safe / 6)}.${safe % 6}`;
}

function scoreForInnings(innings) {
  if (!innings) return null;
  const totals = inningsTotals(innings);
  return {
    runs: totals.runs,
    wickets: totals.wickets,
    overs: formatOvers(totals.balls),
    text: `${totals.runs}/${totals.wickets}`,
  };
}

function teamRef(team, innings, winnerId) {
  const id = idOf(team);
  if (!id) return null;
  return {
    _id: id,
    name: typeof team === "object" ? team.name || "" : "",
    shortName: typeof team === "object" ? team.shortName || "" : "",
    logo: typeof team === "object" ? team.logo || "" : "",
    score: scoreForInnings(innings),
    isWinner: Boolean(winnerId) && winnerId === id,
  };
}

function cardForMatch(match, stage) {
  const winnerId = idOf(match?.result?.winner);
  const innings = Array.isArray(match?.innings) ? match.innings : [];
  const inningsForTeam = (teamId) =>
    innings.find((inningsRow) => idOf(inningsRow?.team) === teamId);

  const teams = (match?.teams || [])
    .map((team) => teamRef(team, inningsForTeam(idOf(team)), winnerId))
    .filter(Boolean);

  return {
    placeholder: false,
    matchId: idOf(match),
    stage,
    stageLabel: match?.stageLabel || "",
    title: match?.title || "",
    status: String(match?.status || "upcoming"),
    startAt: match?.startAt || null,
    teams,
    winner: winnerId ? teams.find((team) => team._id === winnerId) || { _id: winnerId } : null,
    result: {
      resultType: match?.result?.resultType || "",
      description:
        match?.result?.description ||
        match?.result?.resultText ||
        match?.result?.summary ||
        "",
      winnerId,
    },
  };
}

function placeholderFor(stage, label, slots = []) {
  return {
    placeholder: true,
    matchId: null,
    stage,
    stageLabel: "",
    title: label,
    status: "upcoming",
    startAt: null,
    teams: [],
    winner: null,
    result: { resultType: "", description: "", winnerId: "" },
    label,
    // A final has two entrants, so its placeholder names both semi-final
    // winners instead of pretending the match has only one slot.
    slots,
  };
}

/**
 * Pure: build the bracket for a tournament from its matches.
 *
 * @param {Array} matches  Match-like documents (stage/stageLabel/teams/innings/result).
 * @param {object} [opts]  { type } tournament type, used to decide whether to
 *                         render a bracket for a knockout/mixed competition.
 */
export function buildTournamentBracket(matches = [], opts = {}) {
  const byStage = new Map();
  for (const match of matches || []) {
    if (match?.manualDraft === true || match?.isDraft === true) continue;
    const stage = normalizeBracketStage(match);
    if (!stage) continue;
    if (!byStage.has(stage)) byStage.set(stage, []);
    byStage.get(stage).push(match);
  }

  const hasStageMatches = byStage.size > 0;
  const type = String(opts.type || "").toLowerCase();
  if (!hasStageMatches && !["knockout", "mixed"].includes(type)) return null;

  const order = [...BRACKET_STAGES];
  if (byStage.has("third_place")) order.push(THIRD_PLACE);

  const sortMatches = (list) =>
    [...list].sort(
      (a, b) =>
        new Date(a.startAt || 0).getTime() - new Date(b.startAt || 0).getTime() ||
        (Number(a.matchNumber) || 0) - (Number(b.matchNumber) || 0),
    );

  const existing = new Map(
    order.map(({ stage }) => [stage, sortMatches(byStage.get(stage) || [])]),
  );

  const qfCount = existing.get("quarter_final").length;
  const semiCount = existing.get("semi_final").length;
  const expectedSemi = qfCount > 0 ? Math.max(semiCount, Math.ceil(qfCount / 2)) : semiCount;
  const expected = {
    quarter_final: qfCount,
    semi_final: expectedSemi,
    final: expectedSemi > 0 || qfCount > 0 ? 1 : existing.get("final").length,
    third_place: existing.get("third_place")?.length || 0,
  };

  const stages = order.map(({ stage, label, short }) => {
    const cards = existing.get(stage).map((match) => cardForMatch(match, stage));
    const missing = Math.max(0, (expected[stage] || 0) - cards.length);
    const placeholders = [];
    for (let index = cards.length; index < cards.length + missing; index += 1) {
      let sourceLabel = "TBD";
      if (stage === "semi_final") {
        const qf = existing.get("quarter_final")[index * 2];
        sourceLabel = qf
          ? `Winner ${qf.stageLabel || `${short}${index * 2 + 1}`}`
          : `Winner QF${index * 2 + 1}`;
      } else if (stage === "final") {
        const semiFinals = existing.get("semi_final") || [];
        const slots = [0, 1].map((slotIndex) => {
          const sf = semiFinals[slotIndex];
          return `Winner ${sf?.stageLabel || `SF${slotIndex + 1}`}`;
        });
        placeholders.push(placeholderFor(stage, slots.join(" vs "), slots));
        continue;
      }
      placeholders.push(placeholderFor(stage, sourceLabel));
    }
    return { stage, label, matches: [...cards, ...placeholders] };
  });

  const finalStage = stages.find((row) => row.stage === "final");
  const finalMatch = finalStage?.matches.find((row) => !row.placeholder && row.winner);
  const champion = finalMatch
    ? {
        _id: finalMatch.winner._id,
        name: finalMatch.winner.name || "",
        shortName: finalMatch.winner.shortName || "",
        logo: finalMatch.winner.logo || "",
      }
    : null;

  return {
    isKnockout: true,
    stages,
    champion,
  };
}

export default { buildTournamentBracket, normalizeBracketStage, BRACKET_STAGES };
