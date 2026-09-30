import React, { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import {
  getMyOrgAccess,
  acceptInvitationById,
  listMyInvitations,
  listMyOrganizations,
  listOrgEvents,
  rejectInvitationById,
} from "../services/organizationApi";
import { useStoredUser, notifyMembershipChanged } from "./auth/auth";
import { PERMISSIONS, can, formatDate, roleLabel } from "../lib/orgUi";
import { Banner, card, eyebrow, primaryButton, secondaryButton } from "./organization/orgStyles";
import OrgOverview from "./organization/OrgOverview";
import OrgMembers from "./organization/OrgMembers";
import OrgInvitations from "./organization/OrgInvitations";
import OrgSettings from "./organization/OrgSettings";
import OrgTeams from "./organization/OrgTeams";
import OrgMatches from "./organization/OrgMatches";
import OrgEvents from "./organization/OrgEvents";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "members", label: "Members" },
  { id: "invitations", label: "Invitations" },
  { id: "teams", label: "Teams", permission: PERMISSIONS.MANAGE_TEAMS },
  { id: "matches", label: "Matches", permission: PERMISSIONS.CREATE_MATCH },
  { id: "events", label: "Events", permission: PERMISSIONS.CREATE_MATCH },
  { id: "settings", label: "Settings", permission: PERMISSIONS.MANAGE_ORG },
];

/**
 * One row of the signed-in user's invitation inbox. Accepting and declining are
 * inline so the invitee never has to find the email to act on the invitation.
 */
function InboxRow({ invitation, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const act = async (fn) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      onDone();
    } catch (err) {
      setError(err.message || "That did not work");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-bold text-amber-900">
          {invitation.inviter?.name || "Somebody"} invited you to join{" "}
          <strong>{invitation.organization?.name}</strong> as{" "}
          {(invitation.roles || []).map(roleLabel).join(", ")} · expires {formatDate(invitation.expiresAt)}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() =>
              act(async () => {
                const res = await acceptInvitationById(invitation._id);
                // Accepting makes this account a member of that organization,
                // which the header caches per signed-in session.
                notifyMembershipChanged();
                return res;
              })
            }
            disabled={busy}
            className="rounded-lg bg-amber-600 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-60"
          >
            Accept
          </button>
          <button
            type="button"
            onClick={() => act(() => rejectInvitationById(invitation._id))}
            disabled={busy}
            className="rounded-lg border border-amber-400 bg-white px-4 py-2 text-[10px] font-black uppercase tracking-widest text-amber-800 disabled:opacity-60"
          >
            Decline
          </button>
        </div>
      </div>
      {invitation.message ? (
        <p className="mt-1 text-xs font-semibold italic text-amber-800">“{invitation.message}”</p>
      ) : null}
      {error ? <p className="mt-1 text-xs font-bold text-red-700">{error}</p> : null}
    </div>
  );
}

export default function MyOrganization() {
  const storedUser = useStoredUser();
  const [searchParams, setSearchParams] = useSearchParams();

  const [orgs, setOrgs] = useState([]);
  const [activeId, setActiveId] = useState(searchParams.get("org") || null);
  const [access, setAccess] = useState(null);
  const [inbox, setInbox] = useState([]);
  // One fetch, two consumers: the Matches tab files a fixture inside an event,
  // and the Events tab manages them. Two components fetching the same list is how
  // the two views start disagreeing about what exists.
  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState("");
  const [tab, setTab] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [accessLoading, setAccessLoading] = useState(false);
  const [err, setErr] = useState("");

  const loadOrgs = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const list = await listMyOrganizations();
      const items = Array.isArray(list) ? list : [];
      setOrgs(items);
      setActiveId((current) => (current && items.some((o) => o._id === current) ? current : items[0]?._id || null));
    } catch (error) {
      setErr(error.message || "Failed to load your organizations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!storedUser) return;
    loadOrgs();
    listMyInvitations()
      .then((res) => setInbox(Array.isArray(res) ? res : []))
      .catch(() => setInbox([]));
  }, [storedUser, loadOrgs]);

  const active = orgs.find((org) => org._id === activeId) || null;

  // Access is fetched per organization: it is the only source of truth for what
  // this user may do here, and the tab list is derived from it.
  useEffect(() => {
    if (!active) {
      setAccess(null);
      return;
    }
    let cancelled = false;
    setAccessLoading(true);
    getMyOrgAccess(active._id)
      .then((res) => {
        if (!cancelled) setAccess(res);
      })
      .catch((error) => {
        if (!cancelled) {
          setAccess(null);
          setErr(error.message || "Failed to load your access to this organization");
        }
      })
      .finally(() => {
        if (!cancelled) setAccessLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `active` is read only for its id below; depending on the id is what makes
    // this re-run for the right organization without refetching on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?._id]);

  // An org change is shareable: keep it in the URL.
  useEffect(() => {
    if (activeId && searchParams.get("org") !== activeId) {
      setSearchParams({ org: activeId }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const loadEvents = useCallback(async (orgId) => {
    if (!orgId) {
      setEvents([]);
      return;
    }
    setEventsLoading(true);
    setEventsError("");
    try {
      const res = await listOrgEvents(orgId);
      setEvents(Array.isArray(res?.items) ? res.items : []);
    } catch (error) {
      setEvents([]);
      setEventsError(error.message || "Failed to load this organization's events");
    } finally {
      setEventsLoading(false);
    }
  }, []);

  // Events are read for the Matches and Events tabs, so they are fetched with
  // the organization rather than when a tab happens to be open. A member without
  // create_match never sees either tab, and a 403 there would be noise.
  const canViewFixtures = can(access?.permissions || [], PERMISSIONS.CREATE_MATCH);
  useEffect(() => {
    if (!activeId) return;
    if (!canViewFixtures) {
      setEvents([]);
      return;
    }
    loadEvents(activeId);
  }, [activeId, canViewFixtures, loadEvents]);

  if (!storedUser) return <Navigate to="/login?next=/organization" replace />;

  const permissions = access?.permissions || [];
  const visibleTabs = TABS.filter((entry) => !entry.permission || can(permissions, entry.permission));
  // Switching organization can invalidate the open tab: the same person may be an
  // owner in one club and a plain member of another. Derived at render rather
  // than reset in an effect, so the panel never mounts with an org it has no
  // permission in (the server would 403, but the user would just see errors).
  const activeTab = visibleTabs.some((entry) => entry.id === tab) ? tab : "overview";

  const selectTab = (next) => {
    setTab(next);
    setErr("");
  };

  return (
    <div className="min-h-screen bg-cric-bg px-4 py-8 text-cric-text">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className={card}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className={eyebrow}>Organization dashboard</p>
              <h1 className="mt-1 text-2xl font-black uppercase tracking-tight">My organizations</h1>
            </div>
            <Link to="/organization/new" className={primaryButton}>
              + New organization
            </Link>
          </div>

          {inbox.length > 0 && (
            <div className="mt-4 space-y-2">
              {inbox.map((inv) => (
                <InboxRow
                  key={inv._id}
                  invitation={inv}
                  onDone={() => {
                    setInbox((prev) => prev.filter((item) => item._id !== inv._id));
                    loadOrgs();
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {err ? <Banner kind="error">{err}</Banner> : null}

        {loading ? (
          <div className={card}>
            <p className="text-sm font-semibold text-cric-muted">Loading your organizations…</p>
          </div>
        ) : orgs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-cric-border bg-cric-card p-10 text-center shadow-sm">
            <p className="text-sm font-black text-cric-text">You do not belong to any organization yet</p>
            <p className="mt-2 text-xs font-semibold text-cric-muted">
              Create one and become its owner instantly, or wait for an invitation from somebody who
              already runs one.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link to="/organization/new" className={primaryButton}>
                Create an organization
              </Link>
              {inbox.length > 0 ? (
                <Link to="/organization" className={secondaryButton}>
                  Review my invitations
                </Link>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            {orgs.length > 1 && (
              <div className="flex flex-wrap gap-2">
                {orgs.map((org) => (
                  <button
                    key={org._id}
                    type="button"
                    onClick={() => setActiveId(org._id)}
                    className={`rounded-lg border px-4 py-2 text-[10px] font-black uppercase tracking-widest transition-all ${
                      active?._id === org._id
                        ? "border-cric-accent bg-cric-accent text-white"
                        : "border-cric-border bg-cric-bg text-cric-muted hover:text-cric-text"
                    }`}
                  >
                    {org.name}
                    {org.memberCount ? ` · ${org.memberCount}` : ""}
                  </button>
                ))}
              </div>
            )}

            {active && (
              <>
                <div className="flex flex-wrap gap-2 border-b border-cric-border pb-2">
                  {visibleTabs.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => selectTab(entry.id)}
                      className={`rounded-lg px-4 py-2 text-[10px] font-black uppercase tracking-widest transition-all ${
                        activeTab === entry.id
                          ? "bg-cric-accent text-white"
                          : "border border-cric-border bg-cric-bg text-cric-muted hover:text-cric-text"
                      }`}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>

                {accessLoading && !access ? (
                  <div className={card}>
                    <p className="text-sm font-semibold text-cric-muted">Loading…</p>
                  </div>
                ) : (
                  <>
                    {activeTab === "overview" && (
                      <OrgOverview org={active} access={access} onGoToTab={selectTab} />
                    )}
                    {activeTab === "members" && (
                      <OrgMembers
                        orgId={active._id}
                        access={access}
                        currentUserId={storedUser?._id}
                        onChanged={loadOrgs}
                      />
                    )}
                    {activeTab === "invitations" && <OrgInvitations orgId={active._id} access={access} />}
                    {activeTab === "teams" && (
                      <OrgTeams
                        orgId={active._id}
                        org={active}
                        access={access}
                        onChanged={loadOrgs}
                      />
                    )}
                    {activeTab === "matches" && (
                      <OrgMatches
                        orgId={active._id}
                        events={events}
                        onChanged={() => loadEvents(active._id)}
                      />
                    )}
                    {activeTab === "events" && (
                      <OrgEvents
                        orgId={active._id}
                        events={events}
                        loading={eventsLoading}
                        error={eventsError}
                        onChanged={() => loadEvents(active._id)}
                      />
                    )}
                    {activeTab === "settings" && (
                      <OrgSettings
                        key={`${active._id}:${active.updatedAt || ""}`}
                        org={active}
                        access={access}
                        onSaved={(updated) =>
                          setOrgs((prev) => prev.map((o) => (o._id === updated._id ? { ...o, ...updated } : o)))
                        }
                        onDeleted={() => {
                          setActiveId(null);
                          loadOrgs();
                        }}
                      />
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
