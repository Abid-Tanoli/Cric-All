import React from 'react';

const PartnershipWheel = ({ partnerships = [], totalScore = 0 }) => {
  const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1'];
  
  const segments = partnerships.map((p, idx) => {
    const percentage = totalScore > 0 ? (p.runs / totalScore) * 100 : 0;
    const prevPercentage = partnerships.slice(0, idx).reduce((sum, prev) => sum + (totalScore > 0 ? (prev.runs / totalScore) * 100 : 0), 0);
    
    return {
      ...p,
      percentage,
      prevPercentage,
      color: colors[idx % colors.length]
    };
  });

  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const center = 100;

  const getCoordinates = (percentage) => {
    const startAngle = -90 + (percentage * 3.6);
    const x = center + radius * Math.cos(startAngle * Math.PI / 180);
    const y = center + radius * Math.sin(startAngle * Math.PI / 180);
    return { x, y };
  };

  return (
    <div className="bg-[#0d1b2a] dark:bg-[#020617] rounded-3xl p-6 border border-slate-800/50">
      <h3 className="text-[#ff6b35] text-[10px] font-black uppercase tracking-widest mb-4">Partnership Distribution</h3>
      
      <div className="flex items-center gap-6">
        <div className="relative w-48 h-48">
          <svg viewBox="0 0 200 200" className="w-full h-full">
            <circle cx={center} cy={center} r={radius} fill="none" stroke="#1e293b" strokeWidth="30" />
            
            {segments.map((seg, idx) => {
              if (seg.percentage < 1) return null;
              const dashArray = (seg.percentage / 100) * circumference;
              const dashOffset = (seg.prevPercentage / 100) * circumference;
              
              return (
                <circle
                  key={idx}
                  cx={center}
                  cy={center}
                  r={radius}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth="30"
                  strokeDasharray={`${dashArray} ${circumference}`}
                  strokeDashoffset={-dashOffset}
                  className="transition-all duration-500 hover:stroke-width-35 cursor-pointer"
                />
              );
            })}
            
            <text x={center} y={center - 10} textAnchor="middle" className="fill-white text-xs font-black">TOTAL</text>
            <text x={center} y={center + 15} textAnchor="middle" className="fill-white text-xl font-black">{totalScore}</text>
          </svg>
        </div>
        
        <div className="flex-1 space-y-2 max-h-48 overflow-y-auto">
          {segments.map((seg, idx) => (
            <div key={idx} className="flex items-center gap-2 text-xs">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: seg.color }} />
              <span className="text-slate-400">Wkt {seg.wicketNumber}:</span>
              <span className="text-white font-medium">{seg.runs} runs</span>
              <span className="text-slate-500">({seg.percentage.toFixed(1)}%)</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default PartnershipWheel;