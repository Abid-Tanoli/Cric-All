import React from "react";
import { NavLink } from "react-router-dom";
import { useSelector } from "react-redux";

const menuItems = [
  { to: "/admin", label: "Dashboard", icon: "DB" },
  { to: "/admin/live", label: "Live Scores", icon: "LS" },
  { to: "/admin/international", label: "International", icon: "IN" },
  { to: "/admin/score", label: "Live Scoring", icon: "SC" },
  { to: "/admin/events", label: "Manage Events", icon: "EV" },
  { to: "/admin/teams", label: "Manage Teams", icon: "TM" },
  { to: "/admin/players", label: "Manage Players", icon: "PL" },
  { to: "/admin/bulk-import", label: "Bulk Import", icon: "BI" },
  { to: "/admin/blogs", label: "Manage Blogs", icon: "BL" },
  { to: "/admin/rankings", label: "Rankings", icon: "RK" },
  { to: "/admin/sync", label: "Sync Panel", icon: "SY" },
  { to: "/admin/admins", label: "Manage Admins", icon: "AD", superAdminOnly: true },
];

export default function Sidebar({ open, onClose }) {
  const user = useSelector((state) => state.auth.user);
  const isSuperAdmin = user?.role === "superadmin";
  const visibleItems = menuItems.filter((item) => !item.superAdminOnly || isSuperAdmin);

  return (
    <aside
      className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-cric-card border-r border-cric-border
        flex flex-col h-full transition-transform duration-300 ease-in-out
        lg:translate-x-0
        ${open ? "translate-x-0" : "-translate-x-full"}
      `}
    >
      <div className="p-6 border-b border-cric-border">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-black font-raj text-cric-accent tracking-tight">CricAll</h1>
            <p className="text-xs text-cric-muted mt-1 uppercase tracking-widest font-bold">Admin Panel</p>
          </div>
          <button onClick={onClose} className="lg:hidden text-cric-muted hover:text-cric-accent p-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      <nav className="flex-1 p-3 sm:p-4 overflow-y-auto no-scrollbar overscroll-contain">
        <ul className="space-y-0.5 sm:space-y-1">
          {visibleItems.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === "/admin"}
                onClick={onClose}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg text-xs sm:text-sm font-bold transition-all duration-200 min-h-[44px] ${
                    isActive
                      ? "bg-cric-accent text-white shadow-md shadow-cric-accent/20"
                      : "text-cric-muted hover:bg-cric-bg hover:text-cric-text"
                  }`
                }
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-current/10 text-[10px] font-black">
                  {item.icon}
                </span>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
