import React, { useState } from "react";

const EyeIcon = ({ hidden }) => (
  <svg
    className="w-5 h-5"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    viewBox="0 0 24 24"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {hidden ? (
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
    ) : (
      <>
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </>
    )}
  </svg>
);

export default function PasswordField({ label, placeholder, error, inputProps, className = "" }) {
  const [show, setShow] = useState(false);

  return (
    <div>
      {label && (
        <label className="block text-xs font-bold uppercase text-cric-muted mb-2">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          className={`w-full px-4 py-3 pr-12 bg-cric-bg border border-cric-border rounded-xl focus:ring-2 focus:ring-cric-accent outline-none font-bold text-cric-text ${className}`}
          placeholder={placeholder}
          {...inputProps}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Hide password" : "Show password"}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-cric-muted hover:text-cric-text transition-colors"
        >
          <EyeIcon hidden={!show} />
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-500 font-bold">{error}</p>}
    </div>
  );
}