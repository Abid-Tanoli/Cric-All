import React, { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../services/api";

export default function ResetPassword() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }
    setLoading(true);
    try {
      await api.post(`/auth/reset-password/${token}`, { password });
      navigate("/login", { replace: true });
    } catch (err) {
      setError(err?.message || "Password reset failed. The link may be invalid or expired.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-cric-bg p-6">
      <div className="w-full max-w-md">
        <div className="bg-cric-card rounded-2xl shadow-xl p-6 sm:p-8 border border-cric-border">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-black text-cric-text">RESET PASSWORD</h1>
            <p className="text-cric-muted mt-2">Choose a new password for your account</p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={onSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-bold uppercase text-cric-muted mb-2">New Password</label>
              <div className="relative">
                <input
                  type={show ? "text" : "password"}
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 pr-12 bg-cric-bg border border-cric-border rounded-xl focus:ring-2 focus:ring-cric-accent outline-none font-bold text-cric-text"
                  placeholder="Minimum 8 characters"
                />
                <button
                  type="button"
                  onClick={() => setShow(!show)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-cric-muted hover:text-cric-text text-lg"
                  aria-label={show ? "Hide password" : "Show password"}
                >
                  {show ? <>&#128065;&#65039;</> : <>&#128064;&#65039;</>}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase text-cric-muted mb-2">Confirm New Password</label>
              <input
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-3 bg-cric-bg border border-cric-border rounded-xl focus:ring-2 focus:ring-cric-accent outline-none font-bold text-cric-text"
                placeholder="Re-enter your password"
              />
            </div>

            <p className="text-xs text-cric-muted">Use at least 8 characters including a letter and a number.</p>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-cric-accent hover:bg-orange-600 disabled:opacity-50 text-white font-black text-sm uppercase tracking-widest rounded-xl transition-all shadow-lg"
            >
              {loading ? "Resetting..." : "Reset Password"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-cric-muted">
            <Link to="/login" className="text-cric-accent font-bold hover:underline">
              Back to sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}