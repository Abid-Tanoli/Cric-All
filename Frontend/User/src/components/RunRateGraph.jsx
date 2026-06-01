import { useMemo } from 'react';

const COLORS = { crr: '#22c55e', rrr: '#ef4444', fill: '#22c55e22' };

export default function RunRateGraph({ match, compact = false }) {
  const inn2 = match?.innings?.[1];
  const inn1 = match?.innings?.[0];

  const data = useMemo(() => {
    if (!inn2 || !inn1) return { points: [], maxRate: 8 };
    const overs = inn2.oversHistory || [];
    const target = inn2.target || inn1?.runs + 1 || 0;
    const totalOvers = match?.totalOvers || 20;
    const points = [];
    let cumRuns = 0;
    let maxRate = 8;

    points.push({ over: 0, crr: 0, rrr: target > 0 ? (target / totalOvers) : 0 });
    overs.forEach((o) => {
      const ov = o.overNumber + 1;
      cumRuns += o.runsScored || 0;
      const crr = ov > 0 ? cumRuns / ov : 0;
      const remainingOvers = Math.max(totalOvers - ov, 0.1);
      const rrr = target > cumRuns ? (target - cumRuns) / remainingOvers : 0;
      points.push({ over: ov, crr: +crr.toFixed(2), rrr: +rrr.toFixed(2) });
      maxRate = Math.max(maxRate, crr, rrr);
    });

    return { points, maxRate: Math.ceil(maxRate * 1.3) };
  }, [inn1, inn2, match]);

  if (!data.points.length || data.points.length <= 1) {
    return <div className="text-gray-500 text-sm text-center py-8">No second innings data yet</div>;
  }

  const W = compact ? 400 : 600;
  const H = compact ? 160 : 220;
  const PAD = { top: 10, right: 15, bottom: 22, left: 35 };
  const cw = W - PAD.left - PAD.right;
  const ch = H - PAD.top - PAD.bottom;
  const maxOver = data.points[data.points.length - 1].over;
  const x = (ov) => PAD.left + (ov / Math.max(maxOver, 1)) * cw;
  const y = (val) => PAD.top + ch - (val / data.maxRate) * ch;

  const crrPath = data.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.over)},${y(p.crr)}`).join(' ');
  const rrrPath = data.points.filter(p => p.rrr > 0).map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.over)},${y(p.rrr)}`).join(' ');

  const yTicks = Array.from({ length: 5 }, (_, i) => Math.round((data.maxRate / 4) * i));

  return (
    <div className="bg-gray-900 rounded-lg p-3 overflow-x-auto">
      <div className="flex items-center gap-4 mb-3 text-xs">
        <span className="flex items-center gap-1.5"><span className="w-5 h-0.5 rounded" style={{backgroundColor: COLORS.crr}}></span>CRR</span>
        <span className="flex items-center gap-1.5"><span className="w-5 h-0.5 rounded" style={{backgroundColor: COLORS.rrr}}></span>RRR</span>
      </div>
      <svg width={W} height={H} className="overflow-visible">
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={y(t)} x2={W - PAD.right} y2={y(t)} stroke="#374151" strokeWidth="0.5" />
            <text x={PAD.left - 4} y={y(t) + 3} textAnchor="end" className="text-[8px]" fill="#6b7280">{t}</text>
          </g>
        ))}
        {Array.from({ length: maxOver + 1 }).map((_, i) => i % 2 === 0 && (
          <text key={i} x={x(i)} y={H - 6} textAnchor="middle" className="text-[8px]" fill="#6b7280">{i}</text>
        ))}
        <path d={crrPath} fill="none" stroke={COLORS.crr} strokeWidth="2" strokeLinejoin="round" />
        {data.points.map((p, i) => (
          <circle key={i} cx={x(p.over)} cy={y(p.crr)} r="2.5" fill={COLORS.crr} />
        ))}
        {rrrPath && <path d={rrrPath} fill="none" stroke={COLORS.rrr} strokeWidth="2" strokeLinejoin="round" strokeDasharray="4,3" />}
        {data.points.filter(p => p.rrr > 0).map((p, i) => (
          <circle key={i} cx={x(p.over)} cy={y(p.rrr)} r="2.5" fill={COLORS.rrr} />
        ))}
      </svg>
      {!compact && (
        <div className="grid grid-cols-2 gap-3 mt-2 text-xs">
          <div className="bg-gray-800 rounded p-2">
            <div className="text-gray-400">Current RR</div>
            <div className="text-green-400 font-semibold text-sm">
              {data.points.length > 0 ? data.points[data.points.length - 1].crr.toFixed(2) : '0.00'}
            </div>
          </div>
          <div className="bg-gray-800 rounded p-2">
            <div className="text-gray-400">Required RR</div>
            <div className="text-red-400 font-semibold text-sm">
              {data.points.length > 0 ? data.points[data.points.length - 1].rrr.toFixed(2) : '0.00'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
