import React, { useCallback, useEffect, useState } from "react";
import { createOrgInvitation, listOrgInvitations, revokeOrgInvitation } from "../../services/organizationApi";
import {
  ORG_ROLE_DESCRIPTIONS,
  ORG_ROLE_LABELS,
  PERMISSIONS,
  can,
  daysUntil,
  formatDate,
  grantableRoles,
  invitationStatusStyles,
  roleLabel,
} from "../../lib/orgUi";
import { Banner, Field, card, cardSubtle, dangerButton, eyebrow, input, primaryButton, sectionTitle } from "./orgStyles";

const STATUSES = ["pending", "accepted", "rejected", "expired", "revoked"];

/** The address an invitation row is addressed to: email, else the phone. */
const addressOf = (invitation) =>
  invitation?.email || (invitation?.phone ? `+${invitation.phone}` : "unknown address");

export default function OrgInvitations({ orgId, access }) {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");

  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [roles, setRoles] = useState(["player"]);
  const [message, setMessage] = useState("");

  const permissions = access?.permissions || [];
  const canInvite = can(permissions, PERMISSIONS.INVITE_MEMBERS);
  const grantable = grantableRoles(access?.grantableRoles).filter((role) => role !== "owner");
  const hasAddress = Boolean(email.trim() || phone.trim());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listOrgInvitations(orgId, { status, limit: 50 });
      setItems(res.items || []);
    } catch (error) {
      setErr(error.message || "Failed to load invitations");
    } finally {
      setLoading(false);
    }
  }, [orgId, status]);

  useEffect(() => {
    load();
  }, [load]);

  const send = async (event) => {
    event.preventDefault();
    setBusy(true);
    setErr("");
    setNotice("");
    try {
      const res = await createOrgInvitation(orgId, {
        email: email.trim(),
        phone: phone.trim(),
        roles,
        message: message.trim(),
      });
      // The server says in one message whether the invitation was created and
      // whether it actually reached the address; only add the "grab it from
      // the log" hint when nothing was delivered.
      setNotice(res.delivered === false ? `${res.message} Share the link from the server log.` : res.message);
      setEmail("");
      setPhone("");
      setMessage("");
      setRoles(["player"]);
      await load();
    } catch (error) {
      setErr(error.message || "Could not send the invitation");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (invitation) => {
    setBusy(true);
    setErr("");
    setNotice("");
    try {
      await revokeOrgInvitation(orgId, invitation._id);
      setNotice(`Invitation to ${addressOf(invitation)} revoked.`);
      await load();
    } catch (error) {
      setErr(error.message || "Could not revoke the invitation");
    } finally {
      setBusy(false);
    }
  };

  if (!canInvite) {
    return (
      <div className={card}>
        <h2 className={sectionTitle}>Invitations</h2>
        <p className="mt-2 text-sm font-semibold text-cric-muted">
          Your roles on this organization do not include inviting people. Ask an owner or admin.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <form onSubmit={send} className={card}>
        <h2 className={sectionTitle}>Invite somebody</h2>
        <p className="mt-1 text-xs font-semibold text-cric-muted">
          Give an email address, a phone number, or both. They receive a single-use link, join with
          the roles you pick, and the invitation expires in 14 days. Ownership is never granted by
          invitation.
        </p>

        {err ? <div className="mt-4"><Banner kind="error">{err}</Banner></div> : null}
        {notice ? <div className="mt-4"><Banner kind="success">{notice}</Banner></div> : null}

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Email address" hint="Leave empty if you are inviting a phone number instead.">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="person@example.com"
              className={input}
            />
          </Field>
          <Field label="Phone number" hint="Leave empty if you are inviting an email instead.">
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0300 1234567"
              className={input}
            />
          </Field>
        </div>

        <div className="mt-4">
          <Field label="A short note (optional)">
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Welcome aboard!"
              className={input}
              maxLength={500}
            />
          </Field>
        </div>

        <div className="mt-4">
          <Field label="Roles they will get" hint={roles.map(roleLabel).join(", ")}>
            <div className="flex flex-wrap gap-2">
              {grantable.map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]))}
                  title={ORG_ROLE_DESCRIPTIONS[role]}
                  className={`rounded-lg border px-3 py-2 text-[10px] font-black uppercase tracking-widest transition ${
                    roles.includes(role)
                      ? "border-cric-accent bg-cric-accent text-white"
                      : "border-cric-border bg-cric-bg text-cric-muted hover:text-cric-text"
                  }`}
                >
                  {ORG_ROLE_LABELS[role]}
                </button>
              ))}
            </div>
          </Field>
        </div>

        <div className="mt-4 flex justify-end">
          <button type="submit" disabled={busy || !hasAddress || roles.length === 0} className={primaryButton}>
            {busy ? "Sending…" : "Send invitation"}
          </button>
        </div>
      </form>

      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className={sectionTitle}>Invitations</h2>
          <div className="flex flex-wrap gap-1">
            {STATUSES.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatus(value)}
                className={`rounded-lg border px-3 py-2 text-[10px] font-black uppercase tracking-widest transition ${
                  status === value
                    ? "border-cric-accent bg-cric-accent text-white"
                    : "border-cric-border bg-cric-bg text-cric-muted hover:text-cric-text"
                }`}
              >
                {value}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {loading ? (
            <p className="text-sm font-semibold text-cric-muted">Loading invitations…</p>
          ) : items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-cric-border bg-cric-bg p-6 text-center">
              <p className="text-sm font-bold text-cric-text">No {status} invitations</p>
            </div>
          ) : (
            items.map((inv) => {
              const remaining = daysUntil(inv.expiresAt);
              return (
                <div key={inv._id} className={cardSubtle}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-cric-text">{addressOf(inv)}</p>
                      <p className="truncate text-[10px] font-bold uppercase tracking-wider text-cric-muted">
                        {inv.channel === "phone" ? "by SMS" : "by email"} ·{" "}
                        {(inv.roles || []).map(roleLabel).join(", ")} · invited {formatDate(inv.createdAt)}
                        {inv.inviter?.name ? ` by ${inv.inviter.name}` : ""}
                      </p>
                      {inv.message ? (
                        <p className="mt-1 text-xs font-semibold italic text-cric-muted">“{inv.message}”</p>
                      ) : null}
                      {inv.status === "pending" && remaining !== null && (
                        <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-cric-muted">
                          {remaining <= 0 ? "Expires today" : `Expires in ${remaining} day${remaining === 1 ? "" : "s"}`}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-widest ${
                          invitationStatusStyles[inv.status] || invitationStatusStyles.pending
                        }`}
                      >
                        {inv.status}
                      </span>
                      {inv.status === "pending" && (
                        <button type="button" onClick={() => revoke(inv)} disabled={busy} className={dangerButton}>
                          Revoke
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <p className={`mt-4 ${eyebrow}`}>
          Accepted invitations become members and appear in the Members tab.
        </p>
      </div>
    </div>
  );
}
