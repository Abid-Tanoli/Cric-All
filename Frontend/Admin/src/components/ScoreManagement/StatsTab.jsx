import React from 'react';

export default function StatsTab() {
    return (
        <div className="space-y-12 animate-fadeIn">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="bg-black/20 rounded-[2.5rem] p-8 border border-white/5">
                    <h4 className="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-6 text-center">Run Rate Comparison</h4>
                    <div className="h-64 flex items-end justify-between gap-2 px-4">
                        {[20, 35, 45, 30, 55, 70, 65, 80, 95, 100].map((h, i) => (
                            <div key={i} className="flex-1 bg-[#ff6b35]/20 rounded-t-lg relative group transition-all hover:bg-[#ff6b35]/40" style={{ height: `${h}%` }}>
                                <div className="absolute inset-x-0 bottom-0 bg-[#ff6b35] rounded-t-lg transition-all h-2 group-hover:h-full opacity-50"></div>
                            </div>
                        ))}
                    </div>
                    <div className="flex justify-between mt-4 text-[9px] font-bold text-slate-600 px-2 uppercase">
                        <span>Start</span>
                        <span>Mid</span>
                        <span>Death</span>
                    </div>
                </div>

                <div className="bg-black/20 rounded-[2.5rem] p-8 border border-white/5">
                    <h4 className="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-6 text-center">Partnership Growth</h4>
                    <div className="h-64 flex items-end justify-between gap-1">
                        {Array.from({ length: 15 }).map((_, i) => (
                            <div key={i} className="flex-1 bg-blue-500/20 rounded-t-lg" style={{ height: `${((i + 1) * 6.5 + 5) % 100}%` }}></div>
                        ))}
                    </div>
                    <div className="text-center mt-4 text-[9px] font-bold text-slate-600 uppercase tracking-widest">Last 15 Overs</div>
                </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                {[
                    { label: 'Dots %', val: '34.2%', color: 'text-slate-400' },
                    { label: 'Boundaries', val: '12', color: 'text-[#ff6b35]' },
                    { label: 'Singles', val: '45', color: 'text-blue-400' },
                    { label: 'Projected', val: '342', color: 'text-green-500' }
                ].map((s, i) => (
                    <div key={i} className="bg-black/20 rounded-3xl p-6 border border-white/5 text-center">
                        <div className={`text-2xl font-black ${s.color}`}>{s.val}</div>
                        <div className="text-[9px] font-black text-slate-600 uppercase tracking-widest mt-2">{s.label}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}
