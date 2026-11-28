import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import RequestDeletionButton from "../../components/RequestDeletionButton";
import IssueReportButton from "../../components/IssueReportButton";
import {
  addOrgTeamPlayer,
  createOrgMatch,
  getMatchDetail,
  getMatchScorers,
  getMatchSquads,
  listOrgMembers,
  listOrgMatches,
  listOrgTeamsManaged,
  setMatchPlayingXI,
  setMatchScorers,
  setMatchSuperSub,
  setMatchTeamRoles,
  setMatchToss,
  setMatchTwelfthMan,
  updateOrgMatch,
} from "../../services/organizationApi";
import { PERMISSIONS, can, formatDate, roleLabels } from "../../lib/orgUi";
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

// "Custom" (T1.3): the owner types the overs; every other type fixes its own.
const MATCH_TYPES = ["T10", "T20", "6 Overs", "8 Overs", "ODI", "Test", "Tape Ball", "Super Over", "Custom"];
const MATCH_TYPE_LABELS = { Custom: "Custom overs" };
const BALL_TYPES = [
  { value: "", label: "Not set" },
  { value: "hard", label: "Hard ball" },
  { value: "tape", label: "Tape ball" },
  { value: "tennis", label: "Tennis ball" },
];

/** "Custom · 7 overs" for a Custom match, the type itself otherwise. */
export const formatLabel = (match) =>
  match?.matchType === "Custom" && match.totalOvers ? `Custom · ${match.totalOvers} overs` : match?.matchType || "";

const emptyMatch = {
  teamA: "", teamB: "", matchType: "T20", venue: "", startAt: "", eventId: "", useAiCommentary: false,
  totalOvers: "", maxBowlerOvers: "", ballType: "",
};

const wholeNumber = (value) => (value === "" || value == null ? null : Number(value));

/** Client-side copy of the server's overs rules; "" when the form is fine. */
function oversProblem(form) {
  const overs = wholeNumber(form.totalOvers);
  const quota = wholeNumber(form.maxBowlerOvers);
  if (form.matchType === "Custom" && (!Number.isInteger(overs) || overs < 1 || overs > 50)) {
    return "Enter the overs: a whole number from 1 to 50.";
  }
  if (quota !== null && (!Number.isInteger(quota) || quota < 1 || quota > 50)) {
    return "Max overs per bowler must be a whole number from 1 to 50.";
  }
  if (form.matchType === "Custom" && quota !== null && quota > overs) {
    return "A bowler cannot bowl more overs than the match has.";
  }
  return "";
}

/** The overs keys the API accepts for this form (totalOvers only with Custom). */
function oversPayload(form, { clear = false } = {}) {
  const quota = wholeNumber(form.maxBowlerOvers);
  return {
    ...(form.matchType === "Custom" ? { totalOvers: wholeNumber(form.totalOvers) } : {}),
    ...(quota !== null ? { maxBowlerOvers: quota } : clear ? { maxBowlerOvers: null } : {}),
    ...(form.ballType ? { ballType: form.ballType } : clear ? { ballType: null } : {}),
  };
}

function OversFields({ form, set }) {
  return (
    <>
      {form.matchType === "Custom" ? (
        <Field label="Overs *">
          <input type="number" inputMode="numeric" min={1} max={50} step={1} value={form.totalOvers ?? ""} onChange={set("totalOvers")} className={input} required />
        </Field>
      ) : null}
      <Field label="Max overs per bowler" hint="Optional. Empty = the format's limit, or overs ÷ 5 rounded up.">
        <input type="number" inputMode="numeric" min={1} max={50} step={1} value={form.maxBowlerOvers ?? ""} onChange={set("maxBowlerOvers")} className={input} />
      </Field>
      <Field label="Ball type">
        <select value={form.ballType || ""} onChange={set("ballType")} className={input}>
          {BALL_TYPES.map((ball) => (
            <option key={ball.value} value={ball.value}>
              {ball.label}
            </option>
          ))}
        </select>
      </Field>
    </>
  );
}

const toDateInput = (value) => (value ? new Date(value).toISOString().slice(0, 10) : "");

const teamName = (team) => team?.name || "Unknown team";

const idOf = (value) => String(value?._id || value || "");

const EMPTY_SELECTION = {
  xi: [],
  captain: "",
  viceCaptain: "",
  wicketKeepers: [],
  twelfthMan: "",
  superSub: "",
};

const playerName = (player) => player?.name || "Unknown player";

/**
 * Single-match setup for the organization owner.
 *
 * The optional 15-player squad step is gone: the XI, the separate 12th Man and
 * Super Sub nominations, and the team roles all come from the full competition squad that
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
          const superSub = (full.superSub || []).find((entry) => idOf(entry.team) === teamId);
          nextSelection[teamId] = {
            xi: (xiEntry?.players || []).map(idOf),
            captain: idOf(roles?.captain),
            viceCaptain: idOf(roles?.viceCaptain),
            wicketKeepers: (roles?.wicketKeepers || []).map(idOf),
            twelfthMan: idOf(twelfth?.player),
            superSub: idOf(superSub?.player),
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
    const current = selectionFor(teamId);
    const adding = !current.xi.includes(playerId);
    if (adding) {
      const cleared = [];
      if (current.twelfthMan === playerId) cleared.push("12th Man");
      if (current.superSub === playerId) cleared.push("Super Sub");
      if (cleared.length) {
        const player = squadFor(teamId).find((entry) => idOf(entry) === playerId);
        setNotice(
          `${playerName(player)} was removed as ${cleared.join(" and ")} because they are now in the Playing XI.`
        );
      }
    }
    setSelection((prev) => {
      const selected = prev[teamId] || EMPTY_SELECTION;
      if (selected.xi.includes(playerId)) {
        return {
          ...prev,
          [teamId]: {
            ...selected,
            xi: selected.xi.filter((id) => id !== playerId),
            captain: selected.captain === playerId ? "" : selected.captain,
            viceCaptain: selected.viceCaptain === playerId ? "" : selected.viceCaptain,
            wicketKeepers: selected.wicketKeepers.filter((id) => id !== playerId),
          },
        };
      }
      if (selected.xi.length >= 11) return prev;
      return {
        ...prev,
        [teamId]: {
          ...selected,
          xi: [...selected.xi, playerId],
          twelfthMan: selected.twelfthMan === playerId ? "" : selected.twelfthMan,
          superSub: selected.superSub === playerId ? "" : selected.superSub,
        },
      };
    });
  };

  const chooseReserveRole = (teamId, role, playerId) => {
    const current = selectionFor(teamId);
    const otherRole = role === "twelfthMan" ? "superSub" : "twelfthMan";
    const otherLabel = role === "twelfthMan" ? "Super Sub" : "12th Man";
    const patch = { [role]: playerId };
    if (playerId && current[otherRole] === playerId) {
      patch[otherRole] = "";
      const player = squadFor(teamId).find((entry) => idOf(entry) === playerId);
      setNotice(`${playerName(player)} can hold only one reserve role, so their ${otherLabel} nomination was cleared.`);
    }
    setTeamSelection(teamId, patch);
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

    const allXI = new Set(teamsToSave.flatMap((teamId) => selectionFor(teamId).xi));
    const reserveIds = [];
    for (const teamId of teamsToSave) {
      const current = selectionFor(teamId);
      if ([current.twelfthMan, current.superSub].some((id) => id && allXI.has(id))) {
        setErr("The 12th Man and Super Sub must be outside the Playing XI.");
        return;
      }
      if (current.twelfthMan && current.twelfthMan === current.superSub) {
        setErr("A player cannot be both 12th Man and Super Sub.");
        return;
      }
      reserveIds.push(current.twelfthMan, current.superSub);
    }
    const assignedReserves = reserveIds.filter(Boolean);
    if (new Set(assignedReserves).size !== assignedReserves.length) {
      setErr("A player may hold only one 12th Man or Super Sub role.");
      return;
    }

    setBusy(true);
    setErr("");
    setNotice("");
    try {
      // Clear stored reserve roles before the XI when a nomination changed, so
      // a player moving into the XI is never blocked by the previous nomination.
      for (const team of matchTeams) {
        const teamId = idOf(team);
        const current = selectionFor(teamId);
        const storedTwelfth = (detail?.twelfthMan || []).find((entry) => idOf(entry.team) === teamId);
        const storedSuperSub = (detail?.superSub || []).find((entry) => idOf(entry.team) === teamId);
        if (idOf(storedTwelfth?.player) && idOf(storedTwelfth?.player) !== current.twelfthMan) {
          await setMatchTwelfthMan(match._id, teamId, null);
        }
        if (idOf(storedSuperSub?.player) && idOf(storedSuperSub?.player) !== current.superSub) {
          await setMatchSuperSub(match._id, teamId, null);
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
        if (current.twelfthMan && idOf((detail?.twelfthMan || []).find((entry) => idOf(entry.team) === teamId)?.player) !== current.twelfthMan) {
          await setMatchTwelfthMan(match._id, teamId, current.twelfthMan);
        }
        if (current.superSub && idOf((detail?.superSub || []).find((entry) => idOf(entry.team) === teamId)?.player) !== current.superSub) {
          await setMatchSuperSub(match._id, teamId, current.superSub);
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
          const twelfthOptions = bench.filter((player) => idOf(player) !== current.superSub);
          const superSubOptions = bench.filter((player) => idOf(player) !== current.twelfthMan);
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

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field
                  label="12th Man (optional)"
                  hint="Outside the XI; not the Super Sub. Used by the swap rule."
                >
                  <select
                    aria-label={`${teamName(team)} 12th Man`}
                    value={current.twelfthMan}
                    onChange={(event) => chooseReserveRole(teamId, "twelfthMan", event.target.value)}
                    className={input}
                  >
                    <option value="">— None —</option>
                    {twelfthOptions.map((player) => (
                      <option key={idOf(player)} value={idOf(player)}>
                        {playerName(player)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label="Super Sub (optional)"
                  hint="Outside the XI; not the 12th Man. Stored separately; scoring is unchanged."
                >
                  <select
                    aria-label={`${teamName(team)} Super Sub`}
                    value={current.superSub}
                    onChange={(event) => chooseReserveRole(teamId, "superSub", event.target.value)}
                    className={input}
                  >
                    <option value="">— None —</option>
                    {superSubOptions.map((player) => (
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

/**
 * Owner-facing scorer picker. Candidates are the club's active members whose
 * roles grant score_match; the backend repeats that check on save. An empty
 * selection is meaningful — it restores the club-wide scoring rule.
 */
export function ScorerAssignmentPanel({ orgId, match, onClose, onSaved }) {
  const [members, setMembers] = useState([]);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr("");
    Promise.all([getMatchScorers(match._id), listOrgMembers(orgId, { limit: 200 })])
      .then(([assignment, roster]) => {
        if (!alive) return;
        const eligible = (Array.isArray(roster?.items) ? roster.items : []).filter(
          (row) => row.user && can(row.permissions || [], PERMISSIONS.SCORE_MATCH)
        );
        const assigned = (assignment?.assignedScorers || []).map(idOf);
        setMembers(eligible);
        setSelected(
          assigned.filter((id) => eligible.some((row) => idOf(row.user) === id))
        );
      })
      .catch((error) => {
        if (alive) setErr(error.message || "Could not load scorers");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [orgId, match._id]);

  const toggle = (userId) => {
    setSelected((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const save = async (ids) => {
    setSaving(true);
    setErr("");
    try {
      const response = await setMatchScorers(match._id, ids);
      onSaved?.(
        (response?.assignedScorers || []).length
          ? "Scorer assignment saved."
          : "Scorer assignment cleared. Anyone with scoring access can score."
      );
    } catch (error) {
      setErr(error.message || "Could not save the scorer assignment");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-3"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Assign scorers"
        data-testid="scorer-modal"
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-cric-border bg-cric-card shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-cric-border px-4 py-3">
          <div>
            <h3 className="text-sm font-black uppercase tracking-wide text-cric-text">Scorer</h3>
            <p className="mt-1 text-xs font-semibold text-cric-muted">
              Who may score this fixture?
            </p>
          </div>
          <button type="button" onClick={onClose} className={secondaryButton} aria-label="Close scorer picker">
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {err ? <Banner kind="error">{err}</Banner> : null}
          {loading ? (
            <p className="text-sm font-semibold text-cric-muted">Loading eligible scorers…</p>
          ) : (
            <>
              {selected.length === 0 ? (
                <p data-testid="scorer-unrestricted" className="rounded-lg bg-cric-bg px-3 py-2 text-xs font-bold text-cric-text">
                  Anyone with scoring access
                </p>
              ) : (
                <p className="rounded-lg bg-cric-bg px-3 py-2 text-xs font-bold text-cric-text">
                  Assigned: {members.filter((row) => selected.includes(idOf(row.user))).map((row) => row.user.name).join(", ")}
                </p>
              )}
              <p className="text-[11px] font-semibold text-cric-muted">
                No one selected means anyone with scoring access can score.
              </p>
              {members.length === 0 ? (
                <p className="text-sm font-semibold text-cric-muted">
                  No eligible members yet. Invite a Scorer from Members first.
                </p>
              ) : (
                <ul className="space-y-2" data-testid="scorer-candidates">
                  {members.map((row) => {
                    const userId = idOf(row.user);
                    return (
                      <li key={row._id || userId}>
                        <label className="flex min-h-11 items-center gap-3 rounded-lg border border-cric-border bg-cric-bg px-3 py-2 text-sm text-cric-text">
                          <input
                            type="checkbox"
                            aria-label={`assign ${row.user.name}`}
                            checked={selected.includes(userId)}
                            onChange={() => toggle(userId)}
                          />
                          <span className="min-w-0">
                            <span className="block truncate font-black">{row.user.name}</span>
                            <span className="block text-[10px] font-bold uppercase tracking-widest text-cric-muted">
                              {roleLabels(row.roles || [])}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>

        <div className="flex flex-wrap gap-2 border-t border-cric-border px-4 py-3">
          <button type="button" onClick={() => save(selected)} disabled={loading || saving} className={primaryButton}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={() => save([])} disabled={loading || saving} className={secondaryButton}>
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}

export function MatchForm({ orgId, teams, events = [], initial, seriesId, defaults, onDone, onCancel }) {
  const [form, setForm] = useState(() => ({ ...emptyMatch, ...(defaults || {}), ...(initial || {}) }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    if (!initial && form.teamA === form.teamB) {
      setErr("Pick two different teams");
      return;
    }
    const problem = oversProblem(form);
    if (problem) {
      setErr(problem);
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
          useAiCommentary: form.useAiCommentary === true,
          ...oversPayload(form, { clear: true }),
        };
        await updateOrgMatch(orgId, initial._id, Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined)));
        onDone();
      } else {
        const response = await createOrgMatch(orgId, {
          teams: [form.teamA, form.teamB],
          matchType: form.matchType,
          useAiCommentary: form.useAiCommentary === true,
          ...oversPayload(form),
          ...(seriesId ? { series: seriesId } : {}),
          ...(form.venue.trim() ? { venue: form.venue.trim() } : {}),
          ...(form.startAt ? { startAt: new Date(form.startAt).toISOString() } : {}),
          ...(form.eventId ? { eventId: form.eventId } : {}),
        });
        // Callers that immediately open the XI picker need the created match.
        onDone(response?.match || null);
      }
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
                  {MATCH_TYPE_LABELS[type] || type}
                </option>
              ))}
            </select>
          </Field>
          <OversFields form={form} set={set} />
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
                  {MATCH_TYPE_LABELS[type] || type}
                </option>
              ))}
            </select>
          </Field>
          <OversFields form={form} set={set} />
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
      <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
        <input
          type="checkbox"
          checked={form.useAiCommentary === true}
          onChange={(event) => setForm((f) => ({ ...f, useAiCommentary: event.target.checked }))}
        />
        Enable AI commentary (default OFF; applies to everyone scoring this match)
      </label>
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
  const [scorerFor, setScorerFor] = useState(null);
  const [notice, setNotice] = useState(null);
  const [err, setErr] = useState("");
  const [copiedOverlayId, setCopiedOverlayId] = useState("");

  const copyOverlayLink = useCallback(async (id) => {
    const url = `${window.location.origin}/overlay/${id}`;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const input = document.createElement("textarea");
        input.value = url;
        input.setAttribute("readonly", "");
        input.style.position = "absolute";
        input.style.left = "-9999px";
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
      }
      setCopiedOverlayId(String(id));
      window.setTimeout(() => setCopiedOverlayId((current) => (current === String(id) ? "" : current)), 2000);
    } catch {
      setErr("Could not copy overlay link.");
    }
  }, []);

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
                      {formatLabel(match)}
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
                    <button
                      type="button"
                      onClick={() => copyOverlayLink(match._id)}
                      className={secondaryButton}
                      title="Copy OBS browser source overlay link"
                    >
                      {copiedOverlayId === String(match._id) ? "OBS link copied" : "Copy OBS overlay link"}
                    </button>
                    {canManage ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setScorerFor(scorerFor?._id === match._id ? null : match)}
                          className={secondaryButton}
                        >
                          Scorer
                        </button>
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

                {scorerFor?._id === match._id ? (
                  <ScorerAssignmentPanel
                    orgId={orgId}
                    match={match}
                    onClose={() => setScorerFor(null)}
                    onSaved={(message) => {
                      setScorerFor(null);
                      setNotice({ kind: "success", text: message });
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
