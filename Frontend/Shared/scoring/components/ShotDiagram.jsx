import React from 'react';
import { SHOT_CATEGORIES, renderShotSvg } from '../data/shotsData';

export default React.memo(function ShotDiagram({ shot, size = 80 }) {
  if (!shot) return null;
  const cat = SHOT_CATEGORIES[shot.category];
  const color = cat?.color || '#6b7280';
  const svg = renderShotSvg(shot.angle, shot.zone, color, shot.name, size * 0.65);
  const hasDirection = shot.angle != null;

  return (
    <svg viewBox="0 0 120 140" width={size} height={size * 1.18} className="shrink-0">
      <defs>
        <radialGradient id={`fieldGrad-${shot.id}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#2d8a46" />
          <stop offset="100%" stopColor="#1a6b32" />
        </radialGradient>
      </defs>

      <circle cx="60" cy="90" r="80" fill={`url(#fieldGrad-${shot.id})`} />

      <circle cx="60" cy="90" r="76" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="0.8" />
      <circle cx="60" cy="90" r="45" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="0.8" strokeDasharray="2 3" />

      <rect x="42" y="105" width="36" height="28" rx="2" fill="#d4a853" />
      <rect x="42" y="105" width="36" height="28" rx="2" fill="rgba(0,0,0,0.1)" />

      <line x1="55" y1="108" x2="55" y2="128" stroke="rgba(0,0,0,0.2)" strokeWidth="1" />
      <line x1="60" y1="108" x2="60" y2="128" stroke="rgba(0,0,0,0.2)" strokeWidth="1" />
      <line x1="65" y1="108" x2="65" y2="128" stroke="rgba(0,0,0,0.2)" strokeWidth="1" />

      <circle cx="60" cy="100" r="4" fill="#fff" stroke="rgba(0,0,0,0.3)" strokeWidth="0.8" />
      <rect x="58" y="96" width="4" height="14" rx="1" fill="#c9a46a" transform="rotate(-15, 60, 100)" />

      {hasDirection && (
        <>
          <line x1="60" y1="100" x2={svg.endX} y2={svg.endY}
            stroke={color} strokeWidth="3" strokeLinecap="round" opacity="0.9" />
          <polygon points={svg.wedgePoints} fill={color} opacity="0.25" />
          <circle cx={svg.endX} cy={svg.endY} r="6" fill={color} opacity="0.8" />
        </>
      )}

      {!hasDirection && (
        <text x="60" y="65" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="20" fontWeight="900">
          ✕
        </text>
      )}
    </svg>
  );
});
