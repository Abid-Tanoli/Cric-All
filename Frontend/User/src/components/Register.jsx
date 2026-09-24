import React, { useState } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { register, loginWithGoogle } from '../pages/auth/auth';
import PlayerForm from './PlayerForm';

const hasGoogleClientId = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID && import.meta.env.VITE_GOOGLE_CLIENT_ID !== 'your_google_client_id.apps.googleusercontent.com');

const accountTypes = [
  {
    value: 'player',
    label: 'Player',
    description: 'Create your player profile and join teams or events.',
  },
  {
    value: 'handler',
    label: 'Cricket Handler',
    description: 'Request access after signing up — our team will set up your teams, tournaments and local scoring.',
  },
  {
    value: 'organization_admin',
    label: 'Organization Admin',
    description: 'For schools, colleges, universities, industries, clubs, leagues and academies. Request access after signing up — our team will set up your organization\'s teams and events.',
  },
];

const organizationCategories = [
  'School',
  'College',
  'University',
  'Organization',
  'Business',
  'Industry',
  'Club',
  'Academy',
  'League',
  'Other',
];

export default function Register({ onSuccess, onCancel, embedded = false }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accountType, setAccountType] = useState('handler');
  const [organizationCategory, setOrganizationCategory] = useState('School');
  const [organizationName, setOrganizationName] = useState('');
  const [phone, setPhone] = useState('');
  const [joinIntent, setJoinIntent] = useState('');
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [postSignup, setPostSignup] = useState(null);

  const submitPlayerForm = async (data) => {
    setErr(null);
    setLoading(true);
    try {
      const user = await register(data.name, data.email, data.password, {
        accountType: 'player',
        playerProfile: {
          playingRole: data.playingRole,
          battingStyle: data.battingStyle,
          bowlingStyle: data.bowlingStyle,
          category: data.category || 'Other',
          subCategory: data.subCategory || '',
          ageGroup: data.ageGroup || 'Open',
          organizationName: data.organization || '',
          location: {
            town: data.address?.town || '',
            district: data.address?.district || '',
            city: data.address?.city || '',
            province: data.address?.province || '',
          },
        },
      });
      onSuccess?.(user);
    } catch (error) {
      setErr(error.response?.data?.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const submitHandlerForm = async (e) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const user = await register(name, email, password, {
        accountType,
        organizationCategory,
        organizationName,
        phone,
        joinIntent,
      });
      setPostSignup({ user, type: accountType });
    } catch (error) {
      setErr(error.response?.data?.message || 'Registration failed');
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
      setErr(error.response?.data?.message || 'Google sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={embedded ? "w-full" : "fixed inset-0 z-[80] flex items-center justify-center bg-cric-text/70 px-4 py-8 backdrop-blur-sm"}>
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-cric-border bg-cric-card shadow-sm">
        <div className="bg-cric-accent px-6 py-5 text-white">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-white/70">Join CricAll</p>
              <h3 className="mt-1 text-2xl font-black uppercase tracking-tight">Choose how you want to join</h3>
              <p className="mt-2 max-w-2xl text-sm font-semibold text-white/80">
                CricAll provides the platform. Local cricket handlers manage their own teams, playing XI, squads, matches and tournaments.
              </p>
            </div>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="rounded-lg bg-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white hover:bg-white/20"
              >
                Close
              </button>
            )}
          </div>
        </div>

        <div className="p-6">
          {postSignup ? (
            <div className="rounded-xl border border-cric-accent/30 bg-cric-bg p-8 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-cric-accent/20 text-2xl text-cric-accent">✓</div>
              <h4 className="text-xl font-black uppercase tracking-tight text-cric-text">Thanks, {postSignup.user.name}!</h4>
              <p className="mx-auto mt-3 max-w-md text-sm font-semibold leading-relaxed text-cric-muted">
                Your {postSignup.type === 'organization_admin' ? 'organization admin' : 'cricket handler'} request has been received.
                An admin will review it and set up your teams and tournaments. You can track progress on
                {' '}<span className="font-black text-cric-accent uppercase">My Dashboard</span> once your account is set up.
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => { const u = postSignup.user; setPostSignup(null); onSuccess?.(u); }}
                  className="rounded-lg bg-cric-accent px-8 py-3 text-xs font-black uppercase tracking-widest text-white shadow-sm transition hover:bg-orange-600"
                >
                  Continue
                </button>
                {onCancel && (
                  <button
                    type="button"
                    onClick={onCancel}
                    className="rounded-lg bg-cric-bg px-8 py-3 text-xs font-black uppercase tracking-widest text-cric-muted transition hover:bg-cric-border"
                  >
                    Close
                  </button>
                )}
              </div>
            </div>
          ) : (
          <>
          {hasGoogleClientId && (
            <div className="mb-6">
              <GoogleLogin
                onSuccess={handleGoogleSuccess}
                onError={() => setErr('Google sign-in failed')}
                theme="outline"
                size="large"
                text="signup_with"
                shape="rectangular"
                width="100%"
              />
              <p className="mt-3 text-center text-[10px] font-bold uppercase tracking-widest text-cric-muted">
                Quick sign-up with Google creates a player account.
              </p>
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-cric-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-cric-card px-4 text-cric-muted font-bold">or sign up with email</span>
                </div>
              </div>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-3 mb-6">
            {accountTypes.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setAccountType(item.value)}
                className={`rounded-lg border p-4 text-left transition-all ${
                  accountType === item.value
                    ? 'border-cric-accent bg-cric-accent text-white shadow-sm'
                    : 'border-cric-border bg-cric-card text-cric-muted hover:border-cric-accent/30'
                }`}
              >
                <span className="block text-sm font-black uppercase tracking-wide">{item.label}</span>
                <span className={`mt-2 block text-xs font-semibold leading-relaxed ${accountType === item.value ? 'text-white/80' : 'text-cric-muted'}`}>
                  {item.description}
                </span>
              </button>
            ))}
          </div>

          {accountType === 'player' ? (
            <div className="bg-cric-card rounded-xl border border-cric-border p-5">
              <h4 className="text-sm font-black text-cric-text uppercase tracking-widest mb-4 pb-3 border-b border-cric-border">
                Register as Player
              </h4>
              <PlayerForm
                mode="user"
                onSubmit={submitPlayerForm}
                loading={loading}
              />
            </div>
          ) : (
            <form onSubmit={submitHandlerForm} className="space-y-5 text-cric-text">
              <label className="text-[10px] font-black uppercase tracking-widest text-cric-muted">Full Name</label>
              <input
                placeholder="Full name"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full rounded-lg border border-cric-border px-3 py-3 text-sm font-semibold text-cric-text bg-cric-card focus:outline-none focus:ring-2 focus:ring-cric-accent/30 focus:border-cric-accent"
              />

              <label className="text-[10px] font-black uppercase tracking-widest text-cric-muted">Email</label>
              <input
                placeholder="Email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full rounded-lg border border-cric-border px-3 py-3 text-sm font-semibold text-cric-text bg-cric-card focus:outline-none focus:ring-2 focus:ring-cric-accent/30 focus:border-cric-accent"
              />

              <label className="text-[10px] font-black uppercase tracking-widest text-cric-muted">Password</label>
              <input
                placeholder="Password (minimum 8 characters)"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full rounded-lg border border-cric-border px-3 py-3 text-sm font-semibold text-cric-text bg-cric-card focus:outline-none focus:ring-2 focus:ring-cric-accent/30 focus:border-cric-accent"
              />

              <div className="rounded-xl border border-cric-border bg-cric-bg p-4">
                <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-cric-muted">Handler details</p>
                <div className="grid gap-4 md:grid-cols-2">
                  <select
                    value={organizationCategory}
                    onChange={e => setOrganizationCategory(e.target.value)}
                    className="w-full rounded-lg border border-cric-border bg-cric-card px-3 py-3 text-sm font-bold text-cric-text focus:outline-none focus:ring-2 focus:ring-cric-accent/30 focus:border-cric-accent"
                  >
                    {organizationCategories.map(category => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                  <input
                    placeholder="Organization, school, college, club or league name"
                    value={organizationName}
                    onChange={e => setOrganizationName(e.target.value)}
                    className="w-full rounded-lg border border-cric-border bg-cric-card px-3 py-3 text-sm font-semibold text-cric-text focus:outline-none focus:ring-2 focus:ring-cric-accent/30 focus:border-cric-accent"
                  />
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <input
                    placeholder="Phone (optional)"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    className="w-full rounded-lg border border-cric-border bg-cric-card px-3 py-3 text-sm font-semibold text-cric-text focus:outline-none focus:ring-2 focus:ring-cric-accent/30 focus:border-cric-accent"
                  />
                  <input
                    placeholder="What will you manage? e.g. school league, club tournament"
                    value={joinIntent}
                    onChange={e => setJoinIntent(e.target.value)}
                    className="w-full rounded-lg border border-cric-border bg-cric-card px-3 py-3 text-sm font-semibold text-cric-text focus:outline-none focus:ring-2 focus:ring-cric-accent/30 focus:border-cric-accent"
                  />
                </div>
              </div>

              {err && <p className="text-red-500 text-sm font-bold">{err}</p>}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-semibold text-cric-muted">
                  Request access after signing up — our team reviews requests and sets up your teams and tournaments.
                </p>
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-lg bg-cric-accent px-6 py-3 text-[10px] font-black uppercase tracking-widest text-white shadow-sm transition hover:bg-orange-600 disabled:opacity-60"
                >
                  {loading ? 'Registering...' : 'Create Account'}
                </button>
              </div>
            </form>
          )}
          </>
          )}
        </div>
      </div>
    </div>
  );
}
