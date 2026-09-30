import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { acceptInvitation, previewInvitation, rejectInvitation } from "../../services/organizationApi";
import { formatDate, roleLabel } from "../../lib/orgUi";
import { useStoredUser } from "../auth/auth";
import { Banner, card, eyebrow, primaryButton, secondaryButton } from "./orgStyles";

export default function InvitationAccept() {
  const { token } = useParams();
  const navigate = useNavigate();
  const storedUser = useStoredUser();

  const [invitation, setInvitation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!storedUser) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    previewInvitation(token)
      .then((res) => {
        if (!cancelled) setInvitation(res);
      })
      .catch((error) => {
        if (!cancelled) setErr(error.message || "This invitation link is not valid.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, storedUser]);

  const accept = async () => {
    setBusy(true);
    setErr("");
    try {
      const res = await acceptInvitation(token);
      setNotice(res.message);
      setTimeout(() => navigate(`/organization?org=${res.organization?._id || ""}`), 1200);
    } catch (error) {
      setErr(error.message || "Could not accept the invitation");
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    setBusy(true);
    setErr("");
    try {
      await rejectInvitation(token);
      setNotice("Invitation declined.");
      setTimeout(() => navigate("/organization"), 1000);
    } catch (error) {
      setErr(error.message || "Could not decline the invitation");
    } finally {
      setBusy(false);
    }
  };

  // Not signed in: the token stays in the URL and is replayed after login.
  if (!storedUser) {
    return (
      <div className="min-h-screen bg-cric-bg px-4 py-12 text-cric-text">
        <div className={`${card} mx-auto max-w-lg text-center`}>
          <p className={eyebrow}>Organization invitation</p>
          <h1 className="mt-2 text-xl font-black uppercase tracking-tight">Sign in to continue</h1>
          <p className="mt-3 text-sm font-semibold text-cric-muted">
            You need the CricAll account this invitation was sent to. We will bring you straight back
            here afterwards.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link to={`/login?next=/organization/invitations/${token}`} className={primaryButton}>
              Sign in
            </Link>
            <Link to={`/register?next=/organization/invitations/${token}`} className={secondaryButton}>
              Create an account
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cric-bg px-4 py-12 text-cric-text">
      <div className={`${card} mx-auto max-w-lg space-y-4`}>
        <p className={eyebrow}>Organization invitation</p>

        {loading ? (
          <p className="text-sm font-semibold text-cric-muted">Checking this invitation…</p>
        ) : err && !invitation ? (
          <Banner kind="error">{err}</Banner>
        ) : invitation ? (
          <>
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight">
                Join {invitation.organization?.name || "this organization"}?
              </h1>
              <p className="mt-2 text-sm font-semibold text-cric-muted">
                {invitation.inviter?.name ? `${invitation.inviter.name} invited you` : "You have been invited"}{" "}
                as {(invitation.roles || []).map(roleLabel).join(", ")}.
              </p>
            </div>

            {invitation.message && (
              <p className="rounded-xl border border-cric-border bg-cric-bg px-4 py-3 text-sm font-semibold italic text-cric-muted">
                “{invitation.message}”
              </p>
            )}

            <p className={eyebrow}>This invitation expires on {formatDate(invitation.expiresAt)}.</p>

            {err ? <Banner kind="error">{err}</Banner> : null}
            {notice ? <Banner kind="success">{notice}</Banner> : null}

            {!invitation.forAccount && (
              <Banner kind="error">
                This invitation was sent to a different email address. Sign in with the account it was
                sent to in order to accept it.
              </Banner>
            )}
            {invitation.forAccount && !invitation.emailVerified && (
              <Banner kind="error">
                Verify your email address before accepting — check your inbox, then reload this page.
              </Banner>
            )}

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={accept}
                disabled={busy || notice || !invitation.forAccount || !invitation.emailVerified}
                className={primaryButton}
              >
                {busy ? "Working…" : "Accept invitation"}
              </button>
              <button type="button" onClick={reject} disabled={busy || !!notice} className={secondaryButton}>
                Decline
              </button>
            </div>
          </>
        ) : null}

        <Link to="/organization" className={`block text-center ${eyebrow}`}>
          Back to my organizations
        </Link>
      </div>
    </div>
  );
}
