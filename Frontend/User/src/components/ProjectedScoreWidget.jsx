import React from 'react';

const ProjectedScoreWidget = ({ 
  currentScore = 0, 
  currentWickets = 0, 
  currentOvers = 0, 
  projectedScore = 0,
  rangeLow = 0,
  rangeHigh = 0,
  projectionHistory = []
}) => {
  const runRate = currentOvers > 0 ? (currentScore / currentOvers).toFixed(2) : "0.00";

  return (
    <div className="bg-[#0d1b2a] dark:bg-[#020617] rounded-3xl p-6 border border-slate-800/50">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-[#ff6b35] text-[10px] font-black uppercase tracking-widest mb-2">Projected Score</h3>
          <p className="text-slate-400 text-sm">
            {currentScore}/{currentWickets} ({currentOvers} ov)
          </p>
        </div>
        <div className="text-right">
          <span className="text-xs text-slate-500">CRR</span>
          <p className="text-xl font-black text-white">{runRate}</p>
        </div>
      </div>

      <div className="bg-gradient-to-r from-blue-600/20 via-purple-600/20 to-blue-600/20 rounded-2xl p-4 mb-4 border border-blue-500/30">
        <div className="text-center">
          <span className="text-[10px] text-slate-500 font-black uppercase tracking-widest">Projected Final</span>
          <div className="text-4xl font-black text-white mt-1 tracking-tighter">
            {rangeLow} - {rangeHigh}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="bg-green-500/10 rounded-xl p-3 border border-green-500/20">
          <div className="text-[10px] text-slate-500 font-black uppercase">Best</div>
          <div className="text-lg font-black text-green-400">{rangeHigh}</div>
        </div>
        <div className="bg-blue-500/10 rounded-xl p-3 border border-blue-500/20">
          <div className="text-[10px] text-slate-500 font-black uppercase">Likely</div>
          <div className="text-lg font-black text-blue-400">{projectedScore}</div>
        </div>
        <div className="bg-red-500/10 rounded-xl p-3 border border-red-500/20">
          <div className="text-[10px] text-slate-500 font-black uppercase">Worst</div>
          <div className="text-lg font-black text-red-400">{rangeLow}</div>
        </div>
      </div>

      {projectionHistory.length > 1 && (
        <div className="mt-4 h-16 relative">
          <div className="absolute inset-0 flex items-end justify-between gap-1 px-1">
            {projectionHistory.slice(-10).map((entry, idx) => {
              const maxScore = Math.max(...projectionHistory.map(e => e.projectedScore));
              const height = maxScore > 0 ? (entry.projectedScore / maxScore) * 100 : 0;
              return (
                <div 
                  key={idx} 
                  className="flex-1 bg-blue-500/50 rounded-t hover:bg-blue-400 transition-all"
                  style={{ height: `${height}%` }}
                  title={`Over ${entry.over}: ${entry.projectedScore}`}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectedScoreWidget;