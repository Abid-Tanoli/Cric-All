import React from "react";
import { Link } from "react-router-dom";
import { useCricketProviderStatus, isProviderConfigured } from "../hooks/useCricketProviderStatus";

export default function Footer() {
  const year = new Date().getFullYear();
  // The international pages have nothing to show without a configured provider.
  const showInternational = isProviderConfigured(useCricketProviderStatus());

  return (
    <footer className="border-t border-cric-border bg-cric-card mt-12">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6 sm:gap-8">
          <div className="col-span-2 sm:col-span-1">
            <Link to="/" className="text-xl font-black font-raj italic text-cric-text tracking-tighter">
              CricAll<span className="text-cric-accent">.</span>
            </Link>
            <p className="mt-2 text-xs sm:text-sm text-cric-muted leading-relaxed">
              Live cricket scores, match coverage, player stats, and more.
            </p>
          </div>
          <div>
            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-cric-muted mb-3">Matches</h4>
            <ul className="space-y-2">
              <li><Link to="/live" className="text-xs sm:text-sm text-cric-text hover:text-cric-accent transition-colors">Live Scores</Link></li>
              <li><Link to="/series" className="text-xs sm:text-sm text-cric-text hover:text-cric-accent transition-colors">Series</Link></li>
              {showInternational && (
                <li><Link to="/international" className="text-xs sm:text-sm text-cric-text hover:text-cric-accent transition-colors">International</Link></li>
              )}
            </ul>
          </div>
          <div>
            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-cric-muted mb-3">Teams</h4>
            <ul className="space-y-2">
              <li><Link to="/teams" className="text-xs sm:text-sm text-cric-text hover:text-cric-accent transition-colors">All Teams</Link></li>
              {showInternational && (
                <li><Link to="/teams/international" className="text-xs sm:text-sm text-cric-text hover:text-cric-accent transition-colors">International</Link></li>
              )}
              <li><Link to="/teams/leagues" className="text-xs sm:text-sm text-cric-text hover:text-cric-accent transition-colors">Leagues</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-cric-muted mb-3">More</h4>
            <ul className="space-y-2">
              <li><Link to="/players" className="text-xs sm:text-sm text-cric-text hover:text-cric-accent transition-colors">Players</Link></li>
              <li><Link to="/rankings" className="text-xs sm:text-sm text-cric-text hover:text-cric-accent transition-colors">Rankings</Link></li>
              <li><Link to="/highlights" className="text-xs sm:text-sm text-cric-text hover:text-cric-accent transition-colors">Highlights</Link></li>
            </ul>
          </div>
        </div>
        <div className="mt-8 sm:mt-10 pt-6 sm:pt-8 border-t border-cric-border flex flex-col sm:flex-row justify-between items-center gap-3">
          <p className="text-[10px] sm:text-xs font-bold text-cric-muted">
            &copy; {year} CricAll. All rights reserved.
          </p>
          <p className="text-[9px] sm:text-[10px] font-bold text-cric-muted">
            Powered by the CricAll Scoring Engine
          </p>
        </div>
      </div>
    </footer>
  );
}
