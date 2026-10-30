import React, { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Login from "../../components/Login";
import Register from "../../components/Register";
import { setAuthToken } from "../../services/api";

export default function AuthPage({ initialMode = "login" }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const next = searchParams.get("next") || "/";
  const requestedMode = searchParams.get("mode") || initialMode;
  const [mode, setMode] = useState(requestedMode === "register" ? "register" : "login");

  const safeNext = useMemo(() => (
    next.startsWith("/") && !next.startsWith("/admin") ? next : "/"
  ), [next]);

  const handleSuccess = (user) => {
    // An organization owner handed over by a platform admin signs in with a
    // temporary password. Send them straight to the screen that replaces it,
    // keeping the original destination so they continue there afterwards.
    if (user?.mustChangePassword) {
      navigate(`/change-password?next=${encodeURIComponent(safeNext)}`, { replace: true });
      return;
    }
    navigate(safeNext, { replace: true });
  };

  const continueAsGuest = () => {
    localStorage.removeItem("bq_token");
    localStorage.removeItem("token");
    localStorage.removeItem("bq_user");
    setAuthToken(null);
    navigate("/", { replace: true });
  };

  return (
    <div className="min-h-screen bg-cric-bg px-4 py-8 text-cric-text">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
        <div className="rounded-2xl border border-cric-border bg-cric-card p-4 shadow-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`min-h-[48px] rounded-xl px-4 py-3 text-xs font-black uppercase tracking-widest transition-all ${
                mode === "login" ? "bg-cric-accent text-white" : "bg-cric-bg text-cric-muted hover:text-cric-text"
              }`}
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => setMode("register")}
              className={`min-h-[48px] rounded-xl px-4 py-3 text-xs font-black uppercase tracking-widest transition-all ${
                mode === "register" ? "bg-cric-accent text-white" : "bg-cric-bg text-cric-muted hover:text-cric-text"
              }`}
            >
              Register
            </button>
            <button
              type="button"
              onClick={continueAsGuest}
              className="min-h-[48px] rounded-xl border border-cric-border bg-cric-card px-4 py-3 text-xs font-black uppercase tracking-widest text-cric-muted transition-all hover:bg-cric-bg hover:text-cric-text"
            >
              Continue as Guest
            </button>
          </div>
        </div>

        {mode === "login" ? (
          <Login embedded onSuccess={handleSuccess} />
        ) : (
          <Register embedded onSuccess={handleSuccess} />
        )}
      </div>
    </div>
  );
}
