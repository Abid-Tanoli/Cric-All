import React, { useEffect, useState } from 'react';
import {
  changeVerificationEmail,
  resendVerification,
  verifyEmailCode,
} from '../pages/auth/auth';

const RESEND_SECONDS = 60;

/**
 * Shared 6-digit email-code screen. Used both on /verify-email and inline after
 * signup. Phone/SMS verification is deferred: there is deliberately no phone
 * step here and no "verify phone" action anywhere in this flow.
 */
export default function EmailCodeForm({ email: initialEmail = '', onVerified, compact = false }) {
  const [email, setEmail] = useState(initialEmail || '');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [changing, setChanging] = useState(false);
  const [newEmail, setNewEmail] = useState('');

  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const timer = window.setTimeout(() => setResendIn(resendIn - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  const submitCode = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from your email.');
      return;
    }
    setBusy(true);
    try {
      const data = await verifyEmailCode(email, code);
      setVerified(true);
      setMessage(data?.message || 'Email verified.');
      onVerified?.(data?.user);
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'That code is invalid or has expired.');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!email || resendIn > 0 || busy) return;
    setError('');
    setMessage('');
    setBusy(true);
    try {
      await resendVerification(email);
      // Generic on purpose — the server never reveals whether the account exists.
      setMessage('If that address has an unverified account, a new code has been sent.');
      setResendIn(RESEND_SECONDS);
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Could not resend right now. Please try again shortly.');
    } finally {
      setBusy(false);
    }
  };

  const submitNewEmail = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!newEmail.trim()) {
      setError('Enter your email address.');
      return;
    }
    setBusy(true);
    try {
      const data = await changeVerificationEmail(newEmail.trim());
      const updated = data?.email || newEmail.trim();
      setEmail(updated);
      setNewEmail('');
      setCode('');
      setChanging(false);
      setResendIn(RESEND_SECONDS);
      setMessage('A fresh code is on its way to your new address.');
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Could not update the email address.');
    } finally {
      setBusy(false);
    }
  };

  if (verified) {
    return (
      <div className="text-center" data-testid="email-code-verified">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-cric-accent/20 text-2xl text-cric-accent">✓</div>
        <p className="font-bold text-cric-text">{message}</p>
        <p className="mt-2 text-sm text-cric-muted">
          You can now create organizations, teams, players and tournaments.
        </p>
      </div>
    );
  }

  return (
    <div className={compact ? '' : 'text-left'} data-testid="email-code-form">
      <p className="text-[10px] font-black uppercase tracking-widest text-cric-muted">
        Verify your email <span lang="ur" dir="rtl">اپنا ای میل تصدیق کریں</span>
      </p>
      <p className="mt-2 text-sm font-semibold leading-relaxed text-cric-muted">
        Enter the 6-digit code we sent to{' '}
        <span className="font-black text-cric-accent">{email || 'your email address'}</span>.{' '}
        <span lang="ur" dir="rtl">ہم نے آپ کے ای میل پر 6 ہندسوں کا کوڈ بھیجا ہے۔</span>
      </p>

      <form onSubmit={submitCode} className="mt-4 flex flex-col gap-3">
        <input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="000000"
          aria-label="6-digit verification code"
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
          className="w-full rounded-lg border border-cric-border bg-cric-bg px-3 py-3 text-center text-lg font-black tracking-[0.4em] text-cric-text focus:outline-none focus:ring-2 focus:ring-cric-accent/30 focus:border-cric-accent"
        />
        {error && <p role="alert" className="text-sm font-bold text-red-500">{error}</p>}
        {message && <p className="text-sm font-bold text-green-600">{message}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={busy || !/^\d{6}$/.test(code)}
            className="rounded-lg bg-cric-accent px-6 py-3 text-[10px] font-black uppercase tracking-widest text-white shadow-sm transition hover:bg-orange-600 disabled:opacity-60"
          >
            {busy ? 'Verifying...' : 'Verify email'}
          </button>
          <button
            type="button"
            onClick={resend}
            disabled={busy || resendIn > 0 || !email}
            className="rounded-lg bg-cric-bg px-6 py-3 text-[10px] font-black uppercase tracking-widest text-cric-muted transition hover:bg-cric-border disabled:opacity-60"
          >
            {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
          </button>
          <button
            type="button"
            onClick={() => setChanging((value) => !value)}
            disabled={busy}
            className="text-[10px] font-black uppercase tracking-widest text-cric-accent underline disabled:opacity-60"
          >
            Change email
          </button>
        </div>
      </form>

      {changing && (
        <form onSubmit={submitNewEmail} className="mt-4 rounded-lg border border-cric-border bg-cric-card p-4">
          <label htmlFor="new-email" className="block text-[10px] font-black uppercase tracking-widest text-cric-muted">
            New email address
          </label>
          <input
            id="new-email"
            type="email"
            value={newEmail}
            onChange={(event) => setNewEmail(event.target.value)}
            placeholder="you@example.com"
            className="mt-2 w-full rounded-lg border border-cric-border bg-cric-bg px-3 py-2 text-sm font-semibold text-cric-text"
          />
          <button
            type="submit"
            disabled={busy || !newEmail.trim()}
            className="mt-3 rounded-lg bg-cric-accent px-5 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-60"
          >
            Send new code
          </button>
          <p className="mt-2 text-[11px] text-cric-muted">
            Changing your address invalidates the old code and unlocks nothing until the new one is verified.
          </p>
        </form>
      )}
    </div>
  );
}
