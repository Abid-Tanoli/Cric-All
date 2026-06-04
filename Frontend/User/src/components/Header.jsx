import React from "react";
import { Link, useLocation } from "react-router-dom";
import ThemeToggle from "./ThemeToggle";

export default function Header({ user, onShowLogin, onShowRegister, onLogout }) {
  const location = useLocation();

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

  return (
    <header className="bg-[#031d44] dark:bg-slate-900 border-b border-white/10 dark:border-slate-700 sticky top-0 z-50 shadow-2xl">
      <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
        <div className="flex items-center gap-8">
          <Link to="/" className="text-2xl font-black text-white italic tracking-tighter">
            BQ-PLAY
            <span className="text-red-600">.</span>
          </Link>
          <nav className="hidden lg:flex items-center gap-6">
            {navItems.map(item => (
              <Link
                key={item.name}
                to={item.path}
                className={`text-[10px] font-black uppercase tracking-widest transition-all ${location.pathname === item.path ? "text-white" : "text-blue-200/40 hover:text-white"
                  }`}
              >
                {item.name}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-4">
          <ThemeToggle />
          {user ? (
            <div className="flex items-center gap-4">
              <div className="text-right hidden sm:block">
                <div className="text-xs font-black text-white uppercase tracking-tight">{user.name}</div>
                <div className="text-[9px] text-blue-300/50 font-bold uppercase tracking-widest">{user.role || 'user'}</div>
              </div>
              <button
                onClick={onLogout}
                className="bg-white/10 hover:bg-white/20 text-white text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-lg transition-all border border-white/10"
              >Logout</button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <button
                onClick={onShowLogin}
                className="text-white text-[10px] font-black uppercase tracking-widest hover:text-blue-300 transition-colors px-4 py-2"
              >Login</button>
              <button
                onClick={onShowRegister}
                className="bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-black uppercase tracking-widest px-6 py-2.5 rounded-xl shadow-lg shadow-blue-900/40 transition-all active:scale-95"
              >Join Now</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
