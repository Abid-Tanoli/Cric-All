import React, { useCallback, useEffect, useState } from "react";
import RequestDeletionButton from "../../components/RequestDeletionButton";
import { PERMISSIONS, can, formatDate } from "../../lib/orgUi";
import { competitionErrorMessage } from "../../lib/orgCompetitions";
import {
  createOrgSeries,
  createOrgTournament,
  listOrgSeries,
  listOrgTeamsManaged,
  listOrgTournaments,
  updateOrgSeries,
} from "../../services/organizationApi";
import { SeriesForm, TournamentForm } from "./CompetitionForms";
import OrgTournamentDetail from "./OrgTournamentDetail";
import {
  Banner,
  card,
  cardSubtle,
  eyebrow,
  primaryButton,
  secondaryButton,
  sectionTitle,
} from "./orgStyles";

const itemsOf = (response) =>
  Array.isArray(response) ? response : Array.isArray(response?.items) ? response.items : [];

const teamCount = (competition) => (competition.teams || []).length;

function CompetitionCard({ orgId, competition, kind, canManage, onOpen, onEdit }) {
  const label = kind === "tournament" ? "Tournament" : "Series";
  return (
    <div className={cardSubtle}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-black uppercase tracking-wide">{competition.name}</p>
          <p className="mt-1 text-xs font-semibold text-cric-muted">
            {label} · {competition.format || competition.matchType || "—"} ·{" "}
            {teamCount(competition)} team{teamCount(competition) === 1 ? "" : "s"}
            {competition.venue ? ` · ${competition.venue}` : ""}
          </p>
          <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-cric-muted">
            {formatDate(competition.startDate)} – {formatDate(competition.endDate)} ·{" "}
            {competition.status || "upcoming"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {kind === "tournament" ? (
            <button type="button" onClick={onOpen} className={secondaryButton}>
              Manage
            </button>
          ) : null}
          {canManage ? (
            <>
              <button type="button" onClick={onEdit} className={secondaryButton}>
                Edit
              </button>
              <RequestDeletionButton
                orgId={orgId}
                targetType={kind}
                targetId={competition._id}
                subject={`Delete ${kind}: ${competition.name}`}
                label={`Request ${kind} deletion`}
              />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function OrgCompetitions({ orgId, access, onChanged }) {
  const [tournaments, setTournaments] = useState([]);
  const [series, setSeries] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState(null);
  const [creating, setCreating] = useState(null);
  const [editingSeries, setEditingSeries] = useState(null);
  const [openTournamentId, setOpenTournamentId] = useState(null);

  const canManage = can(access?.permissions || [], PERMISSIONS.MANAGE_COMPETITIONS);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setErr("");
    try {
      const [tournamentResponse, seriesResponse, teamResponse] = await Promise.all([
        listOrgTournaments(orgId),
        listOrgSeries(orgId),
        listOrgTeamsManaged(orgId).catch(() => []),
      ]);
      setTournaments(itemsOf(tournamentResponse));
      setSeries(itemsOf(seriesResponse));
      setTeams(itemsOf(teamResponse));
    } catch (error) {
      setErr(competitionErrorMessage(error, "Could not load your competitions."));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = () => {
    load();
    onChanged?.();
  };

  const createTournament = async (payload) => {
    await createOrgTournament(orgId, payload);
    setCreating(null);
    setNotice({ kind: "success", text: "Tournament created." });
    refresh();
  };

  const createSeries = async (payload) => {
    await createOrgSeries(orgId, payload);
    setCreating(null);
    setNotice({ kind: "success", text: "Series created." });
    refresh();
  };

  const saveSeries = async (payload) => {
    await updateOrgSeries(orgId, editingSeries._id, payload);
    setEditingSeries(null);
    setNotice({ kind: "success", text: "Series updated." });
    refresh();
  };

  if (openTournamentId) {
    return (
      <OrgTournamentDetail
        orgId={orgId}
        tournamentId={openTournamentId}
        access={access}
        ownTeams={teams}
        onClose={() => setOpenTournamentId(null)}
        onChanged={refresh}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className={eyebrow}>Competitions</p>
            <h2 className={sectionTitle}>Tournaments &amp; series</h2>
            <p className="mt-1 text-xs font-semibold text-cric-muted">
              Tournaments and series your organization owns. Owners and managers can enter teams,
              build fixtures, keep squads, points and awards.
            </p>
          </div>
          {canManage ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setCreating(creating === "tournament" ? null : "tournament");
                  setEditingSeries(null);
                }}
                className={primaryButton}
              >
                {creating === "tournament" ? "Close" : "+ New tournament"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreating(creating === "series" ? null : "series");
                  setEditingSeries(null);
                }}
                className={secondaryButton}
              >
                {creating === "series" ? "Close" : "+ New series"}
              </button>
            </div>
          ) : (
            <Banner kind="info">
              You can follow these competitions, but only an owner or manager can change them.
            </Banner>
          )}
        </div>

        {creating === "tournament" && canManage ? (
          <div className="mt-4 border-t border-cric-border pt-4">
            <TournamentForm
              availableTeams={teams}
              onSave={createTournament}
              onCancel={() => setCreating(null)}
            />
          </div>
        ) : null}

        {creating === "series" && canManage ? (
          <div className="mt-4 border-t border-cric-border pt-4">
            <SeriesForm
              availableTeams={teams}
              onSave={createSeries}
              onCancel={() => setCreating(null)}
            />
          </div>
        ) : null}

        {editingSeries && canManage ? (
          <div className="mt-4 border-t border-cric-border pt-4">
            <SeriesForm
              initial={editingSeries}
              availableTeams={teams}
              onSave={saveSeries}
              onCancel={() => setEditingSeries(null)}
            />
          </div>
        ) : null}
      </div>

      {err ? <Banner kind="error">{err}</Banner> : null}
      {notice ? <Banner kind={notice.kind}>{notice.text}</Banner> : null}

      {loading ? (
        <div className={card}>
          <p className="text-sm font-semibold text-cric-muted">Loading competitions…</p>
        </div>
      ) : (
        <>
          <div className={card}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className={eyebrow}>Tournaments</p>
                <h3 className={`${sectionTitle} mt-1`}>Owned tournaments ({tournaments.length})</h3>
              </div>
              {canManage ? (
                <button
                  type="button"
                  onClick={() => {
                    setCreating("tournament");
                    setEditingSeries(null);
                  }}
                  className={secondaryButton}
                >
                  + New tournament
                </button>
              ) : null}
            </div>
            {tournaments.length === 0 ? (
              <p className="mt-3 text-xs font-semibold text-cric-muted">
                No tournaments yet.
                {canManage ? " Create one above to start entering teams and fixtures." : ""}
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {tournaments.map((tournament) => (
                  <CompetitionCard
                    orgId={orgId}
                    key={tournament._id}
                    competition={tournament}
                    kind="tournament"
                    canManage={canManage}
                    onOpen={() => setOpenTournamentId(tournament._id)}
                    onEdit={() => setOpenTournamentId(tournament._id)}
                  />
                ))}
              </div>
            )}
          </div>

          <div className={card}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className={eyebrow}>Series</p>
                <h3 className={`${sectionTitle} mt-1`}>Owned series ({series.length})</h3>
              </div>
              {canManage ? (
                <button
                  type="button"
                  onClick={() => {
                    setCreating("series");
                    setEditingSeries(null);
                  }}
                  className={secondaryButton}
                >
                  + New series
                </button>
              ) : null}
            </div>
            {series.length === 0 ? (
              <p className="mt-3 text-xs font-semibold text-cric-muted">
                No series yet.
                {canManage ? " Create one above and pick the teams taking part." : ""}
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {series.map((entry) => (
                  <CompetitionCard
                    orgId={orgId}
                    key={entry._id}
                    competition={entry}
                    kind="series"
                    canManage={canManage}
                    onEdit={() => {
                      setCreating(null);
                      setEditingSeries(entry);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
