/**
 * Fixture bootstrap for the E2E suite - entirely through the public HTTP API.
 *
 * Nothing here writes to MongoDB directly: the prohibition in the brief is that
 * results may not be inserted, and the cleanest way to honour that (and still
 * get a trustworthy result) is to build the world through the same endpoints a
 * real scorer uses. Every user, team, player, squad and fixture below comes
 * from an authenticated API call.
 *
 * Account shape mirrors the real product: an `organization_admin` owns the
 * tenant, a `player` account is invited as `score_handler` and accepts, and the
 * *scorer* is the one who sends every delivery in the scenarios. The owner is
 * deliberately never used to score.
 *
 * Email verification is exercised for real: the server runs the `console` mail
 * driver, so the verification and invitation links land in the server log and
 * are parsed back out of it. No token is ever stubbed.
 */

import { readFileSync, existsSync } from "node:fs";
import { sleep } from "./guard.js";

export const TEST_PREFIX = "OPENCODE_TEST_";
const LOG_PATH =
  process.env.E2E_BACKEND_LOG ||
  "C:\\Users\\ABIDTA~1\\AppData\\Local\\Temp\\opencode\\local-backend\\backend.log";

let logCursor = 0;

/**
 * Marks the current end of the log as the baseline. Called once at the start of
 * a run so that `readNewLog()` only ever returns output this run produced -
 * otherwise a fresh process reads the whole file and happily re-uses the
 * verification link of a previous run, which the server has already consumed.
 */
function syncLogCursor() {
  try {
    logCursor = existsSync(LOG_PATH) ? readFileSync(LOG_PATH, "utf8").length : 0;
  } catch {
    logCursor = 0;
  }
  return logCursor;
}

/** Reads whatever the server appended to its log since the last call. */
function readNewLog() {
  if (!existsSync(LOG_PATH)) return "";
  let full;
  try {
    full = readFileSync(LOG_PATH, "utf8");
  } catch {
    return "";
  }
  const fresh = full.slice(logCursor);
  logCursor = full.length;
  return fresh;
}

/**
 * The console mail driver writes the raw link into a pino `msg` field, so the
 * token appears verbatim even though the surrounding newlines are escaped.
 *
 * Link shapes, both produced by `frontendUrl`:
 *   verify     : {frontendUrl}/verify-email/{token}
 *   invitation : {frontendUrl}/organization/invitations/{token}
 */
function extractToken(text, kind) {
  const seg = kind === "verify" ? "verify-email" : "organization/invitations";
  const re = new RegExp(`${seg}\\/([A-Za-z0-9_-]{16,128})`);
  const m = text.match(re);
  return m ? m[1] : null;
}

async function waitForToken(kind, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const token = extractToken(readNewLog(), kind);
    if (token) return token;
    await sleep(250);
  }
  throw new Error(
    `Timed out waiting for a ${kind} token in ${LOG_PATH}. ` +
      `Is MAIL_DRIVER=console set on the local server?`,
  );
}

/**
 * Registers one account, pulls its verification link out of the server log,
 * verifies it, then logs in. Returns the account *and* its own authenticated
 * client, so no two accounts can ever share a token.
 */
async function registerVerifiedUser(makeClient, { name, email, password, accountType, organizationName }) {
  const api = makeClient();

  await api.post(
    "/auth/register",
    {
      name: `${TEST_PREFIX}${name}`,
      email,
      password,
      accountType,
      ...(accountType === "organization_admin"
        ? { organizationCategory: "Club", organizationName: `${TEST_PREFIX}${organizationName}` }
        : {}),
    },
    { expect: [200, 201] },
  );

  const verifyToken = await waitForToken("verify");
  await api.post("/auth/verify-email", { token: verifyToken }, { expect: [200] });

  const login = await api.post("/auth/login", { email, password }, { expect: [200] });
  const token = login.body?.token;
  if (!token) throw new Error(`Login for ${email} returned no token`);
  api.setToken(token);

  const profile = await api.get("/auth/profile", { expect: [200] });
  const user = profile.body?.user || profile.body;
  if (user?.emailVerified === false || user?.isEmailVerified === false) {
    throw new Error(`Account ${email} is still unverified after the console-mail link`);
  }

  return {
    label: name,
    name: `${TEST_PREFIX}${name}`,
    email,
    password,
    token,
    api,
    userId: String(user?._id || ""),
    accountType,
  };
}

async function makePlayers(api, teamLabel, count) {
  const roles = ["Batsman", "Bowler", "All-Rounder", "Wicket-Keeper"];
  const players = [];
  for (let i = 1; i <= count; i += 1) {
    const res = await api.post(
      "/players",
      {
        name: `${TEST_PREFIX}${teamLabel}_P${String(i).padStart(2, "0")}`,
        playingRole: roles[i % roles.length],
        battingStyle: i % 2 === 0 ? "Right-handed" : "Left-handed",
      },
      { expect: [200, 201] },
    );
    const p = res.body?.player || res.body;
    players.push({ id: String(p._id), name: p.name });
  }
  return players;
}

export async function bootstrap({ makeClient, runId }) {
  process.stdout.write(`\n--- bootstrap (run ${runId}) ---\n`);
  syncLogCursor();

  const owner = await registerVerifiedUser(makeClient, {
    name: "owner",
    email: `${TEST_PREFIX}owner_${runId}@example.test`,
    password: "OpencodeLocal!2026",
    accountType: "organization_admin",
    organizationName: "Org",
  });
  process.stdout.write(`  owner    : ${owner.email} (verified via console mail)\n`);

  const scorer = await registerVerifiedUser(makeClient, {
    name: "scorer",
    email: `${TEST_PREFIX}scorer_${runId}@example.test`,
    password: "OpencodeLocal!2026",
    accountType: "player",
  });
  process.stdout.write(`  scorer   : ${scorer.email} (verified via console mail)\n`);

  // A second, unrelated tenant. Used only by the negative tests: the scorer of
  // org A must be refused by a match belonging to org B.
  const outsider = await registerVerifiedUser(makeClient, {
    name: "outsider",
    email: `${TEST_PREFIX}outsider_${runId}@example.test`,
    password: "OpencodeLocal!2026",
    accountType: "organization_admin",
    organizationName: "OtherOrg",
  });

  // --- organization ------------------------------------------------------
  const orgRes = await owner.api.post(
    "/organizations",
    { name: `${TEST_PREFIX}Org_${runId}`, type: "club", shortName: "OTST" },
    { expect: [200, 201] },
  );
  const orgId = String(orgRes.body?.organization?._id || orgRes.body?._id);
  if (!orgId) throw new Error(`Organization creation returned no id: ${JSON.stringify(orgRes.body)}`);
  process.stdout.write(`  org      : ${orgId}\n`);

  const otherOrgRes = await outsider.api.post(
    "/organizations",
    { name: `${TEST_PREFIX}Other_${runId}`, type: "club", shortName: "OOTH" },
    { expect: [200, 201] },
  );
  const otherOrgId = String(otherOrgRes.body?.organization?._id || otherOrgRes.body?._id);

  // --- invite the scorer as score_handler --------------------------------
  const inviteRes = await owner.api.post(
    `/organizations/${orgId}/invitations`,
    { email: scorer.email, roles: ["score_handler"], message: "E2E scorer" },
    { expect: [200, 201] },
  );
  const invitationId = String(inviteRes.body?.invitation?._id || inviteRes.body?._id || "");

  const inviteToken = await waitForToken("invitation");
  const accept = await scorer.api.post("/invitations/accept", { token: inviteToken }, { expect: [200] });
  const acceptedRoles = accept.body?.member?.roles || accept.body?.roles || [];
  if (!acceptedRoles.includes("score_handler")) {
    throw new Error(`Invitation did not grant score_handler; got ${JSON.stringify(acceptedRoles)}`);
  }
  process.stdout.write(`  scorer accepted invitation with roles: ${acceptedRoles.join(", ")}\n`);

  // --- teams + players ----------------------------------------------------
  const teamARes = await owner.api.post(
    `/organizations/${orgId}/teams`,
    { name: `${TEST_PREFIX}Alpha_${runId}` },
    { expect: [200, 201] },
  );
  const teamBRes = await owner.api.post(
    `/organizations/${orgId}/teams`,
    { name: `${TEST_PREFIX}Beta_${runId}` },
    { expect: [200, 201] },
  );
  const teamAId = String(teamARes.body?.team?._id || teamARes.body?._id);
  const teamBId = String(teamBRes.body?.team?._id || teamBRes.body?._id);

  const squadA = await makePlayers(owner.api, "A", 12);
  const squadB = await makePlayers(owner.api, "B", 12);
  await owner.api.post(`/organizations/${orgId}/teams/${teamAId}/players`, { playerIds: squadA.map((p) => p.id) }, { expect: [200] });
  await owner.api.post(`/organizations/${orgId}/teams/${teamBId}/players`, { playerIds: squadB.map((p) => p.id) }, { expect: [200] });
  process.stdout.write(`  teams    : ${teamAId} / ${teamBId} (12 players each)\n`);

  // --- the second tenant gets its own teams ------------------------------
  // Needed so the cross-tenant negative test scores against a match that really
  // belongs to somebody else, rather than a second fixture in the same org.
  const otherTeamARes = await outsider.api.post(
    `/organizations/${otherOrgId}/teams`,
    { name: `${TEST_PREFIX}OtherAlpha_${runId}` },
    { expect: [200, 201] },
  );
  const otherTeamBRes = await outsider.api.post(
    `/organizations/${otherOrgId}/teams`,
    { name: `${TEST_PREFIX}OtherBeta_${runId}` },
    { expect: [200, 201] },
  );
  const otherTeamAId = String(otherTeamARes.body?.team?._id || otherTeamARes.body?._id);
  const otherTeamBId = String(otherTeamBRes.body?.team?._id || otherTeamBRes.body?._id);
  const otherSquadA = await makePlayers(outsider.api, "OA", 12);
  const otherSquadB = await makePlayers(outsider.api, "OB", 12);
  await outsider.api.post(`/organizations/${otherOrgId}/teams/${otherTeamAId}/players`, { playerIds: otherSquadA.map((p) => p.id) }, { expect: [200] });
  await outsider.api.post(`/organizations/${otherOrgId}/teams/${otherTeamBId}/players`, { playerIds: otherSquadB.map((p) => p.id) }, { expect: [200] });
  process.stdout.write(`  tenant B : ${otherOrgId} with teams ${otherTeamAId} / ${otherTeamBId}\n`);

  return {
    runId,
    owner,
    scorer,
    outsider,
    orgId,
    otherOrgId,
    invitationId,
    acceptedRoles,
    makeClient,
    teams: {
      a: { id: teamAId, name: `${TEST_PREFIX}Alpha_${runId}`, players: squadA, xi: squadA.slice(0, 11) },
      b: { id: teamBId, name: `${TEST_PREFIX}Beta_${runId}`, players: squadB, xi: squadB.slice(0, 11) },
    },
    otherTeams: {
      a: { id: otherTeamAId, name: `${TEST_PREFIX}OtherAlpha_${runId}`, players: otherSquadA, xi: otherSquadA.slice(0, 11) },
      b: { id: otherTeamBId, name: `${TEST_PREFIX}OtherBeta_${runId}`, players: otherSquadB, xi: otherSquadB.slice(0, 11) },
    },
  };
}

/** Creates a fixture inside tenant B, owned by the `outsider` account. */
export async function createMatchInOtherOrg({ ctx, matchType = "T20", title = "tenantB" }) {
  const res = await ctx.outsider.api.post(
    `/organizations/${ctx.otherOrgId}/matches`,
    {
      title: `${TEST_PREFIX}${title}_${ctx.runId}`,
      venue: "Other Tenant Ground",
      matchType,
      teams: [ctx.otherTeams.a.id, ctx.otherTeams.b.id],
    },
    { expect: [200, 201] },
  );
  const matchId = String(res.body?.match?._id || res.body?._id);
  if (!matchId) throw new Error(`Tenant B match creation returned no id: ${JSON.stringify(res.body)}`);

  await ctx.outsider.api.put(
    `/organizations/${ctx.otherOrgId}/matches/${matchId}/squads`,
    {
      squads: [
        { team: ctx.otherTeams.a.id, players: ctx.otherTeams.a.xi.map((p) => p.id), captain: ctx.otherTeams.a.xi[0].id },
        { team: ctx.otherTeams.b.id, players: ctx.otherTeams.b.xi.map((p) => p.id), captain: ctx.otherTeams.b.xi[0].id },
      ],
    },
    { expect: [200] },
  );
  process.stdout.write(`  match B  : ${matchId} (tenant B, ${matchType})\n`);
  return { matchId, matchType };
}

/**
 * Creates a fixture with a full XI on both sides. `matchType` defaults to T20;
 * the other formats in the `Match.matchType` enum are exercised by
 * `assessFormats()` in the runner.
 */
export async function createMatch({ ctx, matchType = "T20", title = "fixture" }) {
  const res = await ctx.owner.api.post(
    `/organizations/${ctx.orgId}/matches`,
    {
      title: `${TEST_PREFIX}${title}_${ctx.runId}_${matchType.replace(/\s+/g, "")}`,
      venue: "Local Test Ground",
      matchType,
      teams: [ctx.teams.a.id, ctx.teams.b.id],
    },
    { expect: [200, 201] },
  );
  const matchId = String(res.body?.match?._id || res.body?._id);
  if (!matchId) throw new Error(`Match creation returned no id: ${JSON.stringify(res.body)}`);

  await ctx.owner.api.put(
    `/organizations/${ctx.orgId}/matches/${matchId}/squads`,
    {
      squads: [
        { team: ctx.teams.a.id, players: ctx.teams.a.xi.map((p) => p.id), captain: ctx.teams.a.xi[0].id, wicketKeepers: [ctx.teams.a.xi[1].id] },
        { team: ctx.teams.b.id, players: ctx.teams.b.xi.map((p) => p.id), captain: ctx.teams.b.xi[0].id, wicketKeepers: [ctx.teams.b.xi[1].id] },
      ],
    },
    { expect: [200] },
  );

  process.stdout.write(`  match    : ${matchId} (${matchType})\n`);
  return { matchId, matchType };
}

/** Fetches the authoritative server-side innings used for the comparison. */
export async function fetchMatch(api, matchId) {
  const res = await api.get(`/matches/${matchId}`, { expect: [200] });
  return res.body?.match || res.body;
}
