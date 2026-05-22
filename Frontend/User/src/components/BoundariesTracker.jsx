import React from 'react';

const BoundariesTracker = ({ inning1 = {}, inning2 = {}, total = {} }) => {
  const formatPercent = (boundaryRuns, totalRuns) => {
    if (!totalRuns) return '0%';
    return `${((boundaryRuns / totalRuns) * 100).toFixed(1)}%`;
  };

  return (
    <div className="bg-[#0d1b2a] dark:bg-[#020617] rounded-3xl p-6 border border-slate-800/50">
      <h3 className="text-[#ff6b35] text-[10px] font-black uppercase tracking-widest mb-4">Match Boundaries</h3>
      
      <div className="space-y-4">
        {/* 1st Innings */}
        <div className="p-4 bg-slate-800/30 rounded-2xl">
          <div className="text-xs text-slate-500 font-black uppercase mb-3">1st Innings</div>
          
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-slate-400">Fours</span>
                <span className="text-blue-400 font-medium">{inning1.fours || 0}</span>
              </div>
              <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500" style={{ width: `${Math.min(100, (inning1.fours || 0) * 8)}%` }} />
              </div>
            </div>
            
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-slate-400">Sixes</span>
                <span className="text-purple-400 font-medium">{inning1.sixes || 0}</span>
              </div>
              <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                <div className="h-full bg-purple-500" style={{ width: `${Math.min(100, (inning1.sixes || 0) * 20)}%` }} />
              </div>
            </div>
            
            <div className="pt-2 border-t border-slate-700">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Boundary Runs</span>
                <span className="text-white font-medium">
                  {inning1.boundaryRuns || 0} / {inning1.totalRuns || 0} ({formatPercent(inning1.boundaryRuns, inning1.totalRuns)})
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 2nd Innings */}
        {inning2.totalRuns > 0 && (
          <div className="p-4 bg-slate-800/30 rounded-2xl">
            <div className="text-xs text-slate-500 font-black uppercase mb-3">2nd Innings</div>
            
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-slate-400">Fours</span>
                  <span className="text-blue-400 font-medium">{inning2.fours || 0}</span>
                </div>
                <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500" style={{ width: `${Math.min(100, (inning2.fours || 0) * 8)}%` }} />
                </div>
              </div>
              
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-slate-400">Sixes</span>
                  <span className="text-purple-400 font-medium">{inning2.sixes || 0}</span>
                </div>
                <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                  <div className="h-full bg-purple-500" style={{ width: `${Math.min(100, (inning2.sixes || 0) * 20)}%` }} />
                </div>
              </div>
              
              <div className="pt-2 border-t border-slate-700">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Boundary Runs</span>
                  <span className="text-white font-medium">
                    {inning2.boundaryRuns || 0} / {inning2.totalRuns || 0} ({formatPercent(inning2.boundaryRuns, inning2.totalRuns)})
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Total */}
        <div className="p-4 bg-gradient-to-r from-amber-600/20 to-orange-600/20 rounded-2xl border border-amber-500/30">
          <div className="flex justify-between items-center">
            <span className="text-xs text-amber-500 font-black uppercase">Total Match</span>
            <div className="text-right">
              <span className="text-white font-black">{total.fours || 0} Fours</span>
              <span className="text-slate-500 mx-2">|</span>
              <span className="text-purple-400 font-black">{total.sixes || 0} Sixes</span>
            </div>
          </div>
          <div className="mt-2 text-center">
            <span className="text-2xl font-black text-amber-400">{total.boundaryRuns || 0}</span>
            <span className="text-xs text-slate-500 ml-2">Total Boundary Runs</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BoundariesTracker;