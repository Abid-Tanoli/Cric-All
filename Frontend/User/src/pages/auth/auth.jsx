import { useEffect, useState } from 'react';
import { api, setAuthToken } from '../../services/api';

// Helpful dev-time signal instead of a silently missing Google button.
const hasGoogleClientId = Boolean(
  import.meta.env.VITE_GOOGLE_CLIENT_ID &&
  import.meta.env.VITE_GOOGLE_CLIENT_ID !== 'your_google_client_id.apps.googleusercontent.com'
);
if (!hasGoogleClientId && import.meta.env.DEV) {
  console.info(
    '[CricAll] VITE_GOOGLE_CLIENT_ID is not set — Google sign-in buttons stay hidden. ' +
    'Create an OAuth client in Google Cloud Console and add it to Frontend/User/.env.local ' +
    '(the backend needs the matching GOOGLE_CLIENT_ID).'
  );
}

function persistAuth(token, user) {
  if (token) {
    localStorage.setItem('bq_token', token);
    setAuthToken(token);
  }
  if (user) localStorage.setItem('bq_user', JSON.stringify(user));
  window.dispatchEvent(new CustomEvent('bq-auth-changed'));
}

function clearAuth() {
  localStorage.removeItem('bq_token');
  localStorage.removeItem('bq_user');
  setAuthToken(null);
  window.dispatchEvent(new CustomEvent('bq-auth-changed'));
}

export async function register(name, email, password, profile = {}) {
  const res = await api.post('/auth/register', { name, email, password, ...profile });
  const { token, user } = res.data;
  persistAuth(token, user);
  return user;
}

export async function login(email, password) {
  const res = await api.post('/auth/login', { email, password });
  const { token, user } = res.data;
  persistAuth(token, user);
  return user;
}

export async function loginWithGoogle(credential) {
  const res = await api.post('/auth/google', { credential });
  const { token, user } = res.data;
  persistAuth(token, user);
  return user;
}

export async function verifyEmailToken(token) {
  const res = await api.post('/auth/verify-email', { token });
  const { user } = res.data || {};
  if (user) {
    // Refresh the cached user so the verification banner disappears.
    localStorage.setItem('bq_user', JSON.stringify(user));
    window.dispatchEvent(new CustomEvent('bq-auth-changed'));
  }
  return res.data;
}

export async function resendVerification(email) {
  const res = await api.post('/auth/resend-verification', { email });
  return res.data;
}

export function logout() {
  clearAuth();
}

export function getStoredUser() {
  const raw = localStorage.getItem('bq_user');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/**
 * Announce that this account's organization memberships changed.
 *
 * The header decides between "My Organizations" and "Create Organization" from
 * a `hasOrg` flag that is fetched once per signed-in session and keyed on the
 * user id. Creating an organization — or accepting an invitation, which also
 * creates a membership — does not change the user id, so that fetch never re-ran
 * and the header kept offering to create an organization the account already
 * owned until a hard reload.
 *
 * Anything that changes *which organizations this account belongs to* should
 * dispatch this so the header re-reads it immediately.
 */
export function notifyMembershipChanged() {
  window.dispatchEvent(new CustomEvent('bq-membership-changed'));
}

/**
 * Subscribe to the cached session instead of re-reading localStorage during
 * render.
 *
 * `getStoredUser()` parses JSON on every call, so it hands back a brand new
 * object identity each time. Calling it in a component body and then using it
 * as a useEffect dependency re-runs that effect on every single render: the
 * effect fetches, the fetch calls setState, setState renders, render produces a
 * new user object, dependency changed, effect runs again. That is an infinite
 * fetch loop which left /organization and /my-players permanently stuck on
 * their loading text.
 *
 * Holding the value in state means the identity only changes when the session
 * actually changes, so effects depending on it settle.
 */
export function useStoredUser() {
  const [user, setUser] = useState(getStoredUser);

  useEffect(() => {
    const sync = () => setUser(getStoredUser());
    window.addEventListener('bq-auth-changed', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('bq-auth-changed', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return user;
}

export function initAuthFromStorage() {
  const token = localStorage.getItem('bq_token');
  if (token) setAuthToken(token);
  return getStoredUser();
}
