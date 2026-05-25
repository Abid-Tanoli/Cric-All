import React, { useMemo } from 'react';

const ZONES = [
  { label: 'Fine Leg', min: -180, max: -140 },
  { label: 'Square Leg', min: -140, max: -100 },
  { label: 'Mid Wicket', min: -100, max: -50 },
  { label: 'Long On', min: -50, max: -15 },
  { label: 'Straight', min: -15, max: 15 },
  { label: 'Long Off', min: 15, max: 50 },
  { label: 'Cover', min: 50, max: 100 },
  { label: 'Point', min: 100, max: 140 },
  { label: 'Third Man', min: 140, max: 180 },
];

const zoneAngle = (angle) => {
  for (const z of ZONES) {
    if (angle >= z.min && angle < z.max) return z;
  }
  return ZONES[4];
};

const getBarColor = (runs) => {
  if (runs >= 6) return '#a855f7';
  if (runs >= 4) return '#3b82f6';
  if (runs >= 2) return '#f59e0b';
  return '#94a3b8';
};

const SpikeGraph = ({ shots = [], playerName = "Batsman" }) => {
  const zoneStats = useMemo(() => {
    const stats = {};
    ZONES.forEach(z => { stats[z.label] = { total: 0, count: 0, max: 0, runs: 0, boundaries: 0, sixes: 0 }; });
    (shots || []).forEach(s => {
      const zone = zoneAngle(s.angle || 0);
      if (!zone) return;
      const st = stats[zone.label];
      st.count += 1;
      st.total += s.runs || 0;
      st.runs += s.runs || 0;
      if ((s.runs || 0) >= 6) st.sixes += 1;
      else if ((s.runs || 0) >= 4) st.boundaries += 1;
      st.max = Math.max(st.max, s.runs || 0);
    });
    return stats;
  }, [shots]);

  const maxCount = Math.max(...Object.values(zoneStats).map(z => z.count), 1);

  const totalRuns = shots.reduce((a, s) => a + (s.runs || 0), 0);
  const totalBalls = shots.length;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Productive Shots</h3>
            <h2 className="text-lg font-black text-slate-800 mt-0.5">{playerName}</h2>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <div><span className="font-black text-slate-800">{totalRuns}</span> <span className="text-slate-400 font-bold">runs</span></div>
            <div><span className="font-black text-slate-800">{totalBalls}</span> <span className="text-slate-400 font-bold">balls</span></div>
            <div><span className="font-black text-slate-800">{totalBalls ? ((totalRuns / totalBalls) * 100).toFixed(1) : '0.0'}</span> <span className="text-slate-400 font-bold">SR</span></div>
          </div>
        </div>
      </div>

      <div className="p-5">
        <div className="flex items-end justify-around gap-1 h-48 border-b border-l border-slate-200 relative">
          {/* Grid lines */}
          {[0.25, 0.5, 0.75].map(pct => (
            <div key={pct} className="absolute w-full border-t border-slate-100" style={{ bottom: `${pct * 100}%` }}>
              <span className="absolute -left-6 -top-2 text-[9px] font-bold text-slate-300">{Math.round(pct * maxCount)}</span>
            </div>
          ))}

          {ZONES.map(zone => {
            const st = zoneStats[zone.label];
            const height = st.count > 0 ? (st.count / maxCount) * 100 : 2;
            const color = st.boundaries > 0 || st.sixes > 0 ? '#3b82f6' : '#94a3b8';

            return (
              <div key={zone.label} className="flex-1 flex flex-col items-center group relative">
                {/* Bar */}
                <div
                  className="w-full max-w-[32px] rounded-t-sm transition-all duration-300 hover:opacity-80 relative"
                  style={{
                    height: `${Math.max(height, 2)}%`,
                    backgroundColor: color,
                    minHeight: st.count > 0 ? '4px' : '2px',
                  }}
                >
                  {/* Score overlay */}
                  {st.runs > 0 && (
                    <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] font-black text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                      {st.runs} runs
                    </div>
                  )}
                </div>

                {/* Zone label */}
                <span className="text-[8px] font-bold text-slate-400 uppercase mt-1.5 text-center leading-tight">
                  {zone.label.split(' ').map((w, i) => <React.Fragment key={i}>{w}<br /></React.Fragment>)}
                </span>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-4 mt-4 text-[10px] font-bold">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded bg-slate-300" />
            <span className="text-slate-500">1s/2s</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded bg-blue-500" />
            <span className="text-slate-500">Boundaries</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded bg-purple-500" />
            <span className="text-slate-500">Sixes</span>
          </div>
        </div>

        {/* Zone breakdown */}
        {totalRuns > 0 && (
          <div className="mt-5 grid grid-cols-3 gap-2">
            {ZONES.filter(z => zoneStats[z.label].count > 0).slice(0, 6).map(zone => {
              const st = zoneStats[zone.label];
              return (
                <div key={zone.label} className="bg-slate-50 rounded-lg p-2 text-center">
                  <p className="text-lg font-black text-slate-700">{st.runs}</p>
                  <p className="text-[8px] font-bold text-slate-400 uppercase">{zone.label}</p>
                  <p className="text-[8px] text-slate-400">{st.count} balls{st.boundaries > 0 ? ` • ${st.boundaries}×4` : ''}{st.sixes > 0 ? ` • ${st.sixes}×6` : ''}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default SpikeGraph;
