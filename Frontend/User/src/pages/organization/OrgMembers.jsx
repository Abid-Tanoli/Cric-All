import React, { useCallback, useEffect, useState } from "react";
import {
  addOrgMember,
  listOrgMembers,
  removeOrgMember,
  transferOwnership,
  updateOrgMemberRoles,
} from "../../services/organizationApi";
import {
  ORG_ROLE_DESCRIPTIONS,
  ORG_ROLE_LABELS,
  PERMISSIONS,
  can,
  formatDate,
  grantableRoles,
  isOwner,
  roleLabel,
  roleLabels,
} from "../../lib/orgUi";
import { Banner, Field, card, cardSubtle, dangerButton, eyebrow, input, primaryButton, sectionTitle } from "./orgStyles";

const PAGE_SIZE = 20;

function RoleEditor({ member, grantable, canManage, isSelf, onSave, busy }) {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState(() => member.roles || []);

  // The draft is reset by remounting this component under a new key (see the
  // call site) rather than by an effect, so switching members or a save
  // refreshing `member.roles` can never leave a stale draft on screen.

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {(member.roles || []).map((role) => (
          <span key={role} className="rounded-full border border-cric-border bg-cric-bg px-2 py-1 text-[10px] font-black uppercase tracking-widest text-cric-text">
            {roleLabel(role)}
          </span>
        ))}
        {canManage && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-lg border border-cric-border bg-cric-bg px-3 py-2 text-[10px] font-black uppercase tracking-widest text-cric-muted hover:text-cric-text"
          >
            {isSelf ? "Edit my roles" : "Edit roles"}
          </button>
        )}
      </div>
    );
  }

  const toggle = (role) => {
    setSelected((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  };

  const save = async () => {
    if (selected.length === 0) return;
    await onSave(member, selected);
    setEditing(false);
  };

  return (
    <div className="w-full space-y-3">
      <div className="flex flex-wrap gap-2">
        {grantable.map((role) => (
          <button
            key={role}
            type="button"
            onClick={() => toggle(role)}
            title={ORG_ROLE_DESCRIPTIONS[role]}
            className={`rounded-lg border px-3 py-2 text-[10px] font-black uppercase tracking-widest transition ${
              selected.includes(role)
                ? "border-cric-accent bg-cric-accent text-white"
                : "border-cric-border bg-cric-bg text-cric-muted hover:text-cric-text"
            }`}
          >
            {ORG_ROLE_LABELS[role]}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={busy || selected.length === 0} className={primaryButton}>
          Save
        </button>
        <button
          type="button"
          onClick={() => {
            setSelected(member.roles || []);
            setEditing(false);
          }}
          className="rounded-lg border border-cric-border bg-cric-bg px-5 py-3 text-xs font-black uppercase tracking-widest text-cric-muted"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function OrgMembers({ orgId, access, currentUserId, onChanged }) {
  const [data, setData] = useState({ items: [], total: 0, page: 1, pages: 1 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [confirmTransfer, setConfirmTransfer] = useState(null);

  const [inviteAddress, setInviteAddress] = useState("");
  const [inviteRoles, setInviteRoles] = useState(["player"]);

  const permissions = access?.permissions || [];
  const roles = access?.roles || [];
  const canManage = can(permissions, PERMISSIONS.MANAGE_MEMBERS);
  const canInvite = can(permissions, PERMISSIONS.INVITE_MEMBERS);
  const callerIsOwner = isOwner(roles) || access?.isPlatformAdmin;
  const grantable = grantableRoles(access?.grantableRoles);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listOrgMembers(orgId, {
        page,
        limit: PAGE_SIZE,
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(roleFilter ? { role: roleFilter } : {}),
      });
      setData(res);
    } catch (error) {
      setErr(error.message || "Failed to load members");
    } finally {
      setLoading(false);
    }
  }, [orgId, page, search, roleFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn, successMessage) => {
    setBusy(true);
    setErr("");
    setNotice("");
    try {
      const result = await fn();
      if (successMessage) setNotice(typeof successMessage === "function" ? successMessage(result) : successMessage);
      await load();
      onChanged?.();
      return result;
    } catch (error) {
      setErr(error.message || "That action failed");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const addDirect = async (event) => {
    event.preventDefault();
    // One field, two shapes: anything with an "@" is treated as an email, the
    // rest is sent as a phone number for the server to normalize.
    const raw = inviteAddress.trim();
    const looksLikeEmail = raw.includes("@");
    const result = await run(
      () =>
        addOrgMember(orgId, {
          email: looksLikeEmail ? raw : "",
          phone: looksLikeEmail ? "" : raw,
          roles: inviteRoles,
        }),
      "Member added."
    );
    if (result) {
      setInviteAddress("");
      setInviteRoles(["player"]);
    }
  };

  const saveRoles = (member, nextRoles) =>
    run(
      () => updateOrgMemberRoles(orgId, member.user?._id, nextRoles),
      `${member.user?.name || "Member"} is now ${roleLabels(nextRoles)}.`
    );

  const doRemove = (member) =>
    run(
      () => removeOrgMember(orgId, member.user?._id),
      `${member.user?.name || "Member"} removed.`
    ).then((result) => {
      setConfirmRemove(null);
      return result;
    });

  const doTransfer = (member) =>
    run(
      () => transferOwnership(orgId, member.user?._id),
      `${member.user?.name || "Member"} is now the owner of this organization.`
    ).then((result) => {
      setConfirmTransfer(null);
      return result;
    });

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className={sectionTitle}>Members</h2>
            <p className="mt-1 text-xs font-semibold text-cric-muted">
              {data.total} active member{data.total === 1 ? "" : "s"} Â· a person can hold several roles
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search name, email or phone"
              className="w-56 rounded-lg border border-cric-border bg-cric-bg px-3 py-2 text-xs font-semibold text-cric-text focus:outline-none focus:border-cric-accent"
            />
            <select
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-cric-border bg-cric-bg px-3 py-2 text-[10px] font-black uppercase tracking-widest text-cric-text"
            >
              <option value="">All roles</option>
              {Object.keys(ORG_ROLE_LABELS).map((role) => (
                <option key={role} value={role}>
                  {ORG_ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {err ? <div className="mt-4"><Banner kind="error">{err}</Banner></div> : null}
        {notice ? <div className="mt-4"><Banner kind="success">{notice}</Banner></div> : null}

        <div className="mt-5 space-y-3">
          {loading ? (
            <p className="text-sm font-semibold text-cric-muted">Loading membersâ€¦</p>
          ) : data.items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-cric-border bg-cric-bg p-6 text-center">
              <p className="text-sm font-bold text-cric-text">No members match</p>
              <p className="mt-1 text-xs font-semibold text-cric-muted">
                Try clearing the search or role filter.
              </p>
            </div>
          ) : (
            data.items.map((member) => {
              const isSelf = member.user?._id === currentUserId;
              const memberIsOwner = (member.roles || []).includes("owner");
              return (
                <div key={member._id} className={cardSubtle}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-cric-text">
                        {member.user?.name || "Unknown user"}
                        {isSelf ? " (you)" : ""}
                      </p>
                      <p className="truncate text-[10px] font-bold uppercase tracking-wider text-cric-muted">
                        {member.user?.email ||
                          (member.user?.phone ? `+${member.user.phone}` : "no contact on file")}{" "}
                        · joined {formatDate(member.joinedAt || member.createdAt)}
                        {member.source ? ` · via ${member.source}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {canManage && !isSelf && !memberIsOwner && (
                        <button
                          type="button"
                          onClick={() => setConfirmTransfer(member)}
                          className="rounded-lg border border-cric-border bg-cric-bg px-3 py-2 text-[10px] font-black uppercase tracking-widest text-cric-muted hover:text-cric-text"
                        >
                          Make owner
                        </button>
                      )}
                      {canManage && !isSelf && (
                        <button
                          type="button"
                          onClick={() => setConfirmRemove(member)}
                          className={dangerButton}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mt-3">
                    <RoleEditor
                      key={`${member._id}:${(member.roles || []).join(",")}`}
                      member={member}
                      grantable={grantable}
                      canManage={canManage}
                      isSelf={isSelf}
                      busy={busy}
                      onSave={saveRoles}
                    />
                  </div>

                  {confirmRemove?._id === member._id && (
                    <div className="mt-3 rounded-xl border border-red-300 bg-red-50 p-4">
                      <p className="text-sm font-bold text-red-700">
                        Remove {member.user?.name}? Their roles on this organization end immediately.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={() => doRemove(member)}
                          disabled={busy}
                          className="rounded-lg bg-red-600 px-5 py-2 text-xs font-black uppercase tracking-widest text-white disabled:opacity-60"
                        >
                          Yes, remove
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRemove(null)}
                          className="rounded-lg border border-cric-border bg-white px-5 py-2 text-xs font-black uppercase tracking-widest text-cric-muted"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {confirmTransfer?._id === member._id && (
                    <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-4">
                      <p className="text-sm font-bold text-amber-900">
                        Transfer ownership to {member.user?.name}? You keep your account access and stay on
                        the member list as an admin.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={() => doTransfer(member)}
                          disabled={busy}
                          className="rounded-lg bg-amber-600 px-5 py-2 text-xs font-black uppercase tracking-widest text-white disabled:opacity-60"
                        >
                          Transfer ownership
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmTransfer(null)}
                          className="rounded-lg border border-cric-border bg-white px-5 py-2 text-xs font-black uppercase tracking-widest text-cric-muted"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {data.pages > 1 && (
          <div className="mt-5 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="rounded-lg border border-cric-border bg-cric-bg px-4 py-2 text-[10px] font-black uppercase tracking-widest text-cric-muted disabled:opacity-50"
            >
              Previous
            </button>
            <p className={eyebrow}>
              Page {data.page} of {data.pages}
            </p>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
              disabled={page >= data.pages || loading}
              className="rounded-lg border border-cric-border bg-cric-bg px-4 py-2 text-[10px] font-black uppercase tracking-widest text-cric-muted disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {canInvite && (
        <form onSubmit={addDirect} className={card}>
          <h2 className={sectionTitle}>Add an existing account</h2>
          <p className="mt-1 text-xs font-semibold text-cric-muted">
            This joins somebody immediately, so the address must already have a CricAll account with a
            verified email or phone number. For anybody else use the Invitations tab.
          </p>

          <div className="mt-4 grid gap-4 md:grid-cols-[1fr_2fr_auto] md:items-end">
            <Field label="Account email or phone *" hint="Contains @ means email; anything else is read as a phone number.">
              <input
                type="text"
                value={inviteAddress}
                onChange={(e) => setInviteAddress(e.target.value)}
                placeholder="teammate@example.com or 0300 1234567"
                className={input}
                required
              />
            </Field>
            <Field label="Roles" hint={inviteRoles.map(roleLabel).join(", ")}>
              <div className="flex flex-wrap gap-2">
                {grantable
                  .filter((role) => role !== "owner")
                  .map((role) => (
                    <button
                      key={role}
                      type="button"
                      onClick={() =>
                        setInviteRoles((prev) =>
                          prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
                        )
                      }
                      title={ORG_ROLE_DESCRIPTIONS[role]}
                      className={`rounded-lg border px-3 py-2 text-[10px] font-black uppercase tracking-widest transition ${
                        inviteRoles.includes(role)
                          ? "border-cric-accent bg-cric-accent text-white"
                          : "border-cric-border bg-cric-bg text-cric-muted hover:text-cric-text"
                      }`}
                    >
                      {ORG_ROLE_LABELS[role]}
                    </button>
                  ))}
              </div>
            </Field>
            <button type="submit" disabled={busy || !inviteAddress.trim() || inviteRoles.length === 0} className={primaryButton}>
              {busy ? "Addingâ€¦" : "Add member"}
            </button>
          </div>

          {!callerIsOwner && (
            <p className="mt-3 text-[10px] font-semibold text-cric-muted">
              Only an owner can grant the owner or admin role.
            </p>
          )}
        </form>
      )}
    </div>
  );
}
