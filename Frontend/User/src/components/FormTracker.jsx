const FormTracker = ({ recentMatches, playerId }) => {
  if (!recentMatches || recentMatches.length === 0) {
    return (
      <div className="text-center py-8 text-cric-muted text-sm font-bold">
        No recent match data available for form tracker
      </div>
    );
  }

  const lastInnings = recentMatches
    .slice(0, 10)
    .map((m) => {
      const myBat = Array.isArray(m.batting)
        ? m.batting.find(
            (b) => b.player?._id === playerId || b.player === playerId
          )
        : m.batting;
      const myBowl = Array.isArray(m.bowling)
        ? m.bowling.find(
            (b) => b.player?._id === playerId || b.player === playerId
          )
        : m.bowling;
      const opposition =
        m.opposition ||
        m.teams?.find((t) => (t._id || t) !== (m.teamId || m.playerTeam?._id || m.teams?.[0]?._id));
      return {
        matchId: m._id,
        runs: myBat?.runs || 0,
        balls: myBat?.ballsFaced ?? myBat?.balls ?? 0,
        wickets: myBowl?.wickets || 0,
        economy: myBowl?.balls
          ? ((myBowl.runs || 0) / (myBowl.balls / 6)).toFixed(1)
          : null,
        opposition: opposition?.shortName || opposition?.name || "?",
        result: m.resultForPlayer || m.result,
        playerTeam: m.teamId || m.playerTeam?._id || m.teams?.[0]?._id,
      };
    })
    .reverse();

  if (lastInnings.length === 0) {
    return (
      <div className="text-center py-8 text-cric-muted text-sm font-bold">
        No recent match data available for form tracker
      </div>
    );
  }

  const maxRuns = Math.max(...lastInnings.map((i) => i.runs), 1);
  const chartHeight = 120;
  const barWidth = Math.min(
    Math.floor((600 - lastInnings.length * 8) / lastInnings.length),
    40
  );
  const chartWidth = lastInnings.length * (barWidth + 8);

  return (
    <div className="bg-cric-card rounded-xl shadow-sm border border-cric-border overflow-hidden">
      <div className="bg-cric-accent px-6 py-4">
        <h3 className="text-lg font-black text-white uppercase tracking-tight">
          Form Tracker
        </h3>
        <p className="text-xs text-white/60 font-bold">
          Last {lastInnings.length} innings
        </p>
      </div>
      <div className="p-6">
        <div className="overflow-x-auto">
          <svg
            width={Math.max(chartWidth, 300)}
            height={chartHeight + 80}
            viewBox={`0 0 ${Math.max(chartWidth, 300)} ${chartHeight + 80}`}
            className="mx-auto"
          >
            {/* Y-axis labels */}
            <text x="-8" y={chartHeight + 4} textAnchor="end" fontSize="10" fill="#94a3b8" fontWeight="bold">
              0
            </text>
            <text x="-8" y={chartHeight * 0.25 + 4} textAnchor="end" fontSize="10" fill="#94a3b8" fontWeight="bold">
              {Math.round(maxRuns * 0.75)}
            </text>
            <text x="-8" y={chartHeight * 0.5 + 4} textAnchor="end" fontSize="10" fill="#94a3b8" fontWeight="bold">
              {Math.round(maxRuns * 0.5)}
            </text>
            <text x="-8" y={chartHeight * 0.75 + 4} textAnchor="end" fontSize="10" fill="#94a3b8" fontWeight="bold">
              {Math.round(maxRuns * 0.25)}
            </text>

            {/* Grid lines */}
            {[0.25, 0.5, 0.75].map((ratio) => (
              <line
                key={ratio}
                x1="0"
                y1={chartHeight * ratio}
                x2={chartWidth}
                y2={chartHeight * ratio}
                stroke="#e2e8f0"
                strokeDasharray="4 4"
              />
            ))}

            {/* Bars */}
            {lastInnings.map((inn, idx) => {
              const barH = maxRuns > 0 ? (inn.runs / maxRuns) * chartHeight : 0;
              const x = idx * (barWidth + 8);
              const y = chartHeight - barH;
              const color =
                inn.runs >= 50
                  ? "#22c55e"
                  : inn.runs >= 30
                  ? "#eab308"
                  : inn.runs >= 15
                  ? "#f97316"
                  : "#ef4444";

              return (
                <g key={idx}>
                  <rect
                    x={x}
                    y={y}
                    width={barWidth}
                    height={Math.max(barH, 2)}
                    rx="4"
                    fill={color}
                    opacity="0.85"
                  >
                    <title>{inn.opposition}: {inn.runs} runs ({inn.balls} balls){inn.wickets > 0 ? `, ${inn.wickets} wkts` : ""}</title>
                  </rect>
                  <text
                    x={x + barWidth / 2}
                    y={y - 6}
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="bold"
                    fill="#1e293b"
                  >
                    {inn.runs}
                  </text>
                  {inn.wickets > 0 && (
                    <text
                      x={x + barWidth / 2}
                      y={chartHeight + 14}
                      textAnchor="middle"
                      fontSize="9"
                      fill="#8b5cf6"
                      fontWeight="bold"
                    >
                      {inn.wickets}w
                    </text>
                  )}
                  <text
                    x={x + barWidth / 2}
                    y={chartHeight + 30}
                    textAnchor="middle"
                    fontSize="8"
                    fill="#94a3b8"
                    fontWeight="bold"
                    style={{ textTransform: "uppercase" }}
                  >
                    {inn.opposition?.slice(0, 4) || "?"}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-6 mt-4 text-[10px] font-bold text-cric-muted">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm bg-green-500" />
            50+
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm bg-yellow-500" />
            30-49
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm bg-orange-500" />
            15-29
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm bg-red-500" />
            0-14
          </div>
        </div>
      </div>
    </div>
  );
};

export default FormTracker;
