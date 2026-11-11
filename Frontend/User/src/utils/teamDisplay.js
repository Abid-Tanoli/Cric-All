// Display helpers shared by the public screens. These never change stored team
// data; they only decide what to render when a short name was not set. Mirrors
// the Admin app helper so both apps label a team the same way.
export const teamInitials = (name = "") => {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  const initials = words.map((word) => word[0]).join("").toUpperCase();
  return initials || "T";
};

export const teamShortName = (team) => {
  const stored = String(team?.shortName || "").trim();
  if (stored) return stored;
  return teamInitials(team?.name);
};

export default { teamInitials, teamShortName };
