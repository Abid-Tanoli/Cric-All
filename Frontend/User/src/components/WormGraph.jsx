import { useMemo } from 'react';

const COLORS = { line1: '#4f46e5', line2: '#f59e0b', fill1: '#4f46e533', fill2: '#f59e0b33' };

export default function WormGraph({ match, compact = false }) {
  const inn1 = match?.innings?.[0];
  const inn2 = match?.innings?.[1];

  const data = useMemo(() => {
    const buildPoints = (overs, totalRuns) => {
      const pts = [{ over: 0, cum: 0 }];
      let cum = 0;
      (overs || []).forEach((o) => {
        cum += o.runsScored || 0;
        pts.push({ over: o.overNumber + 1, cum });
      });
      if (pts.length <= 1 && totalRuns > 0) {
        pts.push({ over: 1, cum: totalRuns });
      }
      return pts;
    };

    const pts1 = buildPoints(inn1?.oversHistory, inn1?.runs);
    const pts2 = inn2 ? buildPoints(inn2?.oversHistory, inn2?.runs) : [];
    const maxOver = Math.max(
      pts1.length > 1 ? pts1[pts1.length - 1].over : 1,
      pts2.length > 1 ? pts2[pts2.length - 1].over : 1,
      1
    );
    const maxRuns = Math.max(
      pts1.length > 0 ? pts1[pts1.length - 1].cum : 0,
      pts2.length > 0 ? pts2[pts2.length - 1].cum : 0,
      1
    );
    return { pts1, pts2, maxOver, maxRuns: Math.max(maxRuns * 1.15, 10) };
  }, [inn1, inn2]);

  if (!data.pts1.length && !data.pts2.length) {
    return <div className="text-gray-500 text-sm text-center py-8">No innings data</div>;
  }

  const W = compact ? 400 : 600;
  const H = compact ? 180 : 250;
  const PAD = { top: 15, right: 15, bottom: 25, left: 40 };
  const cw = W - PAD.left - PAD.right;
  const ch = H - PAD.top - PAD.bottom;
  const xScale = (over) => PAD.left + (over / data.maxOver) * cw;
  const yScale = (runs) => PAD.top + ch - (runs / data.maxRuns) * ch;

  const linePath1 = data.pts1.map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(p.over)},${yScale(p.cum)}`).join(' ');
  const fillPath1 = data.pts1.length > 0
    ? `${linePath1} L${xScale(data.pts1[data.pts1.length - 1].over)},${PAD.top + ch} L${xScale(data.pts1[0].over)},${PAD.top + ch} Z`
    : '';

  const linePath2 = data.pts2.length > 0
    ? data.pts2.map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(p.over)},${yScale(p.cum)}`).join(' ')
    : '';
  const fillPath2 = data.pts2.length > 0
    ? `${linePath2} L${xScale(data.pts2[data.pts2.length - 1].over)},${PAD.top + ch} L${xScale(data.pts2[0].over)},${PAD.top + ch} Z`
    : '';

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(data.maxRuns * f));

  return (
    <div className="bg-gray-900 rounded-lg p-3 overflow-x-auto">
      <div className="flex items-center gap-4 mb-3 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="w-5 h-0.5 rounded" style={{backgroundColor: COLORS.line1}}></span>Team 1
        </span>
        {data.pts2.length > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="w-5 h-0.5 rounded" style={{backgroundColor: COLORS.line2}}></span>Team 2
          </span>
        )}
      </div>
      <svg width={W} height={H} className="overflow-visible">
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={yScale(t)} x2={W - PAD.right} y2={yScale(t)} stroke="#374151" strokeWidth="0.5" />
            <text x={PAD.left - 6} y={yScale(t) + 3} textAnchor="end" className="text-[8px]" fill="#6b7280">{t}</text>
          </g>
        ))}
        {Array.from({ length: data.maxOver + 1 }).map((_, i) => i % 2 === 0 && (
          <text key={i} x={xScale(i)} y={H - 6} textAnchor="middle" className="text-[8px]" fill="#6b7280">{i}</text>
        ))}
        {fillPath1 && <path d={fillPath1} fill={COLORS.fill1} />}
        <path d={linePath1} fill="none" stroke={COLORS.line1} strokeWidth="2" strokeLinejoin="round" />
        {data.pts1.map((p, i) => (
          <circle key={i} cx={xScale(p.over)} cy={yScale(p.cum)} r="2.5" fill={COLORS.line1} className="hover:r-4" />
        ))}
        {fillPath2 && <path d={fillPath2} fill={COLORS.fill2} />}
        {linePath2 && <path d={linePath2} fill="none" stroke={COLORS.line2} strokeWidth="2" strokeLinejoin="round" />}
        {data.pts2.map((p, i) => (
          <circle key={i} cx={xScale(p.over)} cy={yScale(p.cum)} r="2.5" fill={COLORS.line2} />
        ))}
        {inn2?.target && (
          <line x1={PAD.left} y1={yScale(inn2.target)} x2={W - PAD.right} y2={yScale(inn2.target)} stroke="#ef4444" strokeWidth="1" strokeDasharray="4,3" />
        )}
      </svg>
      {!compact && (
        <div className="flex justify-between mt-2 text-xs text-gray-400">
          <span>Team 1: {data.pts1.length > 0 ? `${data.pts1[data.pts1.length - 1].cum}/${match?.innings?.[0]?.wickets || 0}` : '0/0'}</span>
          {data.pts2.length > 0 && (
            <span>Team 2: {data.pts2[data.pts2.length - 1].cum}/{match?.innings?.[1]?.wickets || 0}</span>
          )}
          {inn2?.target && <span className="text-red-400">Target: {inn2.target}</span>}
        </div>
      )}
    </div>
  );
}
