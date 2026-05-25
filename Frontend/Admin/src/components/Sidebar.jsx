import React from "react";
import { NavLink } from "react-router-dom";

const menuItems = [
  { to: "/admin", label: "Dashboard", icon: "📊" },
  { to: "/admin/live", label: "Live Scores", icon: "🏏" },
  { to: "/admin/international", label: "International", icon: "🌍" },
  { to: "/admin/score", label: "Live Scoring", icon: "🎯" },
  { to: "/admin/events", label: "Manage Events", icon: "📅" },
  { to: "/admin/teams", label: "Manage Teams", icon: "👥" },
  { to: "/admin/players", label: "Manage Players", icon: "⭐" },
  { to: "/admin/bulk-import", label: "Bulk Import", icon: "📥" },
  { to: "/admin/blogs", label: "Manage Blogs", icon: "📝" },
  { to: "/admin/rankings", label: "Rankings", icon: "🎖️" },
  { to: "/admin/sync", label: "Sync Panel", icon: "🔄" },
];

export default function Sidebar({ onClose }) {
  return (
    <aside className="w-64 bg-cric-card border-r border-cric-border flex flex-col h-full transition-colors duration-300">
      <div className="p-6 border-b border-cric-border">
        <h1 className="text-xl font-black font-raj text-cric-accent tracking-tight">BQ-PLAY</h1>
        <p className="text-xs text-cric-muted mt-1 uppercase tracking-widest font-bold">Admin Panel</p>
      </div>
      <nav className="flex-1 p-4 overflow-y-auto no-scrollbar">
        <ul className="space-y-1">
          {menuItems.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === "/admin"}
                onClick={onClose}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-bold transition-all duration-200 ${isActive
                    ? "bg-cric-accent text-white shadow-md shadow-cric-accent/20"
                    : "text-cric-muted hover:bg-cric-bg hover:text-cric-text"
                  }`
                }
              >
                <span>{item.icon}</span>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
