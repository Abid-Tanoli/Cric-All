import React from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import EmailCodeForm from '../../components/EmailCodeForm';
import { getStoredUser } from './auth';

/**
 * Code-entry screen. Reached from the banner, from the post-signup panel or
 * directly at /verify-email. The old token link is gone: the server only
 * accepts a 6-digit numeric code now.
 */
export default function VerifyEmail() {
  const { token } = useParams();
  const [searchParams] = useSearchParams();
  const email = searchParams.get('email') || getStoredUser()?.email || '';

  return (
    <div className="min-h-screen flex items-center justify-center bg-cric-bg p-6">
      <div className="w-full max-w-md">
        <div className="bg-cric-card rounded-2xl shadow-xl p-6 sm:p-8 border border-cric-border">
          <h1 className="text-3xl font-black text-cric-text">VERIFY EMAIL</h1>
          {token && (
            <p role="status" className="mt-3 rounded-lg bg-cric-accent/10 px-4 py-3 text-sm font-semibold text-cric-text">
              Verification links have been replaced by a 6-digit code. Enter the code from your email below.
            </p>
          )}
          <div className="mt-6">
            <EmailCodeForm email={email} />
          </div>
          <div className="mt-6 space-y-3">
            <Link
              to="/"
              className="block w-full py-3 border border-cric-border text-cric-muted hover:text-cric-text font-black text-sm uppercase tracking-widest rounded-xl transition-all text-center"
            >
              Back to site
            </Link>
            <p className="text-center text-[11px] text-cric-muted">
              Phone/SMS verification is not available yet — your phone number is shown as not verified.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
