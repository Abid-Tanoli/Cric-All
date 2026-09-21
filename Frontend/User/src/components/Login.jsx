import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import { login, loginWithGoogle } from '../pages/auth/auth';

const hasGoogleClientId = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID && import.meta.env.VITE_GOOGLE_CLIENT_ID !== 'your_google_client_id.apps.googleusercontent.com');

export default function Login({ onSuccess, onCancel, embedded = false }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const user = await login(email, password);
      onSuccess?.(user);
    } catch (error) {
      setErr(error.response?.data?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSuccess = async (credentialResponse) => {
    setErr(null);
    setLoading(true);
    try {
      const user = await loginWithGoogle(credentialResponse.credential);
      onSuccess?.(user);
    } catch (error) {
      setErr(error.response?.data?.message || 'Google login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={embedded ? "w-full" : "fixed inset-0 z-[80] flex items-center justify-center bg-cric-text/70 px-4 backdrop-blur-sm"}>
      <div className="w-full max-w-md bg-cric-card rounded-xl border border-cric-border shadow-xl p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-black text-cric-text uppercase tracking-tight">Login</h3>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg bg-cric-bg px-3 py-2 text-[10px] font-black uppercase tracking-widest text-cric-muted hover:bg-cric-border"
            >
              Close
            </button>
          )}
        </div>

        {err && <p className="text-red-500 mb-4 text-sm font-bold">{err}</p>}

        {hasGoogleClientId && (
          <>
            <div className="mb-6">
              <GoogleLogin
                onSuccess={handleGoogleSuccess}
                onError={() => setErr('Google sign-in failed')}
                theme="outline"
                size="large"
                text="signin_with"
                shape="rectangular"
                width="100%"
              />
            </div>

            <div className="relative mb-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-cric-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-cric-card px-4 text-cric-muted font-bold">or continue with email</span>
              </div>
            </div>
          </>
        )}

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-cric-muted mb-2">Email</label>
            <input
              placeholder="your@email.com"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full p-3 bg-cric-bg border border-cric-border rounded-xl focus:ring-2 focus:ring-cric-accent outline-none font-bold text-cric-text transition-all"
            />
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-cric-muted mb-2">Password</label>
            <input
              placeholder="Enter your password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full p-3 bg-cric-bg border border-cric-border rounded-xl focus:ring-2 focus:ring-cric-accent outline-none font-bold text-cric-text transition-all"
            />
          </div>
          <div className="flex justify-between items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-3 bg-cric-accent hover:bg-orange-600 disabled:opacity-50 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-lg"
            >
              {loading ? 'Logging in...' : 'Login'}
            </button>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-3 bg-cric-bg hover:bg-cric-border text-cric-text font-black text-xs uppercase tracking-widest rounded-xl transition-all"
              >
                Cancel
              </button>
            )}
          </div>
          <div className="pt-1 text-center">
            <Link to="/forgot-password" className="text-xs font-bold text-cric-accent hover:underline">
              Forgot password?
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
