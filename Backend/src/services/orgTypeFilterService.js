// Shared orgType listing filters.
//
// One indexed lookup of matching organizations, then (where the collection has
// no organizationRef of its own) one indexed lookup of teams. No per-row joins,
// no denormalized backfill, and no change at all when the filter is absent.

import Team from "../models/Team.js";
import TeamOrganization from "../models/TeamOrganization.js";
import { orgTypesQuery, parseOrgTypeFilter } from "./organizationService.js";

const ORG_ID_LIMIT = 5000;

export function parseFilter(raw) {
  return parseOrgTypeFilter(raw);
}

export async function resolveOrgIds(values) {
  if (!values || values.length === 0) return null;
  const clause = orgTypesQuery(values);
  if (!clause) return [];
  const orgs = await TeamOrganization.find(clause)
    .select("_id")
    .limit(ORG_ID_LIMIT)
    .maxTimeMS(5000)
    .lean();
  return orgs.map((org) => org._id);
}

/** Players and matches reach the organization through their teams. */
export async function resolveTeamIds(values) {
  const orgIds = await resolveOrgIds(values);
  if (orgIds === null) return null;
  if (orgIds.length === 0) return [];
  const teams = await Team.find({ organizationRef: { $in: orgIds } })
    .select("_id")
    .limit(ORG_ID_LIMIT)
    .maxTimeMS(5000)
    .lean();
  return teams.map((team) => team._id);
}

/** Translate an invalid filter into a single controller response shape. */
export function invalidFilterResponse(res, error) {
  return res.status(error.status || 400).json({ message: error.message, code: error.code });
}
