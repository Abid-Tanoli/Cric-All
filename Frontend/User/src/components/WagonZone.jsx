import { useMemo, useState } from 'react';
import { api } from '../services/api';

const ZONES = [
  { id: 'third-man', label: 'Third Man', angle: 60, color: '#6366f1' },
  { id: 'point', label: 'Point', angle: 45, color: '#8b5cf6' },
  { id: 'cover', label: 'Cover', angle: 30, color: '#a855f7' },
  { id: 'long-off', label: 'Long Off', angle: 15, color: '#d946ef' },
  { id: 'straight', label: 'Straight', angle: 0, color: '#ec4899' },
  { id: 'long-on', label: 'Long On', angle: -15, color: '#f43f5e' },
  { id: 'mid-wicket', label: 'Mid Wkt', angle: -25, color: '#ef4444' },
  { id: 'square-leg', label: 'Sq Leg', angle: -35, color: '#f97316' },
  { id: 'fine-leg', label: 'Fine Leg', angle: -50, color: '#eab308' },
];

export default function WagonZone({ matchId, match, innings = 0 }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all');

  useMemo(() => {
    if (!matchId) return;
    setLoading(true);
    api.get(`/matches/${matchId}/wagon-wheel/${innings + 1}`)
      .then(res => setData(res.data))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [matchId, innings]);

  const zoneStats = useMemo(() => {
    if (!data || !Array.isArray(data)) return ZONES.map(z => ({ ...z, runs: 0, balls: 0, boundaries: 0 }));
    
    const stats = {};
    ZONES.forEach(z => { stats[z.id] = { runs: 0, balls: 0, boundaries: 0 }; });

    data.forEach(shot => {
      const dir = shot.direction ?? 0;
      const runs = shot.runs ?? 0;
      const zone = ZONES.reduce((closest, z) => {
        const dist = Math.abs(dir - z.angle);
        return dist < (closest?.dist ?? Infinity) ? { zone: z, dist } : closest;
      }, null)?.zone;

      if (zone) {
        const s = stats[zone.id];
        if (filter === 'boundaries' && runs < 4) return;
        s.runs += runs;
        s.balls += 1;
        if (runs >= 4) s.boundaries += 1;
      }
    });

    return ZONES.map(z => ({ ...z, ...stats[z.id] }));
  }, [data, filter]);

  if (loading) return <div className="text-center text-gray-400 text-sm py-8">Loading zone data...</div>;

  const maxRuns = Math.max(...zoneStats.map(z => z.runs), 1);

  return (
    <div className="bg-gray-900 rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white">Shot Zones</h3>
        <select
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="bg-gray-800 text-gray-300 text-xs rounded px-2 py-1 border border-gray-700"
        >
          <option value="all">All Runs</option>
          <option value="boundaries">Boundaries Only</option>
        </select>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {zoneStats.map(zone => {
          const pct = maxRuns > 0 ? (zone.runs / maxRuns) * 100 : 0;
          const intensity = pct / 100;
          return (
            <div
              key={zone.id}
              className="rounded-lg p-2.5 text-center transition-all hover:scale-105 cursor-default"
              style={{
                backgroundColor: `rgba(${parseInt(zone.color.slice(1,3), 16)}, ${parseInt(zone.color.slice(3,5), 16)}, ${parseInt(zone.color.slice(5,7), 16)}, ${0.15 + intensity * 0.6})`,
                borderLeft: `3px solid ${zone.color}`,
              }}
            >
              <div className="text-[10px] text-gray-400 uppercase tracking-wide">{zone.label}</div>
              <div className="text-lg font-bold text-white">{zone.runs}</div>
              <div className="flex justify-center gap-2 text-[9px] text-gray-400">
                <span>{zone.balls} balls</span>
                <span>{zone.boundaries} 4s</span>
              </div>
              {zone.balls > 0 && (
                <div className="text-[10px] text-gray-300 mt-0.5">
                  SR: {((zone.runs / zone.balls) * 100).toFixed(1)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
