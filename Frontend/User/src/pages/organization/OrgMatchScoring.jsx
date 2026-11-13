import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, NavLink, useNavigate, useParams } from "react-router-dom";
import { API_BASE_URL } from "../../../../Shared/config/env.js";
import { ScoringAdaptersProvider } from "../../../../Shared/scoring/ScoringAdapters";
import SharedManageScore from "../../../../Shared/scoring/ManageScore";
import ScoringConfirmModal from "../../../../Shared/scoring/components/ScoringConfirmModal";
import { TAB_ROUTE_BY_ID } from "../../../../Shared/scoring/components/ScoreManagement/constants";
import { getMyOrgAccess, getMatchDetail, listOrgMatches } from "../../services/organizationApi";
import { api } from "../../services/api";
import IssueReportButton from "../../components/IssueReportButton";
import { initSocket, joinMatchRoom, leaveMatchRoom } from "../../services/socket";
import { PERMISSIONS, can } from "../../lib/orgUi";

const idOf = (value) => String(value?._id || value || "");

function AccessMessage({ title, children, orgId }) {
  return (
    <div className="min-h-[65vh] bg-cric-bg px-4 py-10 text-cric-text">
      <div className="mx-auto max-w-xl rounded-2xl border border-cric-border bg-cric-card p-6 text-center shadow-sm sm:p-10">
        <h1 className="text-2xl font-black">{title}</h1>
        <p className="mt-3 text-sm font-semibold text-cric-muted">{children}</p>
        <Link
          to={`/organization?org=${orgId}`}
          className="mt-6 inline-flex min-h-12 items-center justify-center rounded-xl bg-cric-accent px-6 py-3 text-sm font-black text-white"
        >
          Back to organization
        </Link>
      </div>
    </div>
  );
}

export default function OrgMatchScoring() {
  const { orgId, matchId, tab } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [access, setAccess] = useState(null);
  const [orgMatches, setOrgMatches] = useState([]);
  const [matchDetail, setMatchDetail] = useState(null);
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const organizationAccess = await getMyOrgAccess(orgId);
        if (!active) return;
        if (!can(organizationAccess?.permissions || [], PERMISSIONS.SCORE_MATCH)) {
          setAccess(organizationAccess);
          setLoading(false);
          return;
        }

        const response = await listOrgMatches(orgId);
        const matches = Array.isArray(response?.items) ? response.items : [];
        const target = matches.find((item) => idOf(item) === String(matchId));
        if (!target) {
          setAccess(organizationAccess);
          setOrgMatches([]);
          setLoading(false);
          return;
        }
        const detail = await getMatchDetail(matchId);
        const detailOrgId = idOf(detail.organizationRef);
        if (detailOrgId && detailOrgId !== String(orgId)) {
          setAccess(organizationAccess);
          setOrgMatches([]);
          setLoading(false);
          return;
        }
        if (!active) return;
        setAccess(organizationAccess);
        setOrgMatches(matches);
        setMatchDetail(detail);
      } catch (loadError) {
        if (active) setError(loadError.message || "Could not load this organization match.");
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [orgId, matchId]);

  const permissions = access?.permissions || [];
  const canScore = can(permissions, PERMISSIONS.SCORE_MATCH);
  const canSetup = can(permissions, PERMISSIONS.CREATE_MATCH);
  const matchAllowed = useMemo(() => {
    const ids = new Set(orgMatches.map((item) => idOf(item)));
    return (match) => {
      const matchIdValue = idOf(match);
      if (!ids.has(matchIdValue)) return false;
      const organizationId = idOf(match?.organizationRef);
      return !organizationId || organizationId === String(orgId);
    };
  }, [orgMatches, orgId]);

  const showToast = useCallback((message, type = "info") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current.slice(-2), { id, message, type }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4000);
  }, []);

  const adapters = useMemo(() => ({
    api,
    apiBaseUrl: API_BASE_URL,
    getToken: () => localStorage.getItem("bq_token") || localStorage.getItem("token"),
    socket: initSocket(),
    joinMatchRoom,
    leaveMatchRoom,
    showToast,
    navigate,
    LinkComponent: NavLink,
    buildScorePath: (id, tabId) => {
      const route = TAB_ROUTE_BY_ID[tabId] || "";
      return `/organization/${orgId}/matches/${id}/score/${route || "live"}`;
    },
    buildScoreListPath: () => `/organization?org=${orgId}`,
    buildEventsPath: () => `/organization?org=${orgId}`,
    buildPublicMatchPath: (id) => `/match/${id}`,
    fetchMatches: async () => orgMatches,
    isMatchAllowed: matchAllowed,
    allowSettings: false,
    allowDeleteMatch: false,
    allowFormatEdit: false,
    allowRuleEdit: false,
    allowSquadSetup: canSetup,
    ConfirmModal: ScoringConfirmModal,
  }), [orgId, orgMatches, matchAllowed, canSetup, navigate]);

  if (loading) {
    return <div className="flex min-h-[65vh] items-center justify-center bg-cric-bg text-sm font-bold text-cric-muted">Checking match access…</div>;
  }
  if (error) {
    return <AccessMessage orgId={orgId} title="Could not open match">{error}</AccessMessage>;
  }
  if (!canScore) {
    return (
      <AccessMessage orgId={orgId} title="No scoring access">
        You need the organization’s Score Match permission to score this fixture. Ask an organization owner or admin to grant access.
      </AccessMessage>
    );
  }
  if (!matchAllowed({ _id: matchId })) {
    return (
      <AccessMessage orgId={orgId} title="Match unavailable">
        This match is not in this organization’s fixture list, or you no longer have access to it.
      </AccessMessage>
    );
  }

  const selected = matchDetail;
  const hasTwoXIs = (selected?.teams || []).length === 2 && selected.teams.every((team) => {
    const xi = (selected.playingXI || []).find((entry) => idOf(entry.team) === idOf(team));
    return (xi?.players || []).length === 11;
  });
  const hasToss = Boolean(idOf(selected?.tossWinner));
  const currentInnings = selected?.innings?.[selected?.currentInnings || 0];
  const hasOpeners = Boolean(currentInnings?.currentBatsman1 && currentInnings?.currentBatsman2 && currentInnings?.currentBowler);
  const setupNeeded = ["upcoming", "scheduled"].includes(selected?.status) && (!hasTwoXIs || !hasToss || !hasOpeners);
  if (!canSetup && setupNeeded) {
    return (
      <AccessMessage orgId={orgId} title="Match setup needed">
        The Playing XI, toss and opening players must be set by an organization owner or admin before you can score. Ask them to finish setup, then return here.
      </AccessMessage>
    );
  }

  return (
    <ScoringAdaptersProvider value={adapters}>
      <div className="min-h-screen max-w-full overflow-x-hidden bg-cric-bg">
        <div className="flex justify-end px-3 pt-3">
          <IssueReportButton
            orgId={orgId}
            targetType="match"
            targetId={matchId}
            initialSubject={`Issue with ${selected?.title || "this match"}`}
          />
        </div>
        <SharedManageScore matchId={matchId} tabId={tab || "live"} />
        <div className="fixed right-3 top-3 z-[10000] flex max-w-sm flex-col gap-2" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} role="status" className={`rounded-xl border px-4 py-3 text-sm font-bold shadow-lg ${toast.type === "error" ? "border-red-300 bg-red-50 text-red-800" : "border-cric-border bg-cric-card text-cric-text"}`}>
              {toast.message}
            </div>
          ))}
        </div>
      </div>
    </ScoringAdaptersProvider>
  );
}
