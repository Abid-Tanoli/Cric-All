import React from "react";

export default function SquadList({ squads = [] }) {
  if (!squads.length) {
    return <p className="rounded-2xl bg-white p-8 text-center text-sm font-bold text-slate-500 ring-1 ring-slate-200">Squads are not available for this match.</p>;
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {squads.map((squad) => (
        <div key={squad.teamName} className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="bg-[#031d44] px-4 py-3 text-white">
            <h3 className="text-sm font-black uppercase tracking-wide">{squad.teamName}</h3>
            <p className="text-[10px] font-bold uppercase tracking-widest text-blue-200">{squad.players.length} players</p>
          </div>
          <div className="divide-y divide-slate-100">
            {squad.players.map((player, index) => (
              <div key={player.id || player.name || index} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-[11px] font-black text-slate-500">{index + 1}</span>
                  <span className="text-sm font-black text-slate-900">{player.name}</span>
                </div>
                {player.role && <span className="text-[10px] font-bold uppercase text-slate-400">{player.role}</span>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
