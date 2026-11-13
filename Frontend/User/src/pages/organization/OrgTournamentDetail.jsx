import React, { useCallback, useEffect, useMemo, useState } from "react";
import RequestDeletionButton from "../../components/RequestDeletionButton";
import {
  FIXTURE_FORMATS,
  FIXTURE_STAGES,
  competitionErrorMessage,
  groupFixtures,
  idOf,
  uniqueIds,
} from "../../lib/orgCompetitions";
import { PERMISSIONS, can, formatDate, formatDateTime } from "../../lib/orgUi";
import {
  addOrgTournamentTeams,
  applyOrgTournamentFixtures,
  createOrgTournamentMatch,
  getOrgTournament,
  getOrgTournamentFixtures,
  getOrgTournamentSquad,
  getTeamRoster,
  listPublicTeams,
  previewOrgTournamentFixtures,
  recomputeOrgTournamentPoints,
  removeOrgTournamentTeam,
  setOrgTournamentAwards,
  setOrgTournamentGroups,
  setOrgTournamentOfficialAwards,
  setOrgTournamentSquad,
  updateOrgTournament,
} from "../../services/organizationApi";
import { TeamPicker, TournamentForm } from "./CompetitionForms";
import { MatchSetup } from "./OrgMatches";
import {
  Banner,
  Field,
  Stat,
  card,
  cardSubtle,
  eyebrow,
  input,
  primaryButton,
  secondaryButton,
  sectionTitle,
} from "./orgStyles";

const TABS = [
  ["overview", "Overview"],
  ["teams", "Teams"],
  ["groups", "Groups"],
  ["fixtures", "Fixtures"],
  ["squads", "Squads"],
  ["points", "Points"],
  ["awards", "Awards"],
];

const teamName = (team) => team?.name || team?.shortName || "TBD";
const playerName = (player) => player?.name || "Unnamed player";

const asArray = (value) => (Array.isArray(value) ? value : value?.items || []);

export default function OrgTournamentDetail({ orgId, tournamentId, access, ownTeams = [], onClose, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [fixtures, setFixtures] = useState([]);
  const [squads, setSquads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState(null);
  const [tab, setTab] = useState("overview");

  const permissions = access?.permissions || [];
  const canManage = can(permissions, PERMISSIONS.MANAGE_COMPETITIONS);
  const canFixture = can(permissions, PERMISSIONS.CREATE_MATCH);

  // Own teams plus any guest teams already entered, without duplicate chips.
  const availableTeams = useMemo(() => {
    const map = new Map();
    for (const team of [...(ownTeams || []), ...(detail?.teams || [])]) {
      map.set(idOf(team), team);
    }
    return [...map.values()];
  }, [ownTeams, detail?.teams]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const [nextDetail, nextFixtures, nextSquads] = await Promise.all([
        getOrgTournament(orgId, tournamentId),
        getOrgTournamentFixtures(orgId, tournamentId),
        getOrgTournamentSquad(orgId, tournamentId),
      ]);
      setDetail(nextDetail);
      setFixtures(asArray(nextFixtures));
      setSquads(asArray(nextSquads));
    } catch (error) {
      setErr(competitionErrorMessage(error, "Could not load the tournament."));
    } finally {
      setLoading(false);
    }
  }, [orgId, tournamentId]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = () => {
    load();
    onChanged?.();
  };

  if (loading && !detail) {
    return (
      <div className={card}>
        <p className="text-sm font-semibold text-cric-muted">Loading tournament…</p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className={card}>
        <Banner kind="error">{err || "That tournament was not found in this organization."}</Banner>
        <button type="button" onClick={onClose} className={`${secondaryButton} mt-4`}>
          Back to competitions
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={eyebrow}>Tournament management</p>
            <h2 className="mt-1 text-xl font-black uppercase tracking-tight">{detail.name}</h2>
            <p className="mt-1 text-xs font-semibold text-cric-muted">
              {detail.type} · {detail.format}
              {detail.venue ? ` · ${detail.venue}` : ""} · {detail.status}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canManage ? <RequestDeletionButton /> : null}
            <button type="button" onClick={onClose} className={secondaryButton}>
              Close
            </button>
          </div>
        </div>
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setTab(id);
                setErr("");
              }}
              className={`shrink-0 rounded-lg px-4 py-2 text-[10px] font-black uppercase tracking-widest transition ${
                tab === id
                  ? "bg-cric-accent text-white"
                  : "border border-cric-border bg-cric-bg text-cric-muted hover:text-cric-text"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {err ? <Banner kind="error">{err}</Banner> : null}
      {notice ? <Banner kind={notice.kind}>{notice.text}</Banner> : null}

      {tab === "overview" ? (
        <OverviewTab
          orgId={orgId}
          detail={detail}
          canManage={canManage}
          availableTeams={availableTeams}
          onSaved={(message) => {
            setNotice({ kind: "success", text: message });
            refresh();
          }}
          onError={setErr}
        />
      ) : null}

      {tab === "teams" ? (
        <TeamsTab
          orgId={orgId}
          tournamentId={tournamentId}
          detail={detail}
          ownTeams={ownTeams}
          canManage={canManage}
          onSaved={(message) => {
            setNotice({ kind: "success", text: message });
            refresh();
          }}
          onError={setErr}
        />
      ) : null}

      {tab === "groups" ? (
        <GroupsTab
          orgId={orgId}
          tournamentId={tournamentId}
          detail={detail}
          canManage={canManage}
          onSaved={(message) => {
            setNotice({ kind: "success", text: message });
            refresh();
          }}
          onError={setErr}
        />
      ) : null}

      {tab === "fixtures" ? (
        <FixturesTab
          orgId={orgId}
          tournamentId={tournamentId}
          detail={detail}
          fixtures={fixtures}
          canManage={canManage}
          canFixture={canFixture}
          onSaved={(message) => {
            setNotice({ kind: "success", text: message });
            refresh();
          }}
          onError={setErr}
        />
      ) : null}

      {tab === "squads" ? (
        <SquadsTab
          orgId={orgId}
          tournamentId={tournamentId}
          detail={detail}
          squads={squads}
          canFixture={canFixture}
          onSaved={(message) => {
            setNotice({ kind: "success", text: message });
            refresh();
          }}
          onError={setErr}
        />
      ) : null}

      {tab === "points" ? (
        <PointsTab
          orgId={orgId}
          tournamentId={tournamentId}
          detail={detail}
          canManage={canManage}
          onSaved={(message) => {
            setNotice({ kind: "success", text: message });
            refresh();
          }}
          onError={setErr}
        />
      ) : null}

      {tab === "awards" ? (
        <AwardsTab
          orgId={orgId}
          tournamentId={tournamentId}
          detail={detail}
          squads={squads}
          canManage={canManage}
          onSaved={(message) => {
            setNotice({ kind: "success", text: message });
            refresh();
          }}
          onError={setErr}
        />
      ) : null}
    </div>
  );
}

function OverviewTab({ orgId, detail, canManage, availableTeams, onSaved, onError }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [content, setContent] = useState(() => ({
    bannerImage: detail.content?.bannerImage || "",
    shortDescription: detail.content?.shortDescription || "",
    city: detail.content?.city || "",
    visibility: {
      photos: detail.content?.visibility?.photos !== false,
      videos: detail.content?.visibility?.videos !== false,
      articles: detail.content?.visibility?.articles !== false,
      stats: detail.content?.visibility?.stats !== false,
      table: detail.content?.visibility?.table !== false,
      teams: detail.content?.visibility?.teams !== false,
    },
    stats: {
      minBallsFaced: detail.content?.stats?.minBallsFaced ?? 30,
      minOvers: detail.content?.stats?.minOvers ?? 5,
    },
  }));

  const setStatus = async (status) => {
    setBusy(true);
    onError("");
    try {
      await updateOrgTournament(orgId, detail._id, { status });
      onSaved(`Tournament marked ${status}.`);
    } catch (error) {
      onError(competitionErrorMessage(error, "Could not change the status."));
    } finally {
      setBusy(false);
    }
  };

  const saveContent = async (event) => {
    event.preventDefault();
    setBusy(true);
    onError("");
    try {
      await updateOrgTournament(orgId, detail._id, {
        content: {
          ...content,
          stats: {
            minBallsFaced: Number(content.stats.minBallsFaced) || 0,
            minOvers: Number(content.stats.minOvers) || 0,
          },
        },
      });
      onSaved("Tournament content saved.");
    } catch (error) {
      onError(competitionErrorMessage(error, "Could not save the content settings."));
    } finally {
      setBusy(false);
    }
  };

  const toggleVisibility = (key) =>
    setContent((prev) => ({
      ...prev,
      visibility: { ...prev.visibility, [key]: !prev.visibility[key] },
    }));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Status" value={detail.status} />
        <Stat label="Teams" value={(detail.teams || []).length} />
        <Stat label="Fixtures" value={(detail.matches || []).length} />
        <Stat label="Window" value={`${formatDate(detail.startDate)} – ${formatDate(detail.endDate)}`} />
      </div>

      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className={eyebrow}>Basics</p>
            <h3 className={sectionTitle}>Tournament details</h3>
            <p className="mt-1 text-xs font-semibold text-cric-muted">
              {detail.shortName || detail.name} · {detail.type} · {detail.format}
              {detail.rules?.twelfthManEnabled ? " · 12th Man enabled" : ""}
            </p>
          </div>
          {canManage ? (
            <button type="button" onClick={() => setEditing((value) => !value)} className={secondaryButton}>
              {editing ? "Close edit" : "Edit tournament"}
            </button>
          ) : null}
        </div>
        {editing && canManage ? (
          <div className="mt-4">
            <TournamentForm
              initial={detail}
              availableTeams={availableTeams}
              onSave={async (payload) => {
                await updateOrgTournament(orgId, detail._id, payload);
                setEditing(false);
                onSaved("Tournament updated.");
              }}
              onCancel={() => setEditing(false)}
            />
          </div>
        ) : null}
        {canManage ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {["upcoming", "live", "completed"].map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setStatus(status)}
                disabled={busy || detail.status === status}
                className={detail.status === status ? primaryButton : secondaryButton}
              >
                {status}
              </button>
            ))}
          </div>
        ) : (
          <Banner kind="info">
            You can view this tournament, but only an owner or admin can change its settings.
          </Banner>
        )}
      </div>

      {canManage ? (
        <form onSubmit={saveContent} className={card}>
          <p className={eyebrow}>Public hub</p>
          <h3 className={`${sectionTitle} mt-1`}>Content & visibility</h3>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Banner image URL">
              <input
                value={content.bannerImage}
                onChange={(event) => setContent((prev) => ({ ...prev, bannerImage: event.target.value }))}
                className={input}
                maxLength={500}
              />
            </Field>
            <Field label="City">
              <input
                value={content.city}
                onChange={(event) => setContent((prev) => ({ ...prev, city: event.target.value }))}
                className={input}
                maxLength={120}
              />
            </Field>
            <Field label="Short description">
              <textarea
                value={content.shortDescription}
                onChange={(event) =>
                  setContent((prev) => ({ ...prev, shortDescription: event.target.value }))
                }
                rows={3}
                className={input}
                maxLength={1000}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Min balls faced">
                <input
                  type="number"
                  min={0}
                  value={content.stats.minBallsFaced}
                  onChange={(event) =>
                    setContent((prev) => ({
                      ...prev,
                      stats: { ...prev.stats, minBallsFaced: event.target.value },
                    }))
                  }
                  className={input}
                />
              </Field>
              <Field label="Min overs">
                <input
                  type="number"
                  min={0}
                  value={content.stats.minOvers}
                  onChange={(event) =>
                    setContent((prev) => ({
                      ...prev,
                      stats: { ...prev.stats, minOvers: event.target.value },
                    }))
                  }
                  className={input}
                />
              </Field>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            {Object.keys(content.visibility).map((key) => (
              <label key={key} className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-cric-muted">
                <input
                  type="checkbox"
                  checked={content.visibility[key]}
                  onChange={() => toggleVisibility(key)}
                />
                {key}
              </label>
            ))}
          </div>
          <button type="submit" disabled={busy} className={`${primaryButton} mt-4`}>
            {busy ? "Saving…" : "Save content"}
          </button>
        </form>
      ) : null}
    </div>
  );
}

function TeamsTab({ orgId, tournamentId, detail, ownTeams, canManage, onSaved, onError }) {
  const [guestQuery, setGuestQuery] = useState("");
  const [guestResults, setGuestResults] = useState([]);
  const [guestBusy, setGuestBusy] = useState(false);
  const [busy, setBusy] = useState(false);

  const selectedIds = uniqueIds(detail.teams || []);

  const searchGuest = async (event) => {
    event.preventDefault();
    const query = guestQuery.trim();
    if (!query) return;
    setGuestBusy(true);
    onError("");
    try {
      const results = asArray(await listPublicTeams({ search: query, limit: 20 }));
      setGuestResults(results.filter((team) => !selectedIds.includes(idOf(team))));
    } catch (error) {
      onError(competitionErrorMessage(error, "Could not search for teams."));
    } finally {
      setGuestBusy(false);
    }
  };

  const addTeam = async (teamId) => {
    setBusy(true);
    onError("");
    try {
      await addOrgTournamentTeams(orgId, tournamentId, [teamId]);
      setGuestResults((prev) => prev.filter((team) => idOf(team) !== teamId));
      onSaved("Team added to the tournament.");
    } catch (error) {
      onError(competitionErrorMessage(error, "Could not add that team."));
    } finally {
      setBusy(false);
    }
  };

  const removeTeam = async (team) => {
    if (!window.confirm(`Remove ${teamName(team)} from this tournament?`)) return;
    setBusy(true);
    onError("");
    try {
      await removeOrgTournamentTeam(orgId, tournamentId, idOf(team));
      onSaved("Team removed from the tournament.");
    } catch (error) {
      onError(competitionErrorMessage(error, "Could not remove that team."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className={card}>
        <p className={eyebrow}>Entered teams</p>
        <h3 className={`${sectionTitle} mt-1`}>Teams ({(detail.teams || []).length})</h3>
        {(detail.teams || []).length === 0 ? (
          <p className="mt-3 text-xs font-semibold text-cric-muted">No teams entered yet.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {detail.teams.map((team) => (
              <div key={idOf(team)} className={`${cardSubtle} flex flex-wrap items-center justify-between gap-2`}>
                <span className="text-sm font-black uppercase tracking-wide">{teamName(team)}</span>
                {canManage ? (
                  <button type="button" onClick={() => removeTeam(team)} disabled={busy} className={secondaryButton}>
                    Remove
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {canManage ? (
        <div className={card}>
          <p className={eyebrow}>Add a team</p>
          <h3 className={`${sectionTitle} mt-1`}>Own teams</h3>
          <div className="mt-3">
            <TeamPicker
              teams={(ownTeams || []).filter((team) => !selectedIds.includes(idOf(team)))}
              selected={[]}
              onToggle={addTeam}
              disabled={busy}
              emptyHint="All of your own teams are already entered."
            />
          </div>

          <h3 className={`${sectionTitle} mt-6`}>Invited guest teams</h3>
          <p className="mt-1 text-xs font-semibold text-cric-muted">
            Search the public team catalogue and enter another club&apos;s side as a guest.
          </p>
          <form onSubmit={searchGuest} className="mt-3 flex flex-wrap gap-2">
            <input
              value={guestQuery}
              onChange={(event) => setGuestQuery(event.target.value)}
              placeholder="Search teams…"
              className={`${input} max-w-sm`}
            />
            <button type="submit" disabled={guestBusy} className={secondaryButton}>
              {guestBusy ? "Searching…" : "Search"}
            </button>
          </form>
          {guestResults.length ? (
            <div className="mt-3">
              <TeamPicker
                teams={guestResults.filter((team) => !selectedIds.includes(idOf(team)))}
                selected={[]}
                onToggle={addTeam}
                disabled={busy}
              />
            </div>
          ) : null}
          <p className="mt-3 text-[10px] font-bold uppercase tracking-widest text-cric-muted">
            Guest teams keep their own roster; the host organization runs the competition.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function GroupsTab({ orgId, tournamentId, detail, canManage, onSaved, onError }) {
  const [groupAssign, setGroupAssign] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const assigns = {};
    for (const group of detail.groups || []) {
      for (const team of group.teams || []) assigns[idOf(team)] = group.name;
    }
    setGroupAssign(assigns);
  }, [detail]);

  const saveGroups = async () => {
    const byName = {};
    for (const [teamId, name] of Object.entries(groupAssign)) {
      const key = String(name || "").trim();
      if (!key) continue;
      byName[key] = byName[key] || [];
      byName[key].push(teamId);
    }
    const groups = Object.entries(byName).map(([name, teams]) => ({ name, teams }));
    if (!groups.length) {
      onError("Assign at least one team to a group.");
      return;
    }
    setBusy(true);
    onError("");
    try {
      await setOrgTournamentGroups(orgId, tournamentId, groups);
      onSaved("Groups saved.");
    } catch (error) {
      onError(competitionErrorMessage(error, "Could not save the groups."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={card}>
      <p className={eyebrow}>Draw</p>
      <h3 className={`${sectionTitle} mt-1`}>Groups</h3>
      <p className="mt-1 text-xs font-semibold text-cric-muted">
        Type a group name (A, B, …) next to each team. Every group needs at least two teams.
      </p>
      <div className="mt-4 space-y-2">
        {(detail.teams || []).map((team) => (
          <div key={idOf(team)} className="flex items-center gap-3">
            <span className="min-w-0 flex-1 truncate text-xs font-black uppercase tracking-wide">
              {teamName(team)}
            </span>
            <input
              value={groupAssign[idOf(team)] || ""}
              onChange={(event) =>
                setGroupAssign((prev) => ({ ...prev, [idOf(team)]: event.target.value }))
              }
              placeholder="Group"
              disabled={!canManage}
              className={`${input} max-w-[120px]`}
              maxLength={20}
            />
          </div>
        ))}
      </div>
      {canManage ? (
        <button type="button" onClick={saveGroups} disabled={busy} className={`${primaryButton} mt-4`}>
          {busy ? "Saving…" : "Save groups"}
        </button>
      ) : null}
    </div>
  );
}

function FixturesTab({ orgId, tournamentId, detail, fixtures, canManage, canFixture, onSaved, onError }) {
  const [options, setOptions] = useState({ format: "round-robin", startAt: "", gapHours: 2, venue: "" });
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [setupFor, setSetupFor] = useState(null);
  const [manual, setManual] = useState({
    team1: "",
    team2: "",
    startTime: "",
    round: "",
    group: "",
    stage: "",
    stageLabel: "",
  });

  const grouped = useMemo(() => groupFixtures(fixtures), [fixtures]);

  const previewFixtures = async () => {
    setBusy(true);
    onError("");
    try {
      const response = await previewOrgTournamentFixtures(orgId, tournamentId, {
        ...options,
        gapHours: Number(options.gapHours) || 2,
      });
      setPreview(response?.preview || null);
      onSaved("Fixture preview ready.");
    } catch (error) {
      onError(competitionErrorMessage(error, "Could not preview the fixtures."));
    } finally {
      setBusy(false);
    }
  };

  const applyFixtures = async () => {
    if (!window.confirm("Apply these fixtures? Existing pairings are skipped and completed matches are never touched.")) {
      return;
    }
    setBusy(true);
    onError("");
    try {
      const response = await applyOrgTournamentFixtures(orgId, tournamentId, {
        ...options,
        gapHours: Number(options.gapHours) || 2,
      });
      setPreview(null);
      onSaved(response?.message || "Fixtures applied.");
    } catch (error) {
      onError(competitionErrorMessage(error, "Could not apply the fixtures."));
    } finally {
      setBusy(false);
    }
  };

  const addManualFixture = async (event) => {
    event.preventDefault();
    if (!manual.team1 || !manual.team2 || manual.team1 === manual.team2) {
      onError("Pick two different teams for the fixture.");
      return;
    }
    setBusy(true);
    onError("");
    try {
      const payload = {
        team1: manual.team1,
        team2: manual.team2,
        ...(manual.startTime ? { startTime: new Date(manual.startTime).toISOString() } : {}),
        ...(manual.round ? { round: Number(manual.round) } : {}),
        ...(manual.group.trim() ? { group: manual.group.trim() } : {}),
        ...(manual.stage ? { stage: manual.stage } : {}),
        ...(manual.stageLabel.trim() ? { stageLabel: manual.stageLabel.trim() } : {}),
      };
      await createOrgTournamentMatch(orgId, tournamentId, payload);
      setManual({ team1: "", team2: "", startTime: "", round: "", group: "", stage: "", stageLabel: "" });
      onSaved("Fixture added.");
    } catch (error) {
      onError(competitionErrorMessage(error, "Could not add the fixture."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {canFixture ? (
        <>
          <div className={card}>
            <p className={eyebrow}>Auto-generate</p>
            <h3 className={`${sectionTitle} mt-1`}>Fixture preview</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Format">
                <select
                  value={options.format}
                  onChange={(event) => setOptions((prev) => ({ ...prev, format: event.target.value }))}
                  className={input}
                >
                  {FIXTURE_FORMATS.map((format) => (
                    <option key={format.value} value={format.value}>
                      {format.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Starts">
                <input
                  type="datetime-local"
                  value={options.startAt}
                  onChange={(event) => setOptions((prev) => ({ ...prev, startAt: event.target.value }))}
                  className={input}
                />
              </Field>
              <Field label="Gap (hours)">
                <input
                  type="number"
                  min={1}
                  value={options.gapHours}
                  onChange={(event) => setOptions((prev) => ({ ...prev, gapHours: event.target.value }))}
                  className={input}
                />
              </Field>
              <Field label="Venue">
                <input
                  value={options.venue}
                  onChange={(event) => setOptions((prev) => ({ ...prev, venue: event.target.value }))}
                  className={input}
                  maxLength={200}
                />
              </Field>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={previewFixtures} disabled={busy} className={secondaryButton}>
                Preview
              </button>
              <button type="button" onClick={applyFixtures} disabled={busy || !preview} className={primaryButton}>
                Apply
              </button>
            </div>
            {preview ? (
              <p className="mt-3 text-xs font-semibold text-cric-muted">
                {preview.format}: {preview.totalMatches} concrete match(es), {preview.tbdMatches} TBD
                {preview.warnings?.length ? ` — ${preview.warnings.join(" ")}` : ""}
              </p>
            ) : (
              <p className="mt-3 text-[10px] font-bold uppercase tracking-widest text-cric-muted">
                Preview first. Apply asks for confirmation.
              </p>
            )}
          </div>

          <form onSubmit={addManualFixture} className={card}>
            <p className={eyebrow}>Single fixture</p>
            <h3 className={`${sectionTitle} mt-1`}>Add a tournament match</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Team A">
                <select
                  value={manual.team1}
                  onChange={(event) => setManual((prev) => ({ ...prev, team1: event.target.value }))}
                  className={input}
                >
                  <option value="">— Select —</option>
                  {(detail.teams || []).map((team) => (
                    <option key={idOf(team)} value={idOf(team)}>
                      {teamName(team)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Team B">
                <select
                  value={manual.team2}
                  onChange={(event) => setManual((prev) => ({ ...prev, team2: event.target.value }))}
                  className={input}
                >
                  <option value="">— Select —</option>
                  {(detail.teams || []).map((team) => (
                    <option key={idOf(team)} value={idOf(team)}>
                      {teamName(team)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Date and time" hint="Leave empty for a TBD fixture.">
                <input
                  type="datetime-local"
                  value={manual.startTime}
                  onChange={(event) => setManual((prev) => ({ ...prev, startTime: event.target.value }))}
                  className={input}
                />
              </Field>
              <Field label="Round">
                <input
                  type="number"
                  min={1}
                  value={manual.round}
                  onChange={(event) => setManual((prev) => ({ ...prev, round: event.target.value }))}
                  className={input}
                />
              </Field>
              <Field label="Group">
                <input
                  value={manual.group}
                  onChange={(event) => setManual((prev) => ({ ...prev, group: event.target.value }))}
                  className={input}
                  maxLength={20}
                />
              </Field>
              <Field label="Stage">
                <select
                  value={manual.stage}
                  onChange={(event) => setManual((prev) => ({ ...prev, stage: event.target.value }))}
                  className={input}
                >
                  {FIXTURE_STAGES.map((stage) => (
                    <option key={stage.value} value={stage.value}>
                      {stage.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Slot label">
                <input
                  value={manual.stageLabel}
                  onChange={(event) => setManual((prev) => ({ ...prev, stageLabel: event.target.value }))}
                  placeholder="QF1, SF2, Final"
                  className={input}
                  maxLength={30}
                />
              </Field>
            </div>
            <button type="submit" disabled={busy} className={`${primaryButton} mt-4`}>
              {busy ? "Saving…" : "Add fixture"}
            </button>
          </form>
        </>
      ) : null}

      <div className={card}>
        <p className={eyebrow}>Schedule</p>
        <h3 className={`${sectionTitle} mt-1`}>Fixtures ({fixtures.length})</h3>
        {fixtures.length === 0 ? (
          <p className="mt-3 text-xs font-semibold text-cric-muted">No fixtures yet.</p>
        ) : (
          <div className="mt-3 space-y-4">
            {grouped.map((group) => (
              <div key={`${group.group}-${group.round}`}>
                <p className="text-[10px] font-black uppercase tracking-widest text-cric-muted">
                  {group.group ? `Group ${group.group} · ` : ""}Round {group.round}
                </p>
                <div className="mt-2 space-y-2">
                  {group.matches.map((fixture) => (
                    <div key={fixture._id} className={cardSubtle}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-black uppercase tracking-wide">
                            {teamName(fixture.teams?.[0])} v {teamName(fixture.teams?.[1])}
                          </p>
                          <p className="mt-1 text-[10px] font-semibold text-cric-muted">
                            {fixture.startAt ? formatDateTime(fixture.startAt) : "Date TBD"}
                            {fixture.venue ? ` · ${fixture.venue}` : ""} · {fixture.status}
                            {fixture.stage ? ` · ${fixture.stage.replace(/_/g, " ")}` : ""}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {canFixture && (fixture.teams || []).length >= 2 ? (
                            <button
                              type="button"
                              onClick={() => setSetupFor(setupFor?._id === fixture._id ? null : fixture)}
                              className={secondaryButton}
                            >
                              Setup XI
                            </button>
                          ) : null}
                          {canManage ? <RequestDeletionButton label="Request match deletion" /> : null}
                        </div>
                      </div>
                      {setupFor?._id === fixture._id ? (
                        <MatchSetup
                          orgId={orgId}
                          match={fixture}
                          onClose={() => setSetupFor(null)}
                          onSaved={(message) => {
                            setSetupFor(null);
                            onSaved(message);
                          }}
                        />
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SquadsTab({ orgId, tournamentId, detail, squads, canFixture, onSaved, onError }) {
  const teams = detail.teams || [];
  const [teamId, setTeamId] = useState(() => idOf(teams[0]));
  const [roster, setRoster] = useState([]);
  const [draft, setDraft] = useState({ players: [], captain: "", viceCaptain: "", wicketKeepers: [] });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!teams.length) {
      setTeamId("");
      return;
    }
    if (!teams.some((team) => idOf(team) === teamId)) setTeamId(idOf(teams[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail._id, teams.length]);

  useEffect(() => {
    if (!teamId) {
      setRoster([]);
      setDraft({ players: [], captain: "", viceCaptain: "", wicketKeepers: [] });
      return undefined;
    }
    let alive = true;
    setBusy(true);
    onError("");
    const existing = squads.find((squad) => idOf(squad.team) === teamId);
    Promise.all([getTeamRoster(teamId), Promise.resolve(existing)])
      .then(([rosterResponse, squad]) => {
        if (!alive) return;
        setRoster(asArray(rosterResponse));
        setDraft({
          players: uniqueIds(squad?.players || []),
          captain: idOf(squad?.captain),
          viceCaptain: idOf(squad?.viceCaptain),
          wicketKeepers: uniqueIds(squad?.wicketKeepers || []),
        });
      })
      .catch((error) => {
        if (alive) onError(competitionErrorMessage(error, "Could not load that team's roster."));
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, squads]);

  const togglePlayer = (playerId) => {
    setDraft((prev) => {
      if (prev.players.includes(playerId)) {
        return {
          players: prev.players.filter((id) => id !== playerId),
          captain: prev.captain === playerId ? "" : prev.captain,
          viceCaptain: prev.viceCaptain === playerId ? "" : prev.viceCaptain,
          wicketKeepers: prev.wicketKeepers.filter((id) => id !== playerId),
        };
      }
      if (prev.players.length >= 20) return prev;
      return { ...prev, players: [...prev.players, playerId] };
    });
  };

  const save = async () => {
    if (draft.players.length < 11 || draft.players.length > 20) {
      onError("A tournament squad must have between 11 and 20 players.");
      return;
    }
    if (!draft.captain || !draft.viceCaptain || !draft.wicketKeepers.length) {
      onError("Choose a captain, vice-captain and at least one wicket-keeper.");
      return;
    }
    setBusy(true);
    onError("");
    try {
      await setOrgTournamentSquad(orgId, tournamentId, {
        teamId,
        players: draft.players,
        captain: draft.captain,
        viceCaptain: draft.viceCaptain,
        wicketKeepers: draft.wicketKeepers,
      });
      onSaved("Tournament squad saved.");
    } catch (error) {
      onError(competitionErrorMessage(error, "Could not save the squad."));
    } finally {
      setBusy(false);
    }
  };

  const selectedPlayers = roster.filter((player) => draft.players.includes(idOf(player)));

  return (
    <div className="space-y-4">
      <div className={card}>
        <p className={eyebrow}>Tournament squads</p>
        <h3 className={`${sectionTitle} mt-1`}>Squad (11–20 players)</h3>
        <p className="mt-1 text-xs font-semibold text-cric-muted">
          The tournament squad feeds Playing XI setup for this tournament&apos;s matches. Choose from the
          team&apos;s own roster.
        </p>
        <div className="mt-3 max-w-sm">
          <Field label="Team">
            <select value={teamId} onChange={(event) => setTeamId(event.target.value)} className={input}>
              {teams.map((team) => (
                <option key={idOf(team)} value={idOf(team)}>
                  {teamName(team)}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      {teams.length === 0 ? (
        <Banner kind="info">Add at least one team before creating a tournament squad.</Banner>
      ) : (
        <div className={card}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-cric-muted">
              {draft.players.length}/20 selected · minimum 11
            </p>
            <span className="rounded-full bg-cric-bg px-3 py-1 text-[10px] font-black uppercase tracking-widest text-cric-muted">
              {busy ? "Loading…" : `${roster.length} in roster`}
            </span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {roster.map((player) => {
              const playerId = idOf(player);
              const active = draft.players.includes(playerId);
              return (
                <button
                  key={playerId}
                  type="button"
                  onClick={() => togglePlayer(playerId)}
                  disabled={!canFixture || busy}
                  aria-pressed={active}
                  className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition disabled:opacity-60 ${
                    active
                      ? "border-cric-accent bg-cric-accent text-white"
                      : "border-cric-border bg-cric-bg text-cric-text hover:border-cric-accent/60"
                  }`}
                >
                  <span className="truncate text-[10px] font-black uppercase tracking-wide">
                    {playerName(player)}
                  </span>
                  <span className={`text-[9px] font-bold uppercase tracking-widest ${active ? "text-white/80" : "text-cric-muted"}`}>
                    {player.playingRole || player.role || ""}
                  </span>
                </button>
              );
            })}
            {!roster.length && !busy ? (
              <p className="text-xs font-semibold text-cric-muted">This team has no players yet.</p>
            ) : null}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Field label="Captain">
              <select
                value={draft.captain}
                onChange={(event) => setDraft((prev) => ({ ...prev, captain: event.target.value }))}
                disabled={!canFixture}
                className={input}
              >
                <option value="">—</option>
                {selectedPlayers.map((player) => (
                  <option key={idOf(player)} value={idOf(player)}>
                    {playerName(player)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Vice-captain">
              <select
                value={draft.viceCaptain}
                onChange={(event) => setDraft((prev) => ({ ...prev, viceCaptain: event.target.value }))}
                disabled={!canFixture}
                className={input}
              >
                <option value="">—</option>
                {selectedPlayers.map((player) => (
                  <option key={idOf(player)} value={idOf(player)}>
                    {playerName(player)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Wicket-keeper">
              <select
                value={draft.wicketKeepers[0] || ""}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, wicketKeepers: event.target.value ? [event.target.value] : [] }))
                }
                disabled={!canFixture}
                className={input}
              >
                <option value="">—</option>
                {selectedPlayers.map((player) => (
                  <option key={idOf(player)} value={idOf(player)}>
                    {playerName(player)}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {canFixture ? (
            <button type="button" onClick={save} disabled={busy} className={`${primaryButton} mt-4`}>
              {busy ? "Saving…" : "Save squad"}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

function PointsTab({ orgId, tournamentId, detail, canManage, onSaved, onError }) {
  const [busy, setBusy] = useState(false);
  const rows = useMemo(
    () =>
      [...(detail.pointsTable || [])].sort(
        (a, b) => (b.points || 0) - (a.points || 0) || (b.netRunRate || 0) - (a.netRunRate || 0)
      ),
    [detail.pointsTable]
  );

  const recompute = async () => {
    setBusy(true);
    onError("");
    try {
      await recomputeOrgTournamentPoints(orgId, tournamentId);
      onSaved("Points table recomputed.");
    } catch (error) {
      onError(competitionErrorMessage(error, "Could not recompute the points table."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={card}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className={eyebrow}>Standings</p>
          <h3 className={`${sectionTitle} mt-1`}>Points table</h3>
        </div>
        {canManage ? (
          <button type="button" onClick={recompute} disabled={busy} className={primaryButton}>
            {busy ? "Recomputing…" : "Recompute points"}
          </button>
        ) : null}
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-xs">
          <thead>
            <tr className="border-b border-cric-border text-[9px] font-black uppercase tracking-widest text-cric-muted">
              <th className="px-2 py-2">Pos</th>
              <th className="px-2 py-2">Team</th>
              <th className="px-2 py-2 text-center">M</th>
              <th className="px-2 py-2 text-center">W</th>
              <th className="px-2 py-2 text-center">L</th>
              <th className="px-2 py-2 text-center">T</th>
              <th className="px-2 py-2 text-center">NRR</th>
              <th className="px-2 py-2 text-center">Pts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={idOf(row.team) || index} className="border-b border-cric-border/60">
                <td className="px-2 py-3 font-black">{index + 1}</td>
                <td className="px-2 py-3 font-bold">{teamName(row.team)}</td>
                <td className="px-2 py-3 text-center">{row.matchesPlayed ?? 0}</td>
                <td className="px-2 py-3 text-center">{row.won ?? 0}</td>
                <td className="px-2 py-3 text-center">{row.lost ?? 0}</td>
                <td className="px-2 py-3 text-center">{row.tied ?? 0}</td>
                <td className="px-2 py-3 text-center">{Number(row.netRunRate || 0).toFixed(3)}</td>
                <td className="px-2 py-3 text-center font-black">{row.points ?? 0}</td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={8} className="px-2 py-6 text-center text-xs font-semibold text-cric-muted">
                  No points rows yet. Add teams, then recompute.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AwardsTab({ orgId, tournamentId, detail, squads, canManage, onSaved, onError }) {
  const [busy, setBusy] = useState(false);
  const [awards, setAwards] = useState({
    winner: idOf(detail.winner),
    runnerUp: idOf(detail.runnerUp),
    playerOfTournament: idOf(detail.awards?.playerOfTournament),
    bestBatsman: idOf(detail.awards?.bestBatsman),
    bestBowler: idOf(detail.awards?.bestBowler),
  });
  const [official, setOfficial] = useState(() => {
    const saved = uniqueIds(detail.officialAwards?.topPlayers || []);
    if (!saved.length && detail.officialAwards?.playerOfTournament) {
      saved.push(idOf(detail.officialAwards.playerOfTournament));
    }
    return {
      topPlayers: [saved[0] || "", saved[1] || "", saved[2] || ""],
      bestBatsman: idOf(detail.officialAwards?.bestBatsman),
      bestBowler: idOf(detail.officialAwards?.bestBowler),
      note: detail.officialAwards?.note || "",
    };
  });

  const playerOptions = useMemo(() => {
    const options = new Map();
    for (const squad of squads) {
      for (const player of squad.players || []) {
        const playerId = idOf(player);
        if (!playerId || options.has(playerId)) continue;
        options.set(playerId, {
          id: playerId,
          name: playerName(player),
          team: teamName(squad.team),
        });
      }
    }
    return [...options.values()];
  }, [squads]);

  const saveAwards = async () => {
    setBusy(true);
    onError("");
    try {
      await setOrgTournamentAwards(orgId, tournamentId, awards);
      onSaved("Tournament awards saved.");
    } catch (error) {
      onError(competitionErrorMessage(error, "Could not save the awards."));
    } finally {
      setBusy(false);
    }
  };

  const saveOfficial = async () => {
    setBusy(true);
    onError("");
    try {
      await setOrgTournamentOfficialAwards(orgId, tournamentId, {
        ...official,
        topPlayers: official.topPlayers.filter(Boolean),
      });
      onSaved("Official awards saved.");
    } catch (error) {
      onError(competitionErrorMessage(error, "Could not save the official awards."));
    } finally {
      setBusy(false);
    }
  };

  const setPodiumPlace = (index, value) =>
    setOfficial((prev) => {
      const next = [...prev.topPlayers];
      if (value) next[index] = value;
      else {
        next.splice(index, 1);
        next.push("");
      }
      return { ...prev, topPlayers: next.slice(0, 3) };
    });

  return (
    <div className="space-y-4">
      <div className={card}>
        <p className={eyebrow}>Honours</p>
        <h3 className={`${sectionTitle} mt-1`}>Tournament awards</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Champion">
            <select
              value={awards.winner}
              onChange={(event) => setAwards((prev) => ({ ...prev, winner: event.target.value }))}
              disabled={!canManage}
              className={input}
            >
              <option value="">Not awarded</option>
              {(detail.teams || []).map((team) => (
                <option key={idOf(team)} value={idOf(team)}>
                  {teamName(team)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Runner-up">
            <select
              value={awards.runnerUp}
              onChange={(event) => setAwards((prev) => ({ ...prev, runnerUp: event.target.value }))}
              disabled={!canManage}
              className={input}
            >
              <option value="">Not awarded</option>
              {(detail.teams || []).map((team) => (
                <option key={idOf(team)} value={idOf(team)}>
                  {teamName(team)}
                </option>
              ))}
            </select>
          </Field>
          {[
            ["playerOfTournament", "Player of the tournament"],
            ["bestBatsman", "Best batsman"],
            ["bestBowler", "Best bowler"],
          ].map(([key, label]) => (
            <Field key={key} label={label}>
              <select
                value={awards[key]}
                onChange={(event) => setAwards((prev) => ({ ...prev, [key]: event.target.value }))}
                disabled={!canManage}
                className={input}
              >
                <option value="">Not awarded</option>
                {playerOptions.map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.name} ({player.team})
                  </option>
                ))}
              </select>
            </Field>
          ))}
        </div>
        {playerOptions.length === 0 ? (
          <p className="mt-3 text-[10px] font-bold uppercase tracking-widest text-cric-muted">
            Import tournament squads to fill the player awards.
          </p>
        ) : null}
        {canManage ? (
          <button type="button" onClick={saveAwards} disabled={busy} className={`${primaryButton} mt-4`}>
            {busy ? "Saving…" : "Save awards"}
          </button>
        ) : null}
      </div>

      <div className={card}>
        <p className={eyebrow}>Organiser-confirmed</p>
        <h3 className={`${sectionTitle} mt-1`}>Official awards</h3>
        <p className="mt-1 text-xs font-semibold text-cric-muted">
          Shown at the top of the public Player of the Tournament page. They do not change the computed
          points or ranking order.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {["1st", "2nd", "3rd"].map((place, index) => (
            <Field key={place} label={`${place} place`}>
              <select
                value={official.topPlayers[index] || ""}
                onChange={(event) => setPodiumPlace(index, event.target.value)}
                disabled={!canManage}
                className={input}
              >
                <option value="">Not awarded</option>
                {playerOptions.map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.name} ({player.team})
                  </option>
                ))}
              </select>
            </Field>
          ))}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Official best batsman">
            <select
              value={official.bestBatsman}
              onChange={(event) => setOfficial((prev) => ({ ...prev, bestBatsman: event.target.value }))}
              disabled={!canManage}
              className={input}
            >
              <option value="">Not awarded</option>
              {playerOptions.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.name} ({player.team})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Official best bowler">
            <select
              value={official.bestBowler}
              onChange={(event) => setOfficial((prev) => ({ ...prev, bestBowler: event.target.value }))}
              disabled={!canManage}
              className={input}
            >
              <option value="">Not awarded</option>
              {playerOptions.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.name} ({player.team})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Note">
            <textarea
              value={official.note}
              onChange={(event) => setOfficial((prev) => ({ ...prev, note: event.target.value }))}
              disabled={!canManage}
              rows={3}
              maxLength={500}
              className={input}
            />
          </Field>
        </div>
        {canManage ? (
          <button type="button" onClick={saveOfficial} disabled={busy} className={`${primaryButton} mt-4`}>
            {busy ? "Saving…" : "Save official awards"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
