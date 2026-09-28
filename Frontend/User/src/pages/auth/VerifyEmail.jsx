import React, { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { verifyEmailToken, resendVerification, getStoredUser } from "./auth";

export default function VerifyEmail() {
  const { token } = useParams();
  const [state, setState] = useState("working"); // working | ok | error
  const [message, setMessage] = useState("");
  const [resendState, setResendState] = useState("");
  const started = useRef(false);

  useEffect(() => {
    // Guard against StrictMode double-invocation: the token is single-use.
    if (started.current) return;
    started.current = true;

    let cancelled = false;
    (async () => {
      try {
        const data = await verifyEmailToken(token);
        if (!cancelled) {
          setState("ok");
          setMessage(data?.message || "Email verified.");
        }
      } catch (err) {
        if (!cancelled) {
          setState("error");
          setMessage(err?.message || "This verification link is invalid or has expired.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const resend = async () => {
    const email = getStoredUser()?.email;
    if (!email) {
      setResendState("Sign in first, then request a new link from the banner.");
      return;
    }
    setResendState("Sending...");
    try {
      await resendVerification(email);
      setResendState("If your account is unverified, a new link has been sent.");
    } catch (err) {
      setResendState(err?.message || "Could not resend right now. Please wait a minute and try again.");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-cric-bg p-6">
      <div className="w-full max-w-md">
        <div className="bg-cric-card rounded-2xl shadow-xl p-6 sm:p-8 border border-cric-border text-center">
          <h1 className="text-3xl font-black text-cric-text">VERIFY EMAIL</h1>

          {state === "working" && (
            <p className="text-cric-muted mt-4">Confirming your address...</p>
          )}

          {state === "ok" && (
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
          )}

          {state === "error" && (
            <>
              <div className="mx-auto mt-6 mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-500/15 text-2xl text-red-500">!</div>
              <p className="text-red-500 font-bold">{message}</p>
              <div className="mt-6 space-y-3">
                <button
                  type="button"
                  onClick={resend}
                  className="w-full py-3 bg-cric-accent hover:bg-orange-600 text-white font-black text-sm uppercase tracking-widest rounded-xl transition-all shadow-lg"
                >
                  Send a new link
                </button>
                <Link
                  to="/login"
                  className="block w-full py-3 border border-cric-border text-cric-muted hover:text-cric-text font-black text-sm uppercase tracking-widest rounded-xl transition-all"
                >
                  Back to sign in
                </Link>
              </div>
              {resendState && <p className="text-cric-muted text-xs mt-4">{resendState}</p>}
            </>
          )}

          {state === "ok" && resendState && <p className="text-cric-muted text-xs mt-4">{resendState}</p>}
        </div>
      </div>
    </div>
  );
}
