import React, { useState, useEffect } from "react";
import { useScoringAdapters } from "../../ScoringAdapters";

export default React.memo(function FielderSelector({ players, selectedPlayer, onPlayerChange, selectedPosition, onPositionChange }) {
  const { api } = useScoringAdapters();
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.get("/fielding-positions")
      .then(res => {
        if (active) setPositions(res.data || []);
      })
      .catch((err) => {
        if (active) setError(err.response?.data?.message || err.message || "Could not load fielding positions");
      })
      .finally(() => setLoading(false));
    return () => {
      active = false;
    };
  }, [api]);

  return (
    <div className="space-y-4 p-5 rounded-3xl border border-cric-border bg-black/5 dark:bg-white/5">
      <h4 className="text-[10px] font-black uppercase text-slate-500 tracking-[0.3em]">
        FIELDER SELECTION
      </h4>
      <p className="text-[9px] text-cric-muted">
        Select which fielder fielded the ball
      </p>

      <div className="space-y-2">
        <label className="text-[9px] font-black uppercase text-slate-500 tracking-widest pl-2">
          Fielder
        </label>
        <select
          value={selectedPlayer || ""}
          onChange={e => onPlayerChange(e.target.value)}
          className="w-full bg-black/5 dark:bg-white/5 border border-cric-border rounded-2xl p-4 text-cric-text font-bold outline-none appearance-none cursor-pointer hover:bg-black/10 transition-all"
        >
          <option value="">Select Fielder ▼</option>
          {players.map(p => (
            <option key={p._id} value={p._id}>{p.name}</option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <label className="text-[9px] font-black uppercase text-slate-500 tracking-widest pl-2">
          Fielding Position
        </label>
        {loading ? (
          <div className="w-full bg-black/5 dark:bg-white/5 border border-cric-border rounded-2xl p-4 text-cric-muted font-bold">
            Loading positions...
          </div>
        ) : error ? (
          <p role="alert" className="text-sm font-bold text-red-600">{error}</p>
        ) : (
          <select
            value={selectedPosition || ""}
            onChange={e => onPositionChange(e.target.value)}
            className="w-full bg-black/5 dark:bg-white/5 border border-cric-border rounded-2xl p-4 text-cric-text font-bold outline-none appearance-none cursor-pointer hover:bg-black/10 transition-all"
          >
            <option value="">Select Position ▼</option>
            {positions.map(p => (
              <option key={p._id} value={p.name}>{p.name}</option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
});
