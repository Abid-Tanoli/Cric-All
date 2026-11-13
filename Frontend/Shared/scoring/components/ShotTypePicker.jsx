import React, { useEffect, useState } from "react";
import ShotSilhouette from "./ShotSilhouette";
import { SHOTS, SHOT_CATEGORIES } from "../data/shotsData";

const CATEGORY_ORDER = ["front_foot", "back_foot", "leg_side", "unorthodox", "power", "defensive"];

export default React.memo(function ShotTypePicker({ isOpen, onClose, onSelect, currentShot }) {
  const [activeTab, setActiveTab] = useState("front_foot");

  useEffect(() => {
    if (!isOpen || !currentShot) return;
    const selectedShot = SHOTS.find(shot => shot.id === currentShot);
    if (selectedShot) setActiveTab(selectedShot.category);
  }, [isOpen, currentShot]);

  if (!isOpen) return null;

  const categories = CATEGORY_ORDER
    .map(id => [id, SHOT_CATEGORIES[id]])
    .filter(([id, category]) => category && SHOTS.some(shot => shot.category === id));
  const activeShots = SHOTS.filter(shot => shot.category === activeTab);

  const handleSelect = (shot) => {
    onSelect?.(shot);
    onClose?.();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-cric-card w-full max-w-6xl max-h-[90vh] rounded-[2rem] border border-cric-border shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-cric-card z-10 border-b border-cric-border/30 px-8 pt-6 pb-5 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-black text-cric-text uppercase tracking-tight">Pick Shot</h2>
            <p className="text-[9px] font-black text-cric-muted uppercase tracking-[0.3em] mt-1">
              Select the shot played
            </p>
          </div>
          <button onClick={onClose} className="w-10 h-10 rounded-full bg-cric-bg hover:bg-red-500 transition-all flex items-center justify-center text-cric-muted hover:text-white">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 sm:px-8 pt-5 flex gap-2 overflow-x-auto border-b border-cric-border/20 no-scrollbar">
          {categories.map(([catId, category]) => (
            <button
              key={catId}
              onClick={() => setActiveTab(catId)}
              className={`px-4 py-3 text-[10px] font-black uppercase tracking-widest rounded-t-xl transition-all whitespace-nowrap ${
                activeTab === catId
                  ? "text-white shadow-lg"
                  : "text-cric-muted hover:text-cric-text bg-black/5 dark:bg-white/5"
              }`}
              style={activeTab === catId ? { background: category.color } : undefined}
            >
              {category.label} ({SHOTS.filter(shot => shot.category === catId).length})
            </button>
          ))}
        </div>

        <div className="p-6 sm:p-8 overflow-y-auto max-h-[calc(90vh-170px)] no-scrollbar">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {activeShots.map(shot => {
              const category = SHOT_CATEGORIES[shot.category];
              const isSelected = currentShot === shot.id;

              return (
                <button
                  key={shot.id}
                  onClick={() => handleSelect(shot)}
                  className={`group flex items-center gap-4 rounded-2xl border-2 p-4 text-left transition-all ${
                    isSelected
                      ? "border-cric-accent bg-cric-accent/10 shadow-lg shadow-cric-accent/10"
                      : "border-cric-border/50 bg-black/[0.03] hover:border-cric-accent/40 hover:bg-cric-accent/[0.03] dark:bg-white/[0.03]"
                  }`}
                >
                  <div className="shrink-0 rounded-xl bg-black/5 p-2 dark:bg-white/5 flex items-center justify-center" style={{ minWidth: 82, minHeight: 82 }}>
                    <ShotSilhouette shot={shot} size={68} color={category?.color || '#6b7280'} />
                  </div>
                  <div className="min-w-0">
                    <h4 className="font-black text-sm text-cric-text leading-tight uppercase">{shot.name}</h4>
                    <p className="text-[10px] text-slate-500 mt-1.5 leading-relaxed">{shot.desc}</p>
                    <span
                      className="inline-block mt-2 text-[8px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest"
                      style={{ background: `${category?.color || "#6b7280"}20`, color: category?.color || "#6b7280" }}
                    >
                      {category?.label || "Shot"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
});
