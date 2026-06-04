import React from 'react';

export default function WagonWheel({ battingData, innings }) {
  const ballData = innings?.ballByBall || [];
  
  const zones = {
    'Mid Wicket': 0,
    'Point': 45,
    'Cover': 90,
    'Extra Cover': 135,
    'Mid Off': 180,
    'Mid On': 225,
    'Fine Leg': 270,
    'Square Leg': 315
  };

  const getZone = (shotType, direction) => {
    if (shotType === 'cover drive') return 90;
    if (shotType === 'straight') return 180;
    if (shotType === 'leg glance' || shotType === 'on drive') return 225;
    if (shotType === 'cut' || shotType === 'pull') return 45;
    if (shotType === 'late cut') return 0;
    const hash = (shotType || '').length * 37 + (direction || '').length * 13;
    return hash % 360;
  };

  const balls = ballData.map((ball, idx) => {
    const runs = ball.runs || 0;
    const isBoundary = runs === 4 || runs === 6;
    const angle = getZone(ball.shotType, ball.direction);
    return { ...ball, angle, isBoundary, runs };
  });

  const totalBalls = balls.length || 1;
  const boundaries = balls.filter(b => b.isBoundary).length;
  const dotBalls = balls.filter(b => b.runs === 0 && !b.isWide && !b.isNoBall).length;

  return (
    <div className="bg-[#1e293b] rounded-xl border border-[#334155] p-6">
      <h3 className="text-[#94a3b8] text-xs font-bold uppercase tracking-widest mb-4">Wagon Wheel</h3>
      
      <div className="flex flex-col lg:flex-row items-center gap-8">
        <div className="relative w-64 h-64">
          <svg viewBox="0 0 200 200" className="w-full h-full">
            <circle cx="100" cy="100" r="95" fill="none" stroke="#334155" strokeWidth="1" />
            <circle cx="100" cy="100" r="60" fill="none" stroke="#334155" strokeWidth="1" />
            <circle cx="100" cy="100" r="30" fill="#1e293b" stroke="#334155" strokeWidth="1" />
            
            {[0, 45, 90, 135, 180, 225, 270, 315].map((angle, i) => {
              const rad = (angle - 90) * (Math.PI / 180);
              const x1 = 100 + 30 * Math.cos(rad);
              const y1 = 100 + 30 * Math.sin(rad);
              const x2 = 100 + 95 * Math.cos(rad);
              const y2 = 100 + 95 * Math.sin(rad);
              return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#334155" strokeWidth="1" />;
            })}
            
            {balls.map((ball, i) => {
              const rad = (ball.angle - 90) * (Math.PI / 180);
              const dist = ball.isBoundary ? 85 : 50 + (ball.angle % 20);
              const x = 100 + dist * Math.cos(rad);
              const y = 100 + dist * Math.sin(rad);
              return (
                <circle
                  key={i}
                  cx={x}
                  cy={y}
                  r={ball.isBoundary ? 4 : 2}
                  fill={ball.runs === 6 ? '#f59e0b' : ball.runs === 4 ? '#3b82f6' : '#94a3b8'}
                  opacity={0.8}
                />
              );
            })}
            
            <text x="100" y="105" textAnchor="middle" fill="#fff" fontSize="8" fontWeight="bold">Batsman</text>
          </svg>
        </div>
        
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-[#0f172a] p-3 rounded">
              <div className="text-xs text-[#94a3b8] uppercase">Total Balls</div>
              <div className="text-xl font-rajdhani font-bold text-white">{totalBalls}</div>
            </div>
            <div className="bg-[#0f172a] p-3 rounded">
              <div className="text-xs text-[#94a3b8] uppercase">Boundaries</div>
              <div className="text-xl font-rajdhani font-bold text-[#3b82f6]">{boundaries}</div>
            </div>
            <div className="bg-[#0f172a] p-3 rounded">
              <div className="text-xs text-[#94a3b8] uppercase">Dot Balls</div>
              <div className="text-xl font-rajdhani font-bold text-white">{dotBalls}</div>
            </div>
            <div className="bg-[#0f172a] p-3 rounded">
              <div className="text-xs text-[#94a3b8] uppercase">Boundary %</div>
              <div className="text-xl font-rajdhani font-bold text-[#22c55e]">
                {((boundaries / totalBalls) * 100).toFixed(1)}%
              </div>
            </div>
          </div>
          
          <div className="flex gap-2 text-xs">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#f59e0b]"></span> 6s</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#3b82f6]"></span> 4s</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#94a3b8]"></span> Other</span>
          </div>
        </div>
      </div>
    </div>
  );
}