import React from 'react';

const ZONE_ANGLES = {
  straight: 0, cover: -50, mid_off: -30, mid_on: 30, mid_wicket: 50,
  point: -90, square_leg: 65, fine_leg: 100, third_man: -130,
  long_on: 45, backward_point: -65, off_side: -40, slips: -90,
};

function getDeg(shot) {
  if (!shot) return null;
  const zoneAngles = { ...ZONE_ANGLES };
  const zoneDeg = zoneAngles[shot.zone];
  return zoneDeg ?? shot.angle;
}

const PITCH_W = 14;
const PITCH_H = 36;
const STUMPS_W = 6;
const STUMPS_H = 4;

export default function ShotSilhouette({ shot, size = 80, color = '#1e293b' }) {
  if (!shot) return null;
  const deg = getDeg(shot);
  const hasDirection = deg != null;

  const viewSize = 100;
  const cx = viewSize / 2;
  const cy = viewSize / 2;
  const boundaryR = 44;
  const innerR = 30;

  const batsmanY = cy - PITCH_H / 2 + 4;
  const rad = deg != null ? (deg - 90) * (Math.PI / 180) : 0;
  const flipY = -1;
  const arrowEnd = {
    x: cx + boundaryR * Math.cos(rad),
    y: batsmanY + flipY * boundaryR * Math.sin(rad),
  };
  const midX = cx + innerR * Math.cos(rad);
  const midY = batsmanY + flipY * innerR * Math.sin(rad);

  return (
    <svg viewBox={`0 0 ${viewSize} ${viewSize}`} width={size} height={size} className="shrink-0">
      <g transform={`translate(0, ${viewSize * 0.08})`}>
        <circle cx={cx} cy={cy} r={boundaryR} fill="none" stroke={color + '30'} strokeWidth="1" />
        <circle cx={cx} cy={cy} r={boundaryR - 1} fill="none" stroke={color + '12'} strokeWidth="0.5" strokeDasharray="2 2" />
        <circle cx={cx} cy={cy} r={boundaryR - 10} fill="none" stroke={color + '10'} strokeWidth="0.5" strokeDasharray="1 3" />

        <rect x={cx - PITCH_W / 2} y={cy - PITCH_H / 2} width={PITCH_W} height={PITCH_H} rx="1" fill={color + '15'} stroke={color + '25'} strokeWidth="0.6" />

        <line x1={cx - 2} y1={batsmanY} x2={cx - 2} y2={batsmanY + STUMPS_H} stroke={color} strokeWidth="1.2" />
        <line x1={cx} y1={batsmanY} x2={cx} y2={batsmanY + STUMPS_H} stroke={color} strokeWidth="1.2" />
        <line x1={cx + 2} y1={batsmanY} x2={cx + 2} y2={batsmanY + STUMPS_H} stroke={color} strokeWidth="1.2" />
        <line x1={cx - 5} y1={batsmanY + STUMPS_H} x2={cx + 5} y2={batsmanY + STUMPS_H} stroke={color} strokeWidth="0.8" />

        <line x1={cx - 2} y1={cy + PITCH_H / 2 - 2 - STUMPS_H} x2={cx - 2} y2={cy + PITCH_H / 2 - 2} stroke={color + '40'} strokeWidth="1" />
        <line x1={cx} y1={cy + PITCH_H / 2 - 2 - STUMPS_H} x2={cx} y2={cy + PITCH_H / 2 - 2} stroke={color + '40'} strokeWidth="1" />
        <line x1={cx + 2} y1={cy + PITCH_H / 2 - 2 - STUMPS_H} x2={cx + 2} y2={cy + PITCH_H / 2 - 2} stroke={color + '40'} strokeWidth="1" />

        <circle cx={cx} cy={batsmanY + 3} r="3" fill={color} opacity="0.8" />
        <line x1={cx + 2} y1={batsmanY + 2} x2={cx + 5} y2={batsmanY - 2} stroke={color} strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />

        {hasDirection && (
          <>
            <line x1={cx} y1={cy} x2={arrowEnd.x} y2={arrowEnd.y} stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.7" />
            <line x1={cx} y1={cy} x2={midX} y2={midY} stroke={color} strokeWidth="2.5" strokeLinecap="round" opacity="0.4" />
            <polygon
              points={`${arrowEnd.x},${arrowEnd.y - 4.5} ${arrowEnd.x + 7},${arrowEnd.y} ${arrowEnd.x},${arrowEnd.y + 4.5}`}
              fill={color}
              opacity="0.85"
              transform={`rotate(${deg}, ${arrowEnd.x}, ${arrowEnd.y})`}
            />
            <circle cx={arrowEnd.x} cy={arrowEnd.y} r="1.5" fill={color} opacity="0.6" />
          </>
        )}

        {!hasDirection && (
          <text x={cx} y={cy + 4} textAnchor="middle" fill={color} fontSize="16" fontWeight="900" opacity="0.5">✕</text>
        )}
      </g>
    </svg>
  );
}
