// Pure bracket shaping for the public knockout view. Kept free of React so it
// can be unit-tested without rendering (see knockoutBracket.test.js).

export const STAGE_ORDER = ["quarter_final", "semi_final", "final", "third_place"];

export const STAGE_HEADINGS = {
  quarter_final: "Quarter-finals",
  semi_final: "Semi-finals",
  final: "Final",
  third_place: "Third-place",
};

const idOf = (value) => (value && typeof value === "object" ? value._id : value);
const nameOf = (team) => team?.name || team?.shortName || "TBD";

export const stageOf = (match) => {
  const stage = match?.stage;
  return STAGE_ORDER.includes(stage) ? stage : "";
};

/**
 * Expected number of slots per stage, inferred from the shallowest stage that
 * actually has fixtures. An 8-team bracket (quarter-finals) has 4 QFs, 2 SFs
 * and 1 final; a 4-team bracket starts at the semi-finals.
 */
export const expectedSlots = (matches = []) => {
  const has = (stage) => matches.some((m) => stageOf(m) === stage);
  if (has("quarter_final")) return { quarter_final: 4, semi_final: 2, final: 1 };
  if (has("semi_final")) return { quarter_final: 0, semi_final: 2, final: 1 };
  if (has("final")) return { quarter_final: 0, semi_final: 0, final: 1 };
  return { quarter_final: 0, semi_final: 0, final: 0 };
};

const sortKey = (match) => {
  const label = String(match?.stageLabel || "");
  const digits = label.match(/\d+/);
  if (digits) return Number(digits[0]);
  return Number(match?.matchNumber) || 0;
};

/**
 * Shape the knockout matches into bracket columns. Always returns the three
 * standard columns (quarter-finals, semi-finals, final) so an undrawn bracket
 * still reads as a bracket, with `null` slots rendered as "To be decided".
 * A third-place play-off column is appended only when one exists.
 */
export function buildKnockoutBracket(matches = []) {
  const list = Array.isArray(matches) ? matches.filter(Boolean) : [];
  const expected = expectedSlots(list);
  const columns = [];

  for (const stage of STAGE_ORDER) {
    const stageMatches = list
      .filter((m) => stageOf(m) === stage)
      .sort((a, b) => sortKey(a) - sortKey(b));

    if (stage === "third_place" && stageMatches.length === 0) continue;

    const slots = stage === "third_place"
      ? stageMatches.length
      : Math.max(expected[stage] || 0, stageMatches.length, 1);

    columns.push({
      stage,
      heading: STAGE_HEADINGS[stage],
      slots: Array.from({ length: slots }, (_, i) => stageMatches[i] || null),
    });
  }

  return columns;
}

export const slotTeams = (match) => {
  const teams = Array.isArray(match?.teams) ? match.teams : [];
  return [
    { id: String(idOf(teams[0]) || ""), name: nameOf(teams[0]) },
    { id: String(idOf(teams[1]) || ""), name: nameOf(teams[1]) },
  ];
};

export const winnerIdOf = (match) => String(idOf(match?.result?.winner) || "");
