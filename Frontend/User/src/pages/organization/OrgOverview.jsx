import React, { useEffect, useState } from "react";
import { getOrgOverview, listOrgAuditLog } from "../../services/organizationApi";
import {
  ORG_ROLE_DESCRIPTIONS,
  PERMISSION_LABELS,
  PERMISSIONS,
  can,
  formatDateTime,
  isOwner,
  roleLabel,
  verificationStyles,
} from "../../lib/orgUi";
import { Banner, Stat, card, cardSubtle, eyebrow, sectionTitle } from "./orgStyles";

const AUDIT_ACTIONS = {
  "org.created": "Organization created",
  "org.updated": "Details updated",
  "org.ownership_transferred": "Ownership transferred",
  "membership.added": "Member added",
  "membership.roles_changed": "Roles changed",
  "membership.removed": "Member removed",
  "invitation.created": "Invitation sent",
  "invitation.accepted": "Invitation accepted",
  "invitation.rejected": "Invitation declined",
  "invitation.revoked": "Invitation revoked",
};

export default function OrgOverview({ org, access, onGoToTab }) {
  // Every field is tagged with the organization it was fetched for, so switching
  // organizations renders a loading state rather than the previous org's numbers.
  // That is why there is no "reset the state" effect here: the reset is derived.
  const [loaded, setLoaded] = useState({ orgId: null, overview: null, audit: [], err: "" });

  const permissions = access?.permissions || [];
  const roles = access?.roles || [];
  const canSeeAudit = can(permissions, PERMISSIONS.MANAGE_ORG);

  useEffect(() => {
    let cancelled = false;
    getOrgOverview(org._id)
      .then((res) => {
        if (cancelled) return;
        setLoaded((prev) => ({ ...prev, orgId: org._id, overview: res, err: "" }));
      })
      .catch((error) => {
        if (cancelled) return;
        setLoaded({
          orgId: org._id,
          overview: null,
          audit: [],
          err: error.message || "Failed to load the overview",
        });
      });

    if (canSeeAudit) {
      listOrgAuditLog(org._id, { limit: 10 })
        .then((res) => {
          if (cancelled) return;
          setLoaded((prev) => ({ ...prev, audit: res.items || [] }));
        })
        .catch(() => {
          // The activity feed is supplementary; a failure here must not blank
          // the whole dashboard.
        });
    }

    return () => {
      cancelled = true;
    };
  }, [org._id, canSeeAudit]);

  const stale = loaded.orgId !== org._id;
  const overview = stale ? null : loaded.overview;
  const audit = stale ? [] : loaded.audit;
  const err = stale ? "" : loaded.err;

  return (
    <div className="space-y-4">
      {err ? <Banner kind="error">{err}</Banner> : null}

      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className={sectionTitle}>{org.name}</h2>
            <p className="mt-1 text-xs font-semibold text-cric-muted">
              {org.shortName ? `${org.shortName} · ` : ""}
              {org.category?.name || "Uncategorised"}
              {org.slug ? ` · /${org.slug}` : ""}
            </p>
            {org.description ? (
              <p className="mt-3 max-w-2xl text-sm font-semibold leading-relaxed text-cric-muted">
                {org.description}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-widest ${
                verificationStyles[org.verificationStatus] || verificationStyles.unverified
              }`}
            >
              {org.verificationStatus || "unverified"}
            </span>
            {org.isActive === false && (
              <span className="rounded-full border border-red-300 bg-red-50 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-red-700">
                Deactivated by platform
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Members" value={overview?.memberCount ?? "—"} />
        <Stat label="Teams" value={overview?.teamCount ?? "—"} />
        <Stat label="Owners" value={overview?.ownerCount ?? "—"} />
        <Stat label="Pending invites" value={overview?.pendingInvitations ?? "—"} />
      </div>

      <div className={card}>
        <h2 className={sectionTitle}>Your access</h2>
        {access?.isPlatformAdmin && (
          <p className="mt-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-900">
            You are viewing this organization as a CricAll platform admin. Your access is supervisory and
            is recorded in the organization audit log.
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {(access?.roles || []).length === 0 ? (
            <p className="text-sm font-semibold text-cric-muted">No organization role.</p>
          ) : (
            access.roles.map((role) => (
              <span
                key={role}
                title={ORG_ROLE_DESCRIPTIONS[role]}
                className="rounded-full border border-cric-accent bg-cric-accent/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-cric-accent"
              >
                {roleLabel(role)}
              </span>
            ))
          )}
        </div>

        <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Object.keys(PERMISSION_LABELS).map((permission) => {
            const granted = permissions.includes(permission);
            return (
              <div
                key={permission}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[10px] font-black uppercase tracking-widest ${
                  granted
                    ? "border-green-300 bg-green-50 text-green-800"
                    : "border-cric-border bg-cric-bg text-cric-muted opacity-60"
                }`}
              >
                <span aria-hidden="true">{granted ? "✓" : "—"}</span>
                {PERMISSION_LABELS[permission]}
              </div>
            );
          })}
        </div>

        {!isOwner(roles) && (
          <p className={`mt-4 ${eyebrow}`}>
            Ownership is transferred, never self-granted — an owner does this from the Members tab.
          </p>
        )}
      </div>

      {can(permissions, PERMISSIONS.MANAGE_TEAMS) && (
        <button
          type="button"
          onClick={() => onGoToTab("teams")}
          className="w-full rounded-2xl border border-cric-border bg-cric-card p-6 text-left shadow-sm transition hover:border-cric-accent/40"
        >
          <p className={eyebrow}>Teams</p>
          <p className="mt-1 text-sm font-black text-cric-text">
            Manage the teams that belong to this organization →
          </p>
        </button>
      )}

      {canSeeAudit && (
        <div className={card}>
          <h2 className={sectionTitle}>Recent activity</h2>
          <p className="mt-1 text-xs font-semibold text-cric-muted">
            Every membership, role and invitation change is recorded.
          </p>
          {audit.length === 0 ? (
            <p className="mt-4 text-sm font-semibold text-cric-muted">Nothing recorded yet.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {audit.map((entry) => (
                <li key={entry._id} className={cardSubtle}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-black text-cric-text">
                      {AUDIT_ACTIONS[entry.action] || entry.action}
                    </p>
                    <p className={eyebrow}>{formatDateTime(entry.createdAt)}</p>
                  </div>
                  <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-cric-muted">
                    by {entry.actorLabel || entry.actorType || "system"}
                    {entry.targetLabel ? ` · ${entry.targetLabel}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
