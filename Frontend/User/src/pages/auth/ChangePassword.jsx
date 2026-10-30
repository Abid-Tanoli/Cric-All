import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { changePassword, useStoredUser } from "./auth";
import {
  Banner,
  card,
  eyebrow,
  input,
  label,
  primaryButton,
  secondaryButton,
} from "../organization/orgStyles";

/**
 * Signed-in password change.
 *
 * This is the screen an organization owner lands on after signing in with the
 * temporary password a platform admin handed them. It is also reachable from
 * Account for anyone changing their own password. A Google-only account has no
 * password to prove, so the current-password field is hidden and the backend
 * lets it set one.
 */
export default function ChangePassword() {
  const user = useStoredUser();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const requestedNext = searchParams.get("next") || "/";
  const next =
    requestedNext.startsWith("/") &&
    !requestedNext.startsWith("/admin") &&
    !requestedNext.startsWith("/change-password")
      ? requestedNext
      : "/";

  const hasPassword = user?.passwordSet === true;
  // A session cached before `passwordSet` existed has no value for it. Treat
  // that as "unknown": show the current-password field (optional) so the person
  // can fill it in, instead of hiding it and then being unable to satisfy the
  // backend's current-password check.
  const passwordStateUnknown = Boolean(user) && typeof user.passwordSet !== "boolean";
  const showCurrentPassword = hasPassword || passwordStateUnknown;
  const changingTemporary = user?.mustChangePassword === true;

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  // Let the confirmation be read for a moment before moving on. The cleanup
  // prevents a stray navigation if the person clicks "Continue" first.
  useEffect(() => {
    if (!done) return undefined;
    const timer = window.setTimeout(() => navigate(next, { replace: true }), 900);
    return () => window.clearTimeout(timer);
  }, [done, navigate, next]);

  if (!user) {
    return <Navigate to="/login?next=/change-password" replace />;
  }

  const onSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (newPassword !== confirmPassword) {
      setError("The new passwords don't match.");
      return;
    }
    if (newPassword.length < 8 || !/[a-zA-Z]/.test(newPassword) || !/\d/.test(newPassword)) {
      setError("Use at least 8 characters, including a letter and a number.");
      return;
    }
    if (hasPassword && !currentPassword) {
      setError("Enter your current password.");
      return;
    }

    setSaving(true);
    try {
      await changePassword(currentPassword, newPassword);
      setDone(true);
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || "Could not change the password.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      <p className={eyebrow}>{changingTemporary ? "One last step" : "Your account"}</p>
      <h1 className="mt-2 text-3xl font-black text-cric-text">
        {hasPassword || passwordStateUnknown ? "Change password" : "Set a password"}
      </h1>
      <p className="mt-2 text-sm font-semibold text-cric-muted">
        {changingTemporary
          ? "You signed in with a temporary password. Choose a new password that only you know."
          : hasPassword
            ? "Choose a new password. Your other signed-in devices will be signed out."
            : passwordStateUnknown
              ? "Choose a new password. If you already have one, enter it below so we know it is you."
              : "Your account was created with Google. Set a password so you can also sign in with your email address or phone number."}
      </p>

      <div className={`${card} mt-6`}>
        {done ? (
          <div className="space-y-4">
            <Banner kind="success">Password changed. Taking you to the next page…</Banner>
            <Link to={next} className={secondaryButton}>
              Continue
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-5">
            {error ? <Banner kind="error">{error}</Banner> : null}

            {showCurrentPassword ? (
              <div>
                <label className={label} htmlFor="current-password">
                  Current password
                </label>
                <input
                  id="current-password"
                  type={showPasswords ? "text" : "password"}
                  autoComplete="current-password"
                  className={input}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required={hasPassword}
                />
                {passwordStateUnknown ? (
                  <p className="mt-1 text-[10px] font-semibold text-cric-muted">
                    Leave blank if you have never set a password.
                  </p>
                ) : null}
              </div>
            ) : null}

            <div>
              <label className={label} htmlFor="new-password">
                New password
              </label>
              <input
                id="new-password"
                type={showPasswords ? "text" : "password"}
                autoComplete="new-password"
                className={input}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                required
                minLength={8}
              />
            </div>

            <div>
              <label className={label} htmlFor="confirm-password">
                Confirm new password
              </label>
              <input
                id="confirm-password"
                type={showPasswords ? "text" : "password"}
                autoComplete="new-password"
                className={input}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>

            <label className="flex items-center gap-2 text-xs font-bold text-cric-muted">
              <input
                type="checkbox"
                checked={showPasswords}
                onChange={(e) => setShowPasswords(e.target.checked)}
                className="h-4 w-4 accent-[var(--color-cric-accent,#f97316)]"
              />
              Show passwords
            </label>

            <p className="text-xs font-semibold text-cric-muted">
              Use at least 8 characters, including a letter and a number.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" disabled={saving} className={primaryButton}>
                {saving
                  ? "Saving…"
                  : hasPassword || passwordStateUnknown
                    ? "Change password"
                    : "Set password"}
              </button>
              {!changingTemporary ? (
                <Link to="/account" className={secondaryButton}>
                  Back to account
                </Link>
              ) : null}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
