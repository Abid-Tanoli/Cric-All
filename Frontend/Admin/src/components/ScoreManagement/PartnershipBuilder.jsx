import React, { useState } from 'react';

export default function PartnershipBuilder({ batting, ballByBall }) {
  const [selectedPartnership, setSelectedPartnership] = useState(0);
  
  const calculatePartnerships = () => {
    if (!ballByBall || ballByBall.length === 0) return [];
    
    const partnerships = [];
    let currentPartnership = { runs: 0, balls: 0, batsmen: [], wickets: 0 };
    
    ballByBall.forEach((ball, idx) => {
      if (ball.wicket) currentPartnership.wickets++;
      
      if (!ball.extras?.wides && !ball.extras?.noBall) {
        currentPartnership.runs += ball.runs || 0;
        currentPartnership.balls++;
      }
      
      if (ball.batsman1 && !currentPartnership.batsmen.includes(ball.batsman1)) {
        currentPartnership.batsmen.push(ball.batsman1);
      }
      if (ball.batsman2 && !currentPartnership.batsmen.includes(ball.batsman2)) {
        currentPartnership.batsmen.push(ball.batsman2);
      }
      
      if (currentPartnership.wickets > 0 || idx === ballByBall.length - 1) {
        if (currentPartnership.runs > 0) {
          partnerships.push({ ...currentPartnership });
        }
        currentPartnership = { runs: 0, balls: 0, batsmen: [], wickets: 0 };
      }
    });
    
    return partnerships.sort((a, b) => b.runs - a.runs);
  };
  
  const partnerships = calculatePartnerships();
  const totalRuns = partnerships.reduce((sum, p) => sum + p.runs, 0);
  
  return (
    <div className="bg-[#1e293b] rounded-xl border border-[#334155] p-6">
      <h3 className="text-[#94a3b8] text-xs font-bold uppercase tracking-widest mb-4">Partnership Builder</h3>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <div className="flex justify-between items-center mb-4">
            <span className="text-sm text-[#94a3b8]">Total Partnerships</span>
            <span className="font-rajdhani font-bold text-white text-lg">{partnerships.length}</span>
          </div>
          
          <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
            {partnerships.length === 0 ? (
              <p className="text-sm text-[#94a3b8] text-center py-4">No partnership data available</p>
            ) : (
              partnerships.map((p, idx) => (
                <button
                  key={idx}
                  onClick={() => setSelectedPartnership(idx)}
                  className={`w-full p-3 rounded-lg text-left transition ${
                    selectedPartnership === idx 
                      ? 'bg-[#22c55e]/20 border border-[#22c55e]/50' 
                      : 'bg-[#0f172a] border border-[#334155] hover:border-[#22c55e]/30'
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-bold text-white">
                      {p.batsmen.map(b => b?.name || 'Player').slice(0, 2).join(' & ')}
                    </span>
                    <span className="font-rajdhani font-bold text-lg text-white">{p.runs} runs</span>
                  </div>
                  <div className="flex justify-between items-center mt-1 text-xs text-[#94a3b8]">
                    <span>{p.balls} balls</span>
                    <span>SR: {p.balls > 0 ? ((p.runs / p.balls) * 100).toFixed(1) : 0}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
        
        <div>
          <div className="bg-[#0f172a] rounded-lg p-4 mb-4">
            <div className="text-xs text-[#94a3b8] uppercase mb-3">Partnership Distribution</div>
            <div className="space-y-2">
              {partnerships.slice(0, 5).map((p, idx) => (
                <div key={idx} className="flex items-center gap-3">
                  <span className="text-xs text-[#94a3b8] w-4">#{idx + 1}</span>
                  <div className="flex-1 h-4 bg-[#334155] rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-[#22c55e] to-[#3b82f6] rounded-full"
                      style={{ width: `${(p.runs / (partnerships[0]?.runs || 1)) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs font-bold text-white w-12 text-right">{p.runs}</span>
                </div>
              ))}
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[#0f172a] p-3 rounded">
              <div className="text-xs text-[#94a3b8] uppercase">Biggest</div>
              <div className="font-rajdhani font-bold text-[#22c55e] text-lg">
                {partnerships[0]?.runs || 0} runs
              </div>
            </div>
            <div className="bg-[#0f172a] p-3 rounded">
              <div className="text-xs text-[#94a3b8] uppercase">Total Runs</div>
              <div className="font-rajdhani font-bold text-white text-lg">{totalRuns}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}