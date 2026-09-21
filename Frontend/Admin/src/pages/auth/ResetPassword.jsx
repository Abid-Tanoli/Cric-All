import React, { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import api from "../../services/api";
import PasswordField from "../../components/PasswordField";

export default function ResetPassword() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
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
      await api.post(`/admin/reset-password/${token}`, { password });
      navigate("/admin/login", { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || "Password reset failed. The link may be invalid or expired.");
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
            <PasswordField
              label="New Password"
              placeholder="Minimum 8 characters, letters & numbers"
              error={password ? "" : undefined}
              inputProps={{
                value: password,
                onChange: (e) => setPassword(e.target.value),
                required: true,
              }}
            />
            <PasswordField
              label="Confirm New Password"
              placeholder="••••••••"
              error={confirmPassword ? "" : undefined}
              inputProps={{
                value: confirmPassword,
                onChange: (e) => setConfirmPassword(e.target.value),
                required: true,
              }}
            />

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
            <Link to="/admin/login" className="text-cric-accent font-bold hover:underline">
              Back to sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}