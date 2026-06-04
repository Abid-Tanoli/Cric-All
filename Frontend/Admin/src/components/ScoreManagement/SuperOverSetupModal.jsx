import React, { useState, useMemo } from 'react';
import { useToast } from '../Toast';

const SuperOverSetupModal = ({ isOpen, onStart, selectedMatch, battingTeam, bowlingTeam, battingXI, bowlingXI }) => {
    const [selectedBatsmen, setSelectedBatsmen] = useState([]);
    const [selectedBowler, setSelectedBowler] = useState('');
    const { showToast } = useToast();

    const superOverNumber = useMemo(() => {
        const totalInnings = selectedMatch?.innings?.length || 0;
        return Math.floor((totalInnings - 2) / 2) + 1;
    }, [selectedMatch]);

    const prevBowlers = useMemo(() => {
        if (!selectedMatch?.superOvers) return [];
        return selectedMatch.superOvers
            .map(so => so.bowlers.find(b => String(b.team) === String(bowlingTeam?._id))?.bowler)
            .filter(Boolean)
            .map(id => String(id));
    }, [selectedMatch, bowlingTeam]);

    if (!isOpen) return null;

    const toggleBatsman = (id) => {
        if (selectedBatsmen.includes(id)) {
            setSelectedBatsmen(prev => prev.filter(bid => bid !== id));
        } else if (selectedBatsmen.length < 3) {
            setSelectedBatsmen(prev => [...prev, id]);
        }
    };

    const handleStart = () => {
        if (selectedBatsmen.length < 2) {
            showToast("Select at least 2 batsmen (max 3)", "warning");
            return;
        }
        if (!selectedBowler) {
            showToast("Select a bowler", "warning");
            return;
        }
        onStart({ batsmenIds: selectedBatsmen, bowlerId: selectedBowler });
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/90 backdrop-blur-xl animate-fadeIn overflow-y-auto">
            <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-10 max-w-4xl w-full shadow-2xl border border-white/10 my-8">
                <div className="flex justify-between items-start mb-8">
                    <div>
                        <h2 className="text-4xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">Super Over {superOverNumber} Setup</h2>
                        <p className="text-slate-500 dark:text-slate-400 font-bold mt-2 uppercase tracking-widest text-xs">
                            {battingTeam?.name} vs {bowlingTeam?.name}
                        </p>
                    </div>
                    <div className="bg-amber-500 text-white px-4 py-2 rounded-full font-black text-xs uppercase tracking-widest">
                        {battingTeam?.shortName} Batting First
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                    {/* Batsmen Selection */}
                    <div className="space-y-6">
                        <div className="flex justify-between items-end">
                            <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">Select 3 Batsmen ({battingTeam?.shortName})</h3>
                            <span className="text-xs font-bold text-indigo-500">{selectedBatsmen.length}/3 Selected</span>
                        </div>
                        <div className="grid grid-cols-1 gap-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                            {battingXI.map(player => (
                                <button
                                    key={player._id}
                                    onClick={() => toggleBatsman(player._id)}
                                    className={`flex items-center justify-between p-4 rounded-2xl border-2 transition-all ${
                                        selectedBatsmen.includes(player._id)
                                            ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-600/20'
                                            : 'bg-slate-50 dark:bg-slate-800 border-transparent text-slate-700 dark:text-slate-300 hover:border-slate-300'
                                    }`}
                                >
                                    <span className="font-bold">{player.name}</span>
                                    {selectedBatsmen.includes(player._id) && (
                                        <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-[10px]">
                                            {selectedBatsmen.indexOf(player._id) + 1}
                                        </div>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Bowler Selection */}
                    <div className="space-y-6">
                        <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">Select 1 Bowler ({bowlingTeam?.shortName})</h3>
                        <div className="grid grid-cols-1 gap-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                            {bowlingXI.map(player => {
                                const isDisabled = prevBowlers.includes(String(player._id));
                                return (
                                    <button
                                        key={player._id}
                                        disabled={isDisabled}
                                        onClick={() => setSelectedBowler(player._id)}
                                        className={`flex items-center justify-between p-4 rounded-2xl border-2 transition-all ${
                                            selectedBowler === player._id
                                                ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-600/20'
                                                : isDisabled
                                                ? 'bg-slate-100 dark:bg-slate-800 border-transparent text-slate-400 dark:text-slate-600 cursor-not-allowed'
                                                : 'bg-slate-50 dark:bg-slate-800 border-transparent text-slate-700 dark:text-slate-300 hover:border-slate-300'
                                        }`}
                                    >
                                        <div className="flex flex-col items-start">
                                            <span className="font-bold">{player.name}</span>
                                            {isDisabled && <span className="text-[10px] uppercase font-black text-red-500/60 mt-0.5">Cannot bowl consecutive SO</span>}
                                        </div>
                                        {selectedBowler === player._id && (
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                                <path d="M20 6L9 17l-5-5" />
                                            </svg>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <div className="flex gap-4 mt-12 pt-8 border-t border-slate-100 dark:border-slate-800">
                    <button
                        onClick={handleStart}
                        className="flex-1 bg-cric-blue hover:bg-cric-blue/90 text-white p-6 rounded-3xl font-black uppercase tracking-widest transition-all shadow-xl shadow-blue-600/20 flex items-center justify-center gap-3"
                    >
                        ⚡ Start Super Over
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SuperOverSetupModal;
