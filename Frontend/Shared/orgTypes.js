// One frontend source of truth for organization types.
//
// The values and per-type fields mirror Backend/src/services/organizationService.js
// and docs/registration-redesign.md §2. Keeping labels, field metadata and badge
// copy here means the User forms, public pages and Admin queue cannot drift.

export const ORG_TYPES = Object.freeze([
  {
    value: "local_club",
    label: "Local club",
    icon: "🏏",
    description: "A community or neighbourhood cricket club.",
    fields: [],
  },
  {
    value: "registered_club",
    label: "Registered club",
    icon: "📜",
    description: "A formally registered club. Registration details can be reviewed for a Verified badge.",
    fields: [
      { key: "registrationNumber", label: "Registration number", hint: "Shown to platform admins only." },
      { key: "registrationAuthority", label: "Registration authority" },
      { key: "affiliation", label: "Affiliation (optional)" },
      { key: "foundedYear", label: "Founded year", type: "number", min: 1800 },
    ],
    verificationEligible: true,
  },
  {
    value: "school",
    label: "School",
    icon: "🏫",
    description: "A school cricket programme.",
    fields: [
      { key: "institutionName", label: "Institution name" },
      {
        key: "educationLevel",
        label: "Education level",
        type: "select",
        options: ["primary", "middle", "high"],
      },
      { key: "affiliationBoard", label: "Affiliation board" },
    ],
  },
  {
    value: "college",
    label: "College",
    icon: "🎓",
    description: "A college or intermediate college.",
    fields: [
      { key: "institutionName", label: "Institution name" },
      {
        key: "educationLevel",
        label: "Education level",
        type: "select",
        options: ["intermediate", "degree"],
      },
      { key: "affiliationUniversity", label: "Affiliating university" },
    ],
  },
  {
    value: "university",
    label: "University",
    icon: "🏛️",
    description: "A university or higher-education department.",
    fields: [
      { key: "institutionName", label: "Institution name" },
      { key: "department", label: "Department (optional)" },
      { key: "affiliationBody", label: "Affiliating body (optional)" },
    ],
  },
  {
    value: "company",
    label: "Industry / company",
    icon: "🏢",
    description: "A corporate or industry team.",
    fields: [
      { key: "companyName", label: "Company name" },
      { key: "industrySector", label: "Industry sector" },
    ],
  },
  {
    value: "foundation",
    label: "Foundation / NGO",
    icon: "🤝",
    description: "A foundation, trust or non-governmental organisation.",
    fields: [
      { key: "foundationName", label: "Foundation name" },
      { key: "registrationNumber", label: "Registration number (optional)", hint: "Shown to platform admins only." },
      { key: "focusArea", label: "Focus area" },
    ],
  },
  {
    value: "other",
    label: "Other",
    icon: "❓",
    description: "Something else — tell us what it is.",
    fields: [{ key: "typeNote", label: "What kind of organization is it?", type: "textarea" }],
  },
]);

export const ORG_TYPE_VALUES = ORG_TYPES.map((type) => type.value);

const BY_VALUE = new Map(ORG_TYPES.map((type) => [type.value, type]));

/** Legacy `type` slugs still written by older clients, mapped to the new enum. */
const LEGACY_TO_ORG_TYPE = Object.freeze({
  club: "local_club",
  local_club: "local_club",
  registered_club: "registered_club",
  school: "school",
  college: "college",
  university: "university",
  industry: "company",
  business: "company",
  corporate: "company",
  company: "company",
  ngo: "foundation",
  foundation: "foundation",
  other: "other",
});

export function normalizeOrgType(value) {
  const raw = String(value || "").trim().toLowerCase();
  return BY_VALUE.has(raw) ? raw : LEGACY_TO_ORG_TYPE[raw] || "other";
}

/** Resolves an orgType from an organization payload (new field wins). */
export function orgTypeOf(org) {
  if (!org) return "other";
  if (BY_VALUE.has(org.orgType)) return org.orgType;
  return normalizeOrgType(org.type);
}

export function orgTypeMeta(value) {
  // Callers pass either a raw enum/legacy slug or a whole organization object.
  // Resolving objects through orgTypeOf keeps `orgTypeLabel(org)` honest when a
  // legacy `type` and the new `orgType` disagree on the same payload.
  const resolved = value && typeof value === "object" ? orgTypeOf(value) : normalizeOrgType(value);
  return BY_VALUE.get(resolved) || BY_VALUE.get("other");
}

export function orgTypeLabel(value) {
  return orgTypeMeta(value).label;
}

/** Legacy slug written alongside orgType so older clients still understand it. */
const ORG_TYPE_TO_LEGACY = Object.freeze({
  local_club: "club",
  registered_club: "club",
  school: "school",
  college: "college",
  university: "university",
  company: "business",
  foundation: "ngo",
  other: "other",
});

export function legacyTypeForOrgType(value) {
  return ORG_TYPE_TO_LEGACY[normalizeOrgType(value)] || "other";
}

export function orgTypeIcon(value) {
  return orgTypeMeta(value).icon;
}

export function fieldsForOrgType(value) {
  return orgTypeMeta(value).fields || [];
}

/** Empty details object for the selected type. */
export function emptyTypeDetails(value) {
  return fieldsForOrgType(value).reduce((acc, field) => {
    acc[field.key] = "";
    return acc;
  }, {});
}

/** Drops fields belonging to a different type and trims what the API will store. */
export function serializeTypeDetails(value, details = {}) {
  const fields = fieldsForOrgType(value);
  const out = {};
  for (const field of fields) {
    const raw = details?.[field.key];
    if (raw === undefined || raw === null) continue;
    const text = String(raw).trim();
    if (text) out[field.key] = field.type === "number" ? Number(text) : text;
  }
  return out;
}

/** Badge copy shared by org settings, team cards and the Admin queue. */
export const VERIFICATION_BADGES = Object.freeze({
  verified: { label: "Verified", className: "border-emerald-300 bg-emerald-50 text-emerald-700" },
  pending: { label: "Pending review", className: "border-amber-300 bg-amber-50 text-amber-700" },
  rejected: { label: "Not verified", className: "border-red-300 bg-red-50 text-red-700" },
  unverified: { label: "Unverified", className: "border-cric-border bg-cric-bg text-cric-muted" },
});

export function verificationBadge(status) {
  const key = String(status || "unverified").toLowerCase();
  return VERIFICATION_BADGES[key] || VERIFICATION_BADGES.unverified;
}

export default {
  ORG_TYPES,
  ORG_TYPE_VALUES,
  normalizeOrgType,
  orgTypeOf,
  orgTypeMeta,
  orgTypeLabel,
  legacyTypeForOrgType,
  orgTypeIcon,
  fieldsForOrgType,
  emptyTypeDetails,
  serializeTypeDetails,
  VERIFICATION_BADGES,
  verificationBadge,
};
