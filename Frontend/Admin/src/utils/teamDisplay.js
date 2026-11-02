// Display helpers shared by the admin match screens. These never change stored
// team data; they only decide what to render when a short name was not set.
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

// Every Admin match time is shown in Pakistan time, regardless of the browser
// or the machine that runs the admin console.
export const PKT_TIME_ZONE = "Asia/Karachi";

export const formatMatchDate = (value, options = {}) => {
  if (!value) return "TBD";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "TBD";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: PKT_TIME_ZONE,
    ...options,
  });
};

export const formatMatchTime = (value) => {
  if (!value) return "TBD";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "TBD";
  return `${date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: PKT_TIME_ZONE,
  })} PKT`;
};
