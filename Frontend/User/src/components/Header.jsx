import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import ThemeToggle from "./ThemeToggle";

export default function Header({ user, onShowLogin, onShowRegister, onLogout }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems = [
    { name: "Matches", path: "/" },
    { name: "Series", path: "/series" },
    { name: "International", path: "/international" },
    { name: "Teams", path: "/teams" },
    { name: "Players", path: "/players" },
    { name: "Highlights", path: "/highlights" },
    { name: "News", path: "/cricket-news" },
    { name: "Videos", path: "/videos" },
    { name: "Rankings", path: "/rankings" },
    { name: "Standings", path: "/points-table" },
  ];

  const closeMobile = () => setMobileMenuOpen(false);
  const openLogin = () => {
    if (onShowLogin) onShowLogin();
    else navigate("/login");
  };
  const openRegister = () => {
    if (onShowRegister) onShowRegister();
    else navigate("/register");
  };

  const isHandler = Boolean(user && (user.accountType === "handler" || user.accountType === "organization_admin"));
  const isDashboardActive = location.pathname === "/dashboard";

  return (
    <header className="bg-cric-card border-b border-cric-border sticky top-0 z-50 shadow-xl">
      <div className="max-w-7xl mx-auto px-4 py-4 flex flex-wrap justify-between items-center gap-3">
        <div className="flex items-center gap-5 min-w-0">
          <Link to="/" className="text-2xl font-black font-raj italic text-cric-text tracking-tighter" onClick={closeMobile}>
            CricAll
            <span className="text-cric-accent">.</span>
          </Link>
        </div>

        {/* Desktop nav links */}
        <nav className="hidden lg:flex items-center gap-1 overflow-x-auto no-scrollbar">
          {navItems.map(item => (
            <Link
              key={item.name}
              to={item.path}
              className={`shrink-0 text-[10px] font-black uppercase tracking-widest transition-all ${
                location.pathname === item.path
                  ? "text-white bg-cric-accent shadow-md"
                  : "text-cric-muted hover:text-cric-text hover:bg-black/5 dark:hover:bg-white/5"
              } px-4 py-2 rounded-lg min-h-[44px] flex items-center`}
            >
              {item.name}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2 sm:gap-4">
          <ThemeToggle />
          {user ? (
            <div className="hidden sm:flex items-center gap-4">
              {isHandler && (
                <Link
                  to="/dashboard"
                  className={`shrink-0 text-[10px] font-black uppercase tracking-widest transition-all px-4 py-2 rounded-lg min-h-[44px] flex items-center ${
                    isDashboardActive
                      ? "text-white bg-cric-accent shadow-md"
                      : "text-cric-muted hover:text-cric-text hover:bg-black/5 dark:hover:bg-white/5"
                  }`}
                >
                  My Dashboard
                </Link>
              )}
              <div className="text-right">
                <div className="text-xs font-black text-cric-text uppercase tracking-tight">{user.name}</div>
                <div className="text-[9px] text-cric-muted font-bold uppercase tracking-widest">{user.role || 'user'}</div>
              </div>
              <button
                onClick={onLogout}
                className="px-4 py-2 bg-cric-accent hover:bg-orange-600 text-white text-[10px] font-black uppercase tracking-widest rounded-lg transition-all shadow-lg min-h-[44px]"
              >Logout</button>
            </div>
          ) : (
            <div className="hidden sm:flex items-center gap-3">
              <button
                onClick={openLogin}
                className="text-cric-muted hover:text-cric-text text-[10px] font-black uppercase tracking-widest px-4 py-2 transition-colors min-h-[44px]"
              >Login</button>
              <button
                onClick={openRegister}
                className="px-6 py-2.5 bg-cric-accent hover:bg-orange-600 text-white text-[10px] font-black uppercase tracking-widest rounded-xl shadow-lg transition-all active:scale-95 min-h-[44px]"
              >Join Now</button>
            </div>
          )}

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden text-cric-muted hover:text-cric-accent p-2 min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Toggle menu"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {mobileMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileMenuOpen && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40 lg:hidden" onClick={closeMobile} />
          <div className="lg:hidden fixed top-[73px] left-0 right-0 z-50 bg-cric-card border-b border-cric-border shadow-xl max-h-[calc(100vh-73px)] overflow-y-auto">
            <nav className="flex flex-col p-4 gap-1">
              {navItems.map(item => (
                <Link
                  key={item.name}
                  to={item.path}
                  onClick={closeMobile}
                  className={`text-sm font-black uppercase tracking-widest transition-all px-4 py-3 rounded-lg min-h-[44px] flex items-center ${
                    location.pathname === item.path
                      ? "text-white bg-cric-accent shadow-md"
                      : "text-cric-muted hover:text-cric-text hover:bg-black/5 dark:hover:bg-white/5"
                  }`}
                >
                  {item.name}
                </Link>
              ))}
            </nav>
            <div className="border-t border-cric-border p-4">
              {user ? (
                <div className="space-y-3">
                  <div className="text-center">
                    <div className="text-sm font-black text-cric-text">{user.name}</div>
                    <div className="text-[10px] text-cric-muted font-bold uppercase tracking-widest">{user.role || 'user'}</div>
                  </div>
                  {isHandler && (
                    <Link
                      to="/dashboard"
                      onClick={closeMobile}
                      className={`w-full block text-center px-4 py-3 text-xs font-black uppercase tracking-widest rounded-xl transition-all min-h-[44px] ${
                        isDashboardActive
                          ? "bg-cric-accent text-white"
                          : "border border-cric-border text-cric-muted hover:text-cric-text"
                      }`}
                    >
                      My Dashboard
                    </Link>
                  )}
                  <button
                    onClick={() => { onLogout(); closeMobile(); }}
                    className="w-full px-4 py-3 bg-cric-accent hover:bg-orange-600 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all min-h-[44px]"
                  >Logout</button>
                </div>
              ) : (
                <div className="flex gap-3">
                  <button
                    onClick={() => { openLogin(); closeMobile(); }}
                    className="flex-1 px-4 py-3 border border-cric-border text-cric-muted hover:text-cric-text text-xs font-black uppercase tracking-widest rounded-xl transition-all min-h-[44px]"
                  >Login</button>
                  <button
                    onClick={() => { openRegister(); closeMobile(); }}
                    className="flex-1 px-4 py-3 bg-cric-accent hover:bg-orange-600 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all min-h-[44px]"
                  >Join Now</button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </header>
  );
}
