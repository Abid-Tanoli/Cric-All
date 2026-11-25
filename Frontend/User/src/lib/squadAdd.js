// Pure helpers behind the team page's "Add players" panel.
//
// They live outside the component so the payload the form posts can be tested
// against the server's strict schema without rendering anything: what is sent
// here is exactly what `orgTeamAddPlayersSchema` receives.

const EMPTY_LOCATION_REFS = {
  countryId: null,
  provinceId: null,
  districtId: null,
  cityId: null,
  townId: null,
};

const EMPTY_LOCATION_LABELS = { country: "", province: "", district: "", city: "", town: "" };

export const EMPTY_SQUAD_PLAYER = {
  name: "",
  playingRole: "",
  battingStyle: "",
  bowlingStyle: "",
  jerseyNumber: "",
  imageUrl: "",
  locationRefs: { ...EMPTY_LOCATION_REFS },
  locationLabels: { ...EMPTY_LOCATION_LABELS },
};

/**
 * Turns the form state into the body for POST .../players.
 *
 * Empty optionals are omitted rather than sent as "" — the server's enums
 * reject an empty string for `playingRole`/`battingStyle`, and an empty number
 * input would become 0. LocationSelect always sends its full block, including
 * the null ids, and the schema accepts that unchanged.
 */
export function buildNewPlayerPayload(form = {}) {
  const payload = {
    name: String(form.name || "").trim(),
    locationRefs: { ...EMPTY_LOCATION_REFS, ...(form.locationRefs || {}) },
    locationLabels: { ...EMPTY_LOCATION_LABELS, ...(form.locationLabels || {}) },
  };
  if (!payload.name) return null;
  if (form.playingRole) payload.playingRole = form.playingRole;
  if (form.battingStyle) payload.battingStyle = form.battingStyle;
  if (form.bowlingStyle) payload.bowlingStyle = form.bowlingStyle;
  // The upload field returns a local /uploads path; anything else is dropped
  // client-side as well as rejected by the server's strict schema.
  if (typeof form.imageUrl === "string" && /^\/uploads\/[A-Za-z0-9._-]+$/.test(form.imageUrl)) {
    payload.imageUrl = form.imageUrl;
  }

  const jersey = String(form.jerseyNumber ?? "").trim();
  if (jersey !== "") {
    const value = Number(jersey);
    if (Number.isInteger(value) && value >= 0 && value <= 999) payload.jerseyNumber = value;
  }
  return payload;
}

/**
 * Splits a pasted list into one name per line, dropping blanks, trimming and
 * de-duplicating case-insensitively. Returns the preview the owner confirms
 * before anything is saved.
 */
export function parsePlayerNames(text = "") {
  const seen = new Set();
  const names = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const name = raw.replace(/\s+/g, " ").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

/** The body for the "Add several" request. */
export function buildBulkPlayersPayload(names = []) {
  return { newPlayers: names.map((name) => ({ name })) };
}

export default { EMPTY_SQUAD_PLAYER, buildNewPlayerPayload, parsePlayerNames, buildBulkPlayersPayload };
