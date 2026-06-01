import { useMemo } from 'react';

const COLORS = { bar1: '#4f46e5', bar2: '#f59e0b', wicket: '#ef4444' };

function ManhattanTooltip({ over, show }) {
  if (!show || !over) return null;
  return (
    <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs px-2 py-1 rounded whitespace-nowrap z-10 shadow-lg">
      Over {over.over}: <span style={{color: COLORS.bar1}}>{over.runs1}</span> / <span style={{color: COLORS.bar2}}>{over.runs2}</span> runs
    </div>
  );
}

function Bar({ runs, maxRuns, color, wicket, onClick }) {
  const h = maxRuns > 0 ? (runs / maxRuns) * 100 : 0;
  return (
    <div className="relative flex-1 flex flex-col items-center justify-end h-full cursor-pointer group" onClick={onClick}>
      <div
        className="w-3/4 rounded-t transition-all duration-300 hover:opacity-80 relative flex items-start justify-center"
        style={{ height: `${Math.max(h, 2)}%`, backgroundColor: color, minHeight: runs > 0 ? '4px' : '0' }}
      >
        {wicket > 0 && (
          <span className="absolute -top-1 text-[8px] font-bold" style={{color: COLORS.wicket}}>
            {wicket > 1 ? `W×${wicket}` : 'W'}
          </span>
        )}
      </div>
      {runs > 0 && <span className="text-[9px] text-gray-400 mt-0.5">{runs}</span>}
    </div>
  );
}

export default function ManhattanGraph({ match, innings = 0, compact = false }) {
  const inn1 = match?.innings?.[0];
  const inn2 = match?.innings?.[1];

  const data = useMemo(() => {
    const overs1 = inn1?.oversHistory || [];
    const overs2 = inn2?.oversHistory || [];
    const maxOvers = Math.max(overs1.length, overs2.length, 1);
    const rows = [];
    let maxRuns = 0;
    for (let i = 0; i < maxOvers; i++) {
      const r1 = overs1[i]?.runsScored || 0;
      const r2 = overs2[i]?.runsScored || 0;
      const w1 = overs1[i]?.wickets || 0;
      const w2 = overs2[i]?.wickets || 0;
      rows.push({ over: i + 1, runs1: r1, runs2: r2, wicket1: w1, wicket2: w2 });
      maxRuns = Math.max(maxRuns, r1, r2);
    }
    return { rows, maxRuns: Math.max(maxRuns, 1) };
  }, [inn1, inn2]);

  if (data.rows.length === 0) {
    return <div className="text-gray-500 text-sm text-center py-8">No over data available</div>;
  }

  const BARS_PER_GROUP = 2;
  const GROUP_PX = compact ? 24 : 36;
  const SVG_W = data.rows.length * GROUP_PX + 40;
  const SVG_H = compact ? 160 : 220;
  const PAD = { top: 10, right: 10, bottom: 22, left: 10 };
  const chartW = SVG_W - PAD.left - PAD.right;
  const chartH = SVG_H - PAD.top - PAD.bottom;
  const barW = (chartW / data.rows.length / BARS_PER_GROUP) * 0.7;
  const gap = (chartW / data.rows.length / BARS_PER_GROUP) * 0.3;
  const groupW = barW * 2 + gap;

  return (
    <div className="bg-gray-900 rounded-lg p-3 overflow-x-auto">
      <div className="flex items-center gap-4 mb-3 text-xs">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{backgroundColor: COLORS.bar1}}></span>Team 1</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{backgroundColor: COLORS.bar2}}></span>Team 2</span>
      </div>
      <svg width={SVG_W} height={SVG_H} className="overflow-visible">
        {Array.from({ length: 5 }).map((_, i) => {
          const y = PAD.top + (chartH / 5) * i;
          return (
            <g key={i}>
              <line x1={PAD.left} y1={y} x2={SVG_W - PAD.right} y2={y} stroke="#374151" strokeWidth="0.5" />
              <text x={PAD.left - 4} y={y + 3} textAnchor="end" className="text-[8px]" fill="#6b7280">
                {Math.round(data.maxRuns * (1 - i / 5))}
              </text>
            </g>
          );
        })}
        {data.rows.map((row, i) => {
          const x = PAD.left + i * (groupW + gap) + groupW / 4;
          const h1 = chartH * (row.runs1 / data.maxRuns);
          const h2 = chartH * (row.runs2 / data.maxRuns);
          return (
            <g key={i}>
              <rect x={x - barW / 2} y={chartH + PAD.top - h1} width={barW} height={h1} fill={COLORS.bar1} rx="2" />
              <rect x={x + barW / 2} y={chartH + PAD.top - h2} width={barW} height={h2} fill={COLORS.bar2} rx="2" />
              {row.wicket1 > 0 && (
                <text x={x} y={chartH + PAD.top - h1 - 4} textAnchor="middle" fill={COLORS.wicket} fontSize="8" fontWeight="bold">
                  W
                </text>
              )}
              {row.wicket2 > 0 && (
                <text x={x + barW / 2 + barW / 2} y={chartH + PAD.top - h2 - 4} textAnchor="middle" fill={COLORS.wicket} fontSize="8" fontWeight="bold">
                  W
                </text>
              )}
              {i % 2 === 0 && (
                <text x={x + barW / 2} y={SVG_H - 4} textAnchor="middle" fill="#6b7280" fontSize="8">{row.over}</text>
              )}
            </g>
          );
        })}
      </svg>
      {!compact && inn1 && inn2 && (
        <div className="grid grid-cols-2 gap-3 mt-2 text-xs">
          <div className="bg-gray-800 rounded p-2">
            <div className="text-gray-400">Team 1 Highest Over</div>
            <div className="text-white font-semibold">
              {Math.max(...data.rows.map(r => r.runs1))} runs (Over {data.rows.findIndex(r => r.runs1 === Math.max(...data.rows.map(x => x.runs1))) + 1})
            </div>
          </div>
          <div className="bg-gray-800 rounded p-2">
            <div className="text-gray-400">Team 2 Highest Over</div>
            <div className="text-white font-semibold">
              {Math.max(...data.rows.map(r => r.runs2))} runs (Over {data.rows.findIndex(r => r.runs2 === Math.max(...data.rows.map(x => x.runs2))) + 1})
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
