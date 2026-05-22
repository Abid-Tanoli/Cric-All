import React from 'react';

const UmpireSignalPanel = ({ onSignal, disabled }) => {
  const signals = [
    { id: 'four', label: 'FOUR', icon: '━', color: 'bg-blue-600' },
    { id: 'six', label: 'SIX', icon: '〇', color: 'bg-purple-600' },
    { id: 'wide', label: 'WIDE', icon: '〰️', color: 'bg-amber-500' },
    { id: 'noball', label: 'NO BALL', icon: '—', color: 'bg-amber-600' },
    { id: 'out', label: 'OUT', icon: '✖', color: 'bg-red-600' },
    { id: 'notout', label: 'NOT OUT', icon: '✓', color: 'bg-green-600' },
    { id: 'dead', label: 'DEAD', icon: '⚫', color: 'bg-slate-600' },
    { id: 'drs', label: 'DRS', icon: '📺', color: 'bg-teal-600' },
  ];

  return (
    <div className="bg-[#0d1b2a] dark:bg-[#020617] rounded-3xl p-6 border border-slate-800/50">
      <h3 className="text-[#ff6b35] text-[10px] font-black uppercase tracking-widest mb-4">Umpire Signals</h3>
      
      <div className="grid grid-cols-4 gap-3">
        {signals.map((signal) => (
          <button
            key={signal.id}
            onClick={() => onSignal?.(signal.id)}
            disabled={disabled}
            className={`${signal.color} disabled:opacity-50 disabled:cursor-not-allowed p-4 rounded-xl flex flex-col items-center justify-center gap-1 transition-all hover:scale-105 active:scale-95 shadow-lg`}
          >
            <span className="text-2xl">{signal.icon}</span>
            <span className="text-[10px] font-black text-white uppercase">{signal.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

const DRSReviewPanel = ({ reviewsRemaining = { batting: 2, bowling: 2 }, onReview, disabled }) => {
  return (
    <div className="bg-[#0d1b2a] dark:bg-[#020617] rounded-3xl p-6 border border-slate-800/50">
      <h3 className="text-[#ff6b35] text-[10px] font-black uppercase tracking-widest mb-4">DRS Reviews</h3>
      
      <div className="space-y-4">
        <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-xl">
          <span className="text-sm text-slate-400 font-medium">Batting Team</span>
          <div className="flex gap-1">
            {[1, 2].map((i) => (
              <div 
                key={i}
                className={`w-4 h-4 rounded-full ${i <= reviewsRemaining.batting ? 'bg-green-500' : 'bg-slate-600'}`}
              />
            ))}
          </div>
        </div>
        
        <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-xl">
          <span className="text-sm text-slate-400 font-medium">Bowling Team</span>
          <div className="flex gap-1">
            {[1, 2].map((i) => (
              <div 
                key={i}
                className={`w-4 h-4 rounded-full ${i <= reviewsRemaining.bowling ? 'bg-green-500' : 'bg-slate-600'}`}
              />
            ))}
          </div>
        </div>

        <button
          onClick={onReview}
          disabled={disabled || (reviewsRemaining.batting === 0 && reviewsRemaining.bowling === 0)}
          className="w-full py-3 bg-teal-600 hover:bg-teal-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-black text-sm uppercase rounded-xl transition-all"
        >
          Request Review
        </button>
      </div>
    </div>
  );
};

const MatchRefereePanel = ({ matchStatus, onStatusChange, onAwardMOM }) => {
  const statusOptions = [
    { value: 'live', label: 'Live', color: 'bg-green-600' },
    { value: 'innings-break', label: 'Innings Break', color: 'bg-amber-600' },
    { value: 'rain_delay', label: 'Rain Delay', color: 'bg-blue-600' },
    { value: 'completed', label: 'Completed', color: 'bg-purple-600' },
  ];

  return (
    <div className="bg-[#0d1b2a] dark:bg-[#020617] rounded-3xl p-6 border border-slate-800/50">
      <h3 className="text-[#ff6b35] text-[10px] font-black uppercase tracking-widest mb-4">Match Referee</h3>
      
      <div className="space-y-4">
        <div>
          <label className="text-xs text-slate-500 font-black uppercase mb-2 block">Match Status</label>
          <div className="grid grid-cols-2 gap-2">
            {statusOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => onStatusChange?.(opt.value)}
                className={`${opt.color} ${matchStatus === opt.value ? 'ring-2 ring-white' : ''} py-2 px-3 rounded-lg text-xs font-black uppercase text-white transition-all`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={onAwardMOM}
          className="w-full py-3 bg-amber-600 hover:bg-amber-500 text-white font-black text-sm uppercase rounded-xl transition-all"
        >
          Select Player of Match
        </button>
      </div>
    </div>
  );
};

export { UmpireSignalPanel, DRSReviewPanel, MatchRefereePanel };