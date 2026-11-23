import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Phone/SMS verification is deferred. This route is kept only so old links do
 * not 404; it deliberately offers no OTP form and sends no SMS. Phone numbers
 * are always shown as "not verified" and cannot satisfy the identity gate.
 */
export default function VerifyPhone() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-cric-bg p-6">
      <div className="w-full max-w-md rounded-2xl border border-cric-border bg-cric-card p-8 text-center shadow-xl">
        <h1 className="text-2xl font-black uppercase tracking-tight text-cric-text">Phone verification unavailable</h1>
        <p className="mt-4 text-sm font-semibold leading-relaxed text-cric-muted">
          SMS verification is not available yet. Your phone number is stored for contact only and
          is shown as <strong>not verified</strong>. Verify your email instead to unlock creating
          organizations, teams, players and tournaments.
        </p>
        <Link
          to="/verify-email"
          className="mt-6 block w-full rounded-lg bg-cric-accent px-6 py-3 text-xs font-black uppercase tracking-widest text-white"
        >
          Verify email
        </Link>
        <Link to="/" className="mt-3 block text-[10px] font-black uppercase tracking-widest text-cric-muted underline">
          Back to site
        </Link>
      </div>
    </div>
  );
}
