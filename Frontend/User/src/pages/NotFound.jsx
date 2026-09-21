import React from "react";
import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-cric-bg px-4 py-24 text-cric-text flex items-center justify-center">
      <div className="text-center max-w-md">
        <div className="text-7xl font-black text-cric-accent mb-4">404</div>
        <h1 className="text-2xl font-black uppercase tracking-tight mb-3">Page Not Found</h1>
        <p className="text-cric-muted text-sm mb-8">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Link
          to="/"
          className="inline-block px-6 py-3 bg-cric-accent hover:bg-orange-600 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-lg"
        >
          Back to Home
        </Link>
      </div>
    </div>
  );
}