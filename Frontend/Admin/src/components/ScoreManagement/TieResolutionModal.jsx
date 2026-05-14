import React from 'react';

const TieResolutionModal = ({ isOpen, onResolve, matchResult }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md animate-fadeIn">
            <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-10 max-w-md w-full shadow-2xl border border-white/20 animate-scaleUp">
                <div className="text-center space-y-6">
                    <div className="w-20 h-20 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.5">
                            <path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </div>
                    
                    <h2 className="text-4xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">Match Tied!</h2>
                    <p className="text-slate-500 dark:text-slate-400 font-medium">
                        Both teams have finished their innings with equal runs. How would you like to resolve this?
                    </p>

                    <div className="grid grid-cols-1 gap-4 pt-6">
                        <button
                            onClick={() => onResolve('super_over')}
                            className="group relative bg-indigo-600 hover:bg-indigo-700 text-white p-6 rounded-3xl font-black uppercase tracking-widest transition-all hover:scale-[1.02] active:scale-[0.98] shadow-xl shadow-indigo-600/20"
                        >
                            <span className="relative z-10 flex items-center justify-center gap-3">
                                <span className="text-2xl">⚡</span> Super Over
                            </span>
                        </button>

                        <button
                            onClick={() => onResolve('declared_tie')}
                            className="bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 p-6 rounded-3xl font-black uppercase tracking-widest transition-all"
                        >
                            ✅ Declare Tie
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TieResolutionModal;
