import React from 'react';

const WinProbabilityChart = ({ winProbHistory = [], currentBattingProb = 50, currentBowlingProb = 50, battingTeamName = "Batting", bowlingTeamName = "Bowling" }) => {
  const chartData = winProbHistory.map((entry, idx) => ({
    over: entry.over || idx + 1,
    batting: entry.battingTeamProb,
    bowling: entry.bowlingTeamProb
  }));

  const latestEntry = chartData[chartData.length - 1];
  const currentOver = latestEntry?.over || 0;

  return (
    <div className="bg-[#0d1b2a] dark:bg-[#020617] rounded-3xl p-6 border border-slate-800/50">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-[#ff6b35] text-[10px] font-black uppercase tracking-widest">Win Probability</h3>
        <span className="text-xs text-slate-500">Over {currentOver}</span>
      </div>

      <div className="space-y-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-16 text-xs text-slate-400 font-medium">{battingTeamName}</div>
          <div className="flex-1 h-6 bg-slate-800 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-green-500 to-green-400 transition-all duration-500"
              style={{ width: `${currentBattingProb}%` }}
            />
          </div>
          <div className="w-10 text-right text-sm font-black text-green-400">{currentBattingProb}%</div>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-16 text-xs text-slate-400 font-medium">{bowlingTeamName}</div>
          <div className="flex-1 h-6 bg-slate-800 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-red-500 to-red-400 transition-all duration-500"
              style={{ width: `${currentBowlingProb}%` }}
            />
          </div>
          <div className="w-10 text-right text-sm font-black text-red-400">{currentBowlingProb}%</div>
        </div>
      </div>

      {chartData.length > 1 && (
        <div className="h-24 relative mt-4">
          <div className="absolute inset-0 flex items-end justify-between gap-1 px-2">
            {chartData.slice(-10).map((entry, idx) => (
              <div key={idx} className="flex-1 flex flex-col items-center gap-1">
                <div 
                  className="w-full bg-slate-700 rounded-t transition-all hover:bg-slate-600"
                  style={{ height: `${entry.batting}%` }}
                />
                <span className="text-[8px] text-slate-500">{entry.over}</span>
              </div>
            ))}
          </div>
          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-600 border-l border-dashed" />
        </div>
      )}
    </div>
  );
};

export default WinProbabilityChart;