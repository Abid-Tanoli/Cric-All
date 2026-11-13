import React from 'react';
import LiveScoringPanel from './LiveScoringPanel';
import BallByBallFeed from '../BallByBallFeed';
import { formatOvers } from './constants';

export default React.memo(function LiveTab({
    battingXI,
    bowlingXI,
    strikerId,
    nonStrikerId,
    bowlerId,
    strikerStats,
    nonStrikerStats,
    activeBowlerStats,
    winProb,
    selectedMatch,
    formattedHistory,
    curInn,
    onRetire,
    handleEditBall,
    setActiveTab
}) {
    return (
        <div className="space-y-12 animate-fadeIn">
            <LiveScoringPanel
                battingXI={battingXI}
                bowlingXI={bowlingXI}
                strikerId={strikerId}
                nonStrikerId={nonStrikerId}
                bowlerId={bowlerId}
                strikerStats={strikerStats}
                nonStrikerStats={nonStrikerStats}
                activeBowlerStats={activeBowlerStats}
                winProb={winProb}
                selectedMatch={selectedMatch}
                formattedHistory={formattedHistory}
                formatOvers={formatOvers}
                onRetire={onRetire}
            />

            <div className="pt-8 border-t border-cric-border">
                <div className="flex items-center justify-between mb-6">
                    <h3 className="text-xl font-black font-raj italic uppercase text-cric-accent tracking-tight">Recent Live Commentary</h3>
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                        <span className="text-[9px] font-black uppercase text-slate-500 tracking-widest">Live Feed</span>
                    </div>
                </div>
                <BallByBallFeed
                    history={formattedHistory}
                    overs={curInn?.oversHistory || []}
                    onEdit={handleEditBall}
                    onSwitchTab={setActiveTab}
                    compact={true}
                />
            </div>
        </div>
    );
});
