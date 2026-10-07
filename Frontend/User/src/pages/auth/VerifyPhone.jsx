import React, { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getStoredUser, verifyPhoneOtp, resendPhoneOtp, formatPhone } from "./auth";

/**
 * Phone verification page: submit the 6-digit OTP (and resend it).
 * Reached from the verification banner ("/verify-phone") — email verification
 * keeps its token-link page, but an SMS has nowhere to click.
 */
export default function VerifyPhone() {
  const [params] = useSearchParams();
  const stored = getStoredUser();
  const phoneParam = params.get("phone") || "";
  const phone = phoneParam || stored?.phone || "";
  const displayPhone = formatPhone(phone);

  const [otp, setOtp] = useState("");
  const [state, setState] = useState("idle"); // idle | ok | error
  const [message, setMessage] = useState("");
  const [resendState, setResendState] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!phone || otp.length !== 6) return;
    setBusy(true);
    setMessage("");
    setState("idle");
    try {
      const data = await verifyPhoneOtp(phone, otp.trim());
      setState("ok");
      setMessage(data?.message || "Phone number verified.");
    } catch (err) {
      setState("error");
      setMessage(err?.response?.data?.message || "This verification code is invalid or has expired.");
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!phone) {
      setResendState("Sign in first, then request a new code from the banner.");
      return;
    }
    setResendState("Sending...");
    try {
      const data = await resendPhoneOtp(phone);
      setResendState(data?.message || "If your account is unverified, a new code has been sent.");
    } catch (err) {
      setResendState(err?.response?.data?.message || "Could not resend right now. Please wait a minute and try again.");
    }
  };

  if (!phone) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cric-bg p-6">
        <div className="w-full max-w-md bg-cric-card rounded-2xl shadow-xl p-6 sm:p-8 border border-cric-border text-center">
          <h1 className="text-3xl font-black text-cric-text">VERIFY PHONE</h1>
          <p className="text-cric-muted mt-4">Sign in first, then request a new code from the banner.</p>
          <Link
            to="/login"
            className="mt-6 block w-full py-3 bg-cric-accent hover:bg-orange-600 text-white font-black text-sm uppercase tracking-widest rounded-xl transition-all shadow-lg"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-cric-bg p-6">
      <div className="w-full max-w-md">
        <div className="bg-cric-card rounded-2xl shadow-xl p-6 sm:p-8 border border-cric-border text-center">
          <h1 className="text-3xl font-black text-cric-text">VERIFY PHONE</h1>

          {state === "ok" ? (
            <>
              <div className="mx-auto mt-6 mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-cric-accent/20 text-2xl text-cric-accent">✓</div>
              <p className="text-cric-text font-bold">{message}</p>
              <p className="text-cric-muted text-sm mt-2">
                You can now create organizations, teams and matches.
              </p>
              <Link
                to="/"
                className="mt-6 inline-block w-full py-3 bg-cric-accent hover:bg-orange-600 text-white font-black text-sm uppercase tracking-widest rounded-xl transition-all shadow-lg"
              >
                Continue
              </Link>
            </>
          ) : (
            <form onSubmit={submit} className="mt-4 text-left">
              <p className="text-cric-muted text-sm text-center">
                Enter the 6-digit code sent to{" "}
                <span className="font-black text-cric-accent">{displayPhone}</span>.
              </p>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                className="mt-4 w-full rounded-xl border border-cric-border bg-cric-bg px-3 py-4 text-center text-2xl font-black tracking-[0.5em] text-cric-text focus:outline-none focus:ring-2 focus:ring-cric-accent/30 focus:border-cric-accent"
              />
              {message && <p className="text-red-500 font-bold text-sm mt-3 text-center">{message}</p>}
              <div className="mt-5 space-y-3">
                <button
                  type="submit"
                  disabled={busy || otp.length !== 6}
                  className="w-full py-3 bg-cric-accent hover:bg-orange-600 text-white font-black text-sm uppercase tracking-widest rounded-xl transition-all shadow-lg disabled:opacity-60"
                >
                  {busy ? "Verifying..." : "Verify Phone"}
                </button>
                <button
                  type="button"
                  onClick={resend}
                  disabled={busy}
                  className="w-full py-3 border border-cric-border text-cric-muted hover:text-cric-text font-black text-sm uppercase tracking-widest rounded-xl transition-all disabled:opacity-60"
                >
                  Send a new code
                </button>
                <Link
                  to="/login"
                  className="block w-full py-3 border border-cric-border text-cric-muted hover:text-cric-text font-black text-sm uppercase tracking-widest rounded-xl transition-all text-center"
                >
                  Back to sign in
                </Link>
              </div>
              {resendState && <p className="text-cric-muted text-xs mt-4 text-center">{resendState}</p>}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
