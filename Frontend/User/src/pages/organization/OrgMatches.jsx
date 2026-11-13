import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import RequestDeletionButton from "../../components/RequestDeletionButton";
import IssueReportButton from "../../components/IssueReportButton";
import {
  addOrgTeamPlayer,
  createOrgMatch,
  getMatchDetail,
  getMatchSquads,
  listOrgMatches,
  listOrgTeamsManaged,
  setMatchPlayingXI,
  setMatchTeamRoles,
  setMatchToss,
  setMatchTwelfthMan,
  updateOrgMatch,
} from "../../services/organizationApi";
import { formatDate } from "../../lib/orgUi";
import {
  Banner,
  Field,
  card,
  cardSubtle,
  eyebrow,
  input,
  primaryButton,
  secondaryButton,
  sectionTitle,
} from "./orgStyles";

const MATCH_TYPES = ["T10", "T20", "6 Overs", "8 Overs", "ODI", "Test", "Tape Ball", "Super Over"];

const emptyMatch = { teamA: "", teamB: "", matchType: "T20", venue: "", startAt: "", eventId: "" };

const toDateInput = (value) => (value ? new Date(value).toISOString().slice(0, 10) : "");

const teamName = (team) => team?.name || "Unknown team";

const idOf = (value) => String(value?._id || value || "");

const EMPTY_SELECTION = {
  xi: [],
  captain: "",
  viceCaptain: "",
  wicketKeepers: [],
  twelfthMan: "",
};

const playerName = (player) => player?.name || "Unknown player";

/**
 * Single-match setup for the organization owner.
 *
 * The optional 15-player squad step is gone: the XI, the 12th Man / Super Sub
 * and the team roles all come from the full competition squad that
 * GET /matches/:id/squads resolves (tournament squad -> event squad -> the
 * club's whole roster). A new player can be created without leaving the picker.
 */
export function MatchSetup({ orgId, match, onClose, onSaved }) {
  const [detail, setDetail] = useState(null);
  const [squadsById, setSquadsById] = useState({});
  const [selection, setSelection] = useState({});
  const [search, setSearch] = useState({});
  const [toss, setToss] = useState({ winner: "", decision: "bat" });
  const [addFor, setAddFor] = useState(null);
  const [newPlayer, setNewPlayer] = useState({ name: "", role: "", phone: "" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");

  const matchTeams = match.teams || [];

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr("");
    Promise.all([getMatchDetail(match._id), getMatchSquads(match._id)])
      .then(([full, squadResponse]) => {
        if (!alive) return;
        const nextSquads = {};
        for (const row of squadResponse?.teams || []) {
          nextSquads[idOf(row.team)] = row;
        }

        const nextSelection = {};
        for (const team of matchTeams) {
          const teamId = idOf(team);
          const xiEntry = (full.playingXI || []).find((entry) => idOf(entry.team) === teamId);
          const roles = (full.teamRoles || []).find((entry) => idOf(entry.team) === teamId);
          const twelfth = (full.twelfthMan || []).find((entry) => idOf(entry.team) === teamId);
          nextSelection[teamId] = {
            xi: (xiEntry?.players || []).map(idOf),
            captain: idOf(roles?.captain),
            viceCaptain: idOf(roles?.viceCaptain),
            wicketKeepers: (roles?.wicketKeepers || []).map(idOf),
            twelfthMan: idOf(twelfth?.player),
          };
        }

        setDetail(full);
        setSquadsById(nextSquads);
        setSelection(nextSelection);
        setToss({
          winner: idOf(full.tossWinner),
          decision: full.tossDecision || "bat",
        });
        setLoading(false);
      })
      .catch((error) => {
        if (!alive) return;
        setErr(error.message || "Could not load the match setup");
        setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match._id]);

  const squadFor = (teamId) => squadsById[teamId]?.squad || [];
  const sourceFor = (teamId) => squadsById[teamId]?.squadSource || "roster";
  const selectionFor = (teamId) => selection[teamId] || EMPTY_SELECTION;

  const setTeamSelection = (teamId, patch) => {
    setSelection((prev) => ({
      ...prev,
      [teamId]: { ...(prev[teamId] || EMPTY_SELECTION), ...patch },
    }));
  };

  const togglePlayer = (teamId, playerId) => {
    setSelection((prev) => {
      const current = prev[teamId] || EMPTY_SELECTION;
      if (current.xi.includes(playerId)) {
        return {
          ...prev,
          [teamId]: {
            ...current,
            xi: current.xi.filter((id) => id !== playerId),
            captain: current.captain === playerId ? "" : current.captain,
            viceCaptain: current.viceCaptain === playerId ? "" : current.viceCaptain,
            wicketKeepers: current.wicketKeepers.filter((id) => id !== playerId),
          },
        };
      }
      if (current.xi.length >= 11) return prev;
      return {
        ...prev,
        [teamId]: {
          ...current,
          xi: [...current.xi, playerId],
          twelfthMan: current.twelfthMan === playerId ? "" : current.twelfthMan,
        },
      };
    });
  };

  const chooseCaptain = (teamId, playerId) => {
    const current = selectionFor(teamId);
    setTeamSelection(teamId, {
      captain: playerId,
      viceCaptain: current.viceCaptain === playerId ? "" : current.viceCaptain,
    });
  };

  const chooseViceCaptain = (teamId, playerId) => {
    const current = selectionFor(teamId);
    setTeamSelection(teamId, {
      viceCaptain: playerId,
      captain: current.captain === playerId ? "" : current.captain,
    });
  };

  const chooseWicketKeeper = (teamId, playerId) => {
    setTeamSelection(teamId, { wicketKeepers: playerId ? [playerId] : [] });
  };

  const submitNewPlayer = async (teamId) => {
    const name = newPlayer.name.trim();
    if (!name) {
      setErr("A player name is required.");
      return;
    }
    setBusy(true);
    setErr("");
    setNotice("");
    try {
      const response = await addOrgTeamPlayer(orgId, teamId, {
        name,
        ...(newPlayer.role.trim() ? { role: newPlayer.role.trim() } : {}),
        ...(newPlayer.phone.trim() ? { phone: newPlayer.phone.trim() } : {}),
      });
      const created = response?.player;
      if (created) {
        const player = {
          _id: idOf(created),
          name: created.name,
          role: created.role || "",
          playingRole: created.playingRole || created.role || "",
          battingPosition: created.battingPosition || "",
        };
        setSquadsById((prev) => {
          const row = prev[teamId] || {
            team: { _id: teamId },
            squad: [],
            squadSource: "roster",
          };
          return {
            ...prev,
            [teamId]: { ...row, squad: [...(row.squad || []), player] },
          };
        });
        setSelection((prev) => {
          const current = prev[teamId] || EMPTY_SELECTION;
          if (current.xi.length >= 11 || current.xi.includes(player._id)) return prev;
          return { ...prev, [teamId]: { ...current, xi: [...current.xi, player._id] } };
        });
        setNotice(`${player.name} added${selectionFor(teamId).xi.length < 11 ? " and selected." : "."}`);
      }
      setNewPlayer({ name: "", role: "", phone: "" });
      setAddFor(null);
    } catch (error) {
      setErr(error.message || "Could not add the player");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const teamsToSave = matchTeams
      .map(idOf)
      .filter((teamId) => selectionFor(teamId).xi.length === 11);

    if (!teamsToSave.length && !toss.winner) {
      setErr("Pick a full Playing XI (11 players) or record the toss first.");
      return;
    }

    setBusy(true);
    setErr("");
    setNotice("");
    try {
      // Clear a stored 12th Man before the XI when the nomination changed, so a
      // player moving into the XI is never blocked by the previous nomination.
      for (const team of matchTeams) {
        const teamId = idOf(team);
        const stored = (detail?.twelfthMan || []).find((entry) => idOf(entry.team) === teamId);
        const storedId = idOf(stored?.player);
        const current = selectionFor(teamId);
        if (storedId && (storedId !== current.twelfthMan || current.xi.includes(storedId))) {
          await setMatchTwelfthMan(match._id, teamId, null);
        }
      }

      if (toss.winner) {
        await setMatchToss(match._id, toss.winner, toss.decision);
      }

      let rolesMissing = false;
      for (const teamId of teamsToSave) {
        const current = selectionFor(teamId);
        await setMatchPlayingXI(match._id, teamId, current.xi);
        if (current.captain && current.viceCaptain && current.wicketKeepers.length) {
          await setMatchTeamRoles(match._id, {
            teamId,
            captain: current.captain,
            viceCaptain: current.viceCaptain,
            wicketKeepers: current.wicketKeepers,
          });
        } else {
          rolesMissing = true;
        }
        if (current.twelfthMan) {
          await setMatchTwelfthMan(match._id, teamId, current.twelfthMan);
        }
      }

      onSaved(
        rolesMissing
          ? "Playing XI saved. Choose a captain, vice-captain and wicket-keeper."
          : "Match setup saved."
      );
    } catch (error) {
      setErr(error.message || "Could not save the match setup");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="mt-3 rounded-xl border border-cric-border bg-cric-bg p-4">
        <p className="text-xs font-semibold text-cric-muted">Loading match setup…</p>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-5 rounded-xl border border-cric-border bg-cric-bg p-4">
      {err ? <Banner kind="error">{err}</Banner> : null}
      {notice ? <Banner kind="success">{notice}</Banner> : null}

      <div className="rounded-xl border border-cric-border bg-cric-card p-4">
        <p className={eyebrow}>Toss</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Toss winner">
            <select
              value={toss.winner}
              onChange={(event) => setToss((prev) => ({ ...prev, winner: event.target.value }))}
              className={input}
            >
              <option value="">— Not set —</option>
              {matchTeams.map((team) => (
                <option key={idOf(team)} value={idOf(team)}>
                  {teamName(team)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Decision">
            <select
              value={toss.decision}
              onChange={(event) => setToss((prev) => ({ ...prev, decision: event.target.value }))}
              className={input}
              disabled={!toss.winner}
            >
              <option value="bat">Bat first</option>
              <option value="bowl">Bowl first</option>
            </select>
          </Field>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {matchTeams.map((team) => {
          const teamId = idOf(team);
          const current = selectionFor(teamId);
          const squad = squadFor(teamId);
          const query = (search[teamId] || "").trim().toLowerCase();
          const visible = query
            ? squad.filter((player) => playerName(player).toLowerCase().includes(query))
            : squad;
          const xiPlayers = squad.filter((player) => current.xi.includes(idOf(player)));
          const bench = squad.filter((player) => !current.xi.includes(idOf(player)));
          const isRosterSource = sourceFor(teamId) === "roster";

          return (
            <div key={teamId} className="rounded-xl border border-cric-border bg-cric-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className={eyebrow}>Playing XI</p>
                  <p className="mt-1 text-sm font-black uppercase tracking-wide">{teamName(team)}</p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${
                    current.xi.length === 11
                      ? "bg-green-100 text-green-700"
                      : "bg-cric-bg text-cric-muted"
                  }`}
                >
                  {current.xi.length}/11
                </span>
              </div>

              <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-cric-muted">
                {sourceFor(teamId) === "tournament"
                  ? "From the tournament squad"
                  : sourceFor(teamId) === "event"
                    ? "From the event squad"
                    : "From the club roster"}
              </p>

              <input
                type="search"
                value={search[teamId] || ""}
                onChange={(event) =>
                  setSearch((prev) => ({ ...prev, [teamId]: event.target.value }))
                }
                placeholder="Search players…"
                className={`${input} mt-3`}
                aria-label={`Search ${teamName(team)} players`}
              />

              {squad.length === 0 ? (
                <p className="mt-3 text-xs font-semibold text-cric-muted">
                  This team has no players yet. Add one below or under Teams.
                </p>
              ) : (
                <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
                  {visible.length === 0 ? (
                    <p className="text-xs font-semibold text-cric-muted">No player matches that search.</p>
                  ) : null}
                  {visible.map((player) => {
                    const playerId = idOf(player);
                    const on = current.xi.includes(playerId);
                    return (
                      <button
                        key={playerId}
                        type="button"
                        onClick={() => togglePlayer(teamId, playerId)}
                        aria-pressed={on}
                        className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition ${
                          on
                            ? "border-cric-accent bg-cric-accent text-white"
                            : "border-cric-border bg-cric-bg text-cric-text hover:border-cric-accent/60"
                        }`}
                      >
                        <span className="truncate text-xs font-black uppercase tracking-wide">
                          {playerName(player)}
                        </span>
                        <span
                          className={`shrink-0 text-[10px] font-bold uppercase tracking-widest ${
                            on ? "text-white/80" : "text-cric-muted"
                          }`}
                        >
                          {player.playingRole || player.role || ""}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {isRosterSource ? (
                addFor === teamId ? (
                  <div className="mt-3 space-y-2 rounded-lg border border-cric-border bg-cric-bg p-3">
                    <input
                      value={newPlayer.name}
                      onChange={(event) =>
                        setNewPlayer((prev) => ({ ...prev, name: event.target.value }))
                      }
                      placeholder="Player name *"
                      className={input}
                      aria-label={`New ${teamName(team)} player name`}
                    />
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input
                        value={newPlayer.role}
                        onChange={(event) =>
                          setNewPlayer((prev) => ({ ...prev, role: event.target.value }))
                        }
                        placeholder="Role (optional)"
                        className={input}
                        aria-label={`New ${teamName(team)} player role`}
                      />
                      <input
                        value={newPlayer.phone}
                        onChange={(event) =>
                          setNewPlayer((prev) => ({ ...prev, phone: event.target.value }))
                        }
                        placeholder="Phone (optional)"
                        className={input}
                        inputMode="tel"
                        aria-label={`New ${teamName(team)} player phone`}
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => submitNewPlayer(teamId)}
                        disabled={busy}
                        className={primaryButton}
                      >
                        {busy ? "Adding…" : "Add player"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAddFor(null);
                          setNewPlayer({ name: "", role: "", phone: "" });
                        }}
                        className={secondaryButton}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setAddFor(teamId);
                      setNewPlayer({ name: "", role: "", phone: "" });
                      setErr("");
                    }}
                    className={`${secondaryButton} mt-3 w-full`}
                  >
                    + Add new player
                  </button>
                )
              ) : null}

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <Field label="Captain">
                  <select
                    value={current.captain}
                    onChange={(event) => chooseCaptain(teamId, event.target.value)}
                    className={input}
                    disabled={xiPlayers.length === 0}
                  >
                    <option value="">—</option>
                    {xiPlayers.map((player) => (
                      <option key={idOf(player)} value={idOf(player)}>
                        {playerName(player)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Vice-captain">
                  <select
                    value={current.viceCaptain}
                    onChange={(event) => chooseViceCaptain(teamId, event.target.value)}
                    className={input}
                    disabled={xiPlayers.length === 0}
                  >
                    <option value="">—</option>
                    {xiPlayers.map((player) => (
                      <option key={idOf(player)} value={idOf(player)}>
                        {playerName(player)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Wicket-keeper">
                  <select
                    value={current.wicketKeepers[0] || ""}
                    onChange={(event) => chooseWicketKeeper(teamId, event.target.value)}
                    className={input}
                    disabled={xiPlayers.length === 0}
                  >
                    <option value="">—</option>
                    {xiPlayers.map((player) => (
                      <option key={idOf(player)} value={idOf(player)}>
                        {playerName(player)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="mt-3">
                <Field
                  label="12th Man / Super Sub (optional)"
                  hint="Must be outside the Playing XI."
                >
                  <select
                    value={current.twelfthMan}
                    onChange={(event) => setTeamSelection(teamId, { twelfthMan: event.target.value })}
                    className={input}
                  >
                    <option value="">— None —</option>
                    {bench.map((player) => (
                      <option key={idOf(player)} value={idOf(player)}>
                        {playerName(player)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={save} disabled={busy} className={primaryButton}>
          {busy ? "Saving…" : "Save setup"}
        </button>
        <button type="button" onClick={onClose} className={secondaryButton}>
          Close
        </button>
      </div>
    </div>
  );
}

function MatchForm({ orgId, teams, events, initial, onDone, onCancel }) {
  const [form, setForm] = useState(() => ({ ...emptyMatch, ...(initial || {}) }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    if (!initial && form.teamA === form.teamB) {
      setErr("Pick two different teams");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      if (initial) {
        const payload = {
          title: form.title?.trim() || undefined,
          venue: form.venue?.trim() || undefined,
          matchType: form.matchType,
          startAt: form.startAt || undefined,
        };
        await updateOrgMatch(orgId, initial._id, Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined)));
      } else {
        await createOrgMatch(orgId, {
          teams: [form.teamA, form.teamB],
          matchType: form.matchType,
          ...(form.venue.trim() ? { venue: form.venue.trim() } : {}),
          ...(form.startAt ? { startAt: new Date(form.startAt).toISOString() } : {}),
          ...(form.eventId ? { eventId: form.eventId } : {}),
        });
      }
      onDone();
    } catch (error) {
      setErr(error.message || "Could not save the fixture");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {err ? <Banner kind="error">{err}</Banner> : null}
      {initial ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Title">
            <input value={form.title || initial.title || ""} onChange={set("title")} className={input} maxLength={200} />
          </Field>
          <Field label="Format">
            <select value={form.matchType} onChange={set("matchType")} className={input}>
              {MATCH_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Venue">
            <input value={form.venue || ""} onChange={set("venue")} className={input} maxLength={200} />
          </Field>
          <Field label="Date">
            <input type="date" value={form.startAt || ""} onChange={set("startAt")} className={input} />
          </Field>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Home side *">
            <select value={form.teamA} onChange={set("teamA")} className={input} required>
              <option value="">— Select a team —</option>
              {teams.map((team) => (
                <option key={team._id} value={team._id}>
                  {team.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Away side *">
            <select value={form.teamB} onChange={set("teamB")} className={input} required>
              <option value="">— Select a team —</option>
              {teams.map((team) => (
                <option key={team._id} value={team._id}>
                  {team.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Format">
            <select value={form.matchType} onChange={set("matchType")} className={input}>
              {MATCH_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Venue">
            <input value={form.venue} onChange={set("venue")} className={input} maxLength={200} />
          </Field>
          <Field label="Date and time">
            <input type="datetime-local" value={form.startAt} onChange={set("startAt")} className={input} />
          </Field>
          <Field label="Event" hint="Optional — puts the fixture inside one of your events.">
            <select value={form.eventId} onChange={set("eventId")} className={input}>
              <option value="">— No event —</option>
              {events.map((event) => (
                <option key={event._id} value={event._id}>
                  {event.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={primaryButton}>
          {busy ? "Saving…" : initial ? "Save fixture" : "Create fixture"}
        </button>
        <button type="button" onClick={onCancel} className={secondaryButton}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function OrgMatches({ orgId, events = [], canManage = true, canScore = true, onChanged }) {
  const [matches, setMatches] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [setupFor, setSetupFor] = useState(null);
  const [notice, setNotice] = useState(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await listOrgMatches(orgId);
      setMatches(Array.isArray(res?.items) ? res.items : []);
    } catch (error) {
      setErr(error.message || "Failed to load your fixtures");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    load();
    // The team list is needed for the create form, and it changes when a team
    // or a player is added, so it is re-read with the fixtures rather than
    // cached for the life of the tab.
    if (canManage) {
      listOrgTeamsManaged(orgId)
        .then((res) => setTeams(Array.isArray(res?.items) ? res.items : Array.isArray(res) ? res : []))
        .catch((error) => setErr(error.message || "Failed to load your teams"));
    } else {
      setTeams([]);
    }
  }, [orgId, load, canManage]);

  const refresh = () => {
    load();
    onChanged?.();
  };

  const abandon = async (match) => {
    setBusyId(match._id);
    setErr("");
    try {
      await updateOrgMatch(orgId, match._id, { status: "abandoned" });
      setNotice({ kind: "success", text: `${match.title} called off.` });
      refresh();
    } catch (error) {
      setErr(error.message || "Could not call the fixture off");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className={eyebrow}>Fixtures</p>
            <h2 className={sectionTitle}>Matches</h2>
            <p className="mt-1 text-xs font-semibold text-cric-muted">
              {canManage
                ? "Schedule a game between your teams, record the toss and pick the Playing XI from the club roster."
                : "View your organization's fixtures and open a match to score it."}
            </p>
          </div>
          {canManage && teams.length < 2 ? (
            <p className="max-w-xs text-[10px] font-bold uppercase tracking-widest text-cric-muted">
              A fixture needs two teams. Create them under Teams first.
            </p>
          ) : canManage ? (
            <button type="button" onClick={() => setCreating((v) => !v)} className={primaryButton}>
              {creating ? "Close" : "+ New fixture"}
            </button>
          ) : null}
        </div>

        {creating ? (
          <div className="mt-4">
            <MatchForm
              orgId={orgId}
              teams={teams}
              events={events}
              onDone={() => {
                setCreating(false);
                setNotice({ kind: "success", text: "Fixture created." });
                refresh();
              }}
              onCancel={() => setCreating(false)}
            />
          </div>
        ) : null}
      </div>

      {err ? <Banner kind="error">{err}</Banner> : null}
      {notice ? (
        <div className="space-y-2">
          <Banner kind={notice.kind}>{notice.text}</Banner>
          {notice.matchId && canScore ? (
            <Link
              to={`/organization/${orgId}/matches/${notice.matchId}/score/live`}
              className={`${primaryButton} inline-flex min-h-11 items-center justify-center`}
            >
              Start scoring
            </Link>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <div className={card}>
          <p className="text-sm font-semibold text-cric-muted">Loading fixtures…</p>
        </div>
      ) : matches.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-cric-border bg-cric-card p-10 text-center">
          <p className="text-sm font-black">No fixtures yet</p>
          <p className="mt-2 text-xs font-semibold text-cric-muted">
            {!canManage ? (
              "No fixtures have been added to this organization yet."
            ) : teams.length < 2 ? (
              <>
                You need two teams before you can schedule a match.{" "}
                <Link to="/organization" className="font-black text-cric-accent underline">
                  Add them under Teams
                </Link>
                .
              </>
            ) : (
              "Create one above, then open Setup to pick each Playing XI."
            )}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {matches.map((match) => {
            const [first, second] = match.teams || [];
            return (
              <div key={match._id} className={cardSubtle}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black uppercase tracking-wide">
                      {teamName(first)} v {teamName(second)}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-cric-muted">
                      {match.matchType}
                      {match.venue ? ` · ${match.venue}` : ""}
                      {match.startAt ? ` · ${formatDate(match.startAt)}` : " · Date not set"}
                      {match.event ? ` · ${match.event.name}` : ""}
                    </p>
                    <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-cric-muted">
                      {match.status.replace(/_/g, " ")}
                      {match.hasScore ? " · has a recorded score" : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canScore ? (
                      <Link
                        to={`/organization/${orgId}/matches/${match._id}/score/live`}
                        className={`${primaryButton} inline-flex min-h-11 items-center justify-center`}
                      >
                        {match.status === "live" ? "Resume scoring" : "Start scoring"}
                      </Link>
                    ) : null}
                    {canManage ? (
                      <>
                        <button type="button" onClick={() => setSetupFor(setupFor?._id === match._id ? null : match)} className={secondaryButton}>
                          Setup XI
                        </button>
                        <button type="button" onClick={() => setEditing(editing?._id === match._id ? null : match)} className={secondaryButton}>
                          Edit
                        </button>
                        {match.status !== "abandoned" ? (
                          <button
                            type="button"
                            onClick={() => abandon(match)}
                            disabled={busyId === match._id}
                            className={secondaryButton}
                          >
                            Call off
                          </button>
                        ) : null}
                        <RequestDeletionButton
                          orgId={orgId}
                          targetType="match"
                          targetId={match._id}
                          subject={`Delete match: ${teamName(first)} v ${teamName(second)}`}
                          label="Request match deletion"
                        />
                      </>
                    ) : null}
                    <IssueReportButton
                      orgId={orgId}
                      targetType="match"
                      targetId={match._id}
                      initialSubject={`Issue with ${teamName(first)} v ${teamName(second)}`}
                    />
                  </div>
                </div>

                {editing?._id === match._id ? (
                  <div className="mt-4">
                    <MatchForm
                      orgId={orgId}
                      teams={teams}
                      events={events}
                      initial={{ ...match, title: match.title, venue: match.venue, matchType: match.matchType, startAt: toDateInput(match.startAt) }}
                      onDone={() => {
                        setEditing(null);
                        setNotice({ kind: "success", text: "Fixture updated." });
                        refresh();
                      }}
                      onCancel={() => setEditing(null)}
                    />
                  </div>
                ) : null}

                {setupFor?._id === match._id ? (
                  <MatchSetup
                    orgId={orgId}
                    match={match}
                    onClose={() => setSetupFor(null)}
                    onSaved={(message) => {
                      setSetupFor(null);
                      setNotice({ kind: "success", text: message, matchId: match._id });
                      refresh();
                    }}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
