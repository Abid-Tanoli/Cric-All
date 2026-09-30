import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteAccount } from "../services/authApi";
import { logout } from "./auth/auth";
import {
  Banner,
  alertError,
  card,
  dangerButton,
  eyebrow,
  secondaryButton,
} from "./organization/orgStyles";

// Deleting the account itself is the destructive action this page exists for,
// so the dialog is a fixed overlay rather than an inline confirm. It mirrors the
// wording and button order of the My Players delete dialog, so the two destructive
// flows in the product read the same way.
export default function Account() {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const doDelete = async () => {
    setBusy(true);
    setErr("");
    try {
      await deleteAccount();
      // The account is gone, so the cached session has to go with it. Logout
      // first: the token is now dead and any later call would 401.
      logout();
      navigate("/", { replace: true });
    } catch (error) {
      // 409 means this account is the last owner of an organization. That is
      // fixable, so keep the dialog open and name the organizations.
      const blocked = error.response?.data?.organizations;
      if (blocked?.length) {
        setErr(
          `${error.response.data.message} (${blocked.map((org) => org.name).join(", ")})`
        );
      } else {
        setErr(error.response?.data?.message || "Could not delete the account");
      }
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <p className={eyebrow}>Your account</p>
      <h1 className="mt-2 text-3xl font-black text-cric-text">Account</h1>

      {err ? (
        <div className="mt-6">
          <Banner kind="error">{err}</Banner>
        </div>
      ) : null}

      <div className={`${card} mt-6`}>
        <h2 className="text-sm font-black uppercase tracking-widest">Delete this account</h2>
        <p className="mt-2 text-xs font-semibold text-cric-muted">
          This removes your account for good: your memberships, your pending invitations and your
          handler requests go with it. Player profiles, teams and events you created stay on the
          platform, because other people&apos;s scorecards depend on them — only your name is dropped
          from them. Audit history is kept.
        </p>
        <p className="mt-2 text-xs font-semibold text-cric-muted">
          If you are the only owner of an organization, promote another member to owner first.
        </p>
        <div className="mt-5">
          <button type="button" onClick={() => setConfirming(true)} className={dangerButton}>
            Delete my account
          </button>
        </div>
      </div>

      {confirming ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-cric-text/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-cric-border bg-cric-card p-6 shadow-sm">
            <h2 className="text-sm font-black uppercase tracking-widest">Delete your account?</h2>
            <p className="mt-2 text-xs font-semibold text-cric-muted">
              You will be signed out and will have to register again from scratch. This cannot be
              undone.
            </p>
            {err ? <p className={`${alertError} mt-3`}>{err}</p> : null}
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={doDelete}
                disabled={busy}
                className={dangerButton}
              >
                {busy ? "Deleting…" : "Delete permanently"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
                className={secondaryButton}
              >
                Keep it
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}