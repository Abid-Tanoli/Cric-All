// Pure presentation helpers for the tournament champion banner/card. The API
// already resolves the effective winner/runnerUp (stored value first, then a
// completed Final). These helpers only decide whether there is a decided
// champion to show, and which match is the Final. Nothing here writes data.

export const isTournamentCompleted = (tournament, overview = {}) =>
  String(overview?.status || tournament?.status || "").trim().toLowerCase() === "completed";

const teamRef = (ref) =>
  ref && typeof ref === "object" && String(ref.name || "").trim() ? ref : null;

export function tournamentChampion(tournament, overview = {}) {
  if (!isTournamentCompleted(tournament, overview)) return null;
  const winner = teamRef(tournament?.winner);
  if (!winner) return null;
  return { winner, runnerUp: teamRef(tournament?.runnerUp) };
}

export const teamId = (team) => team?._id || team?.id || null;

const isFinal = (match) => {
  const stage = String(match?.stage || "").trim().toLowerCase();
  const label = String(match?.stageLabel || "").trim().toLowerCase();
  return stage === "final" || label === "final" || /^final\b/i.test(String(match?.title || "").trim());
};

export function finalMatchOf(matches = []) {
  const finals = (Array.isArray(matches) ? matches : []).filter(
    (match) => match && !match.isDraft && !match.manualDraft && isFinal(match),
  );
  return (
    finals.find((match) => String(match.status || "").toLowerCase() === "completed") ||
    finals[0] ||
    null
  );
}

export default { isTournamentCompleted, tournamentChampion, teamId, finalMatchOf };
