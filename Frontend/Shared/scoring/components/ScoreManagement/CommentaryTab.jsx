import React from 'react';
import BallByBallFeed from '../BallByBallFeed';

export default React.memo(function CommentaryTab({
    formattedHistory,
    oversHistory,
    handleEditBall,
    setActiveTab
}) {
    return (
        <div className="space-y-6 animate-fadeIn">
            <div className="flex items-center justify-between mb-2">
                <h3 className="text-xl font-black font-raj italic uppercase text-cric-accent tracking-tight">Ball by Ball Commentary</h3>
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                    <span className="text-[9px] font-black uppercase text-slate-500 tracking-widest">Live</span>
                </div>
            </div>
            <BallByBallFeed
                history={formattedHistory}
                overs={oversHistory}
                onEdit={handleEditBall}
                onSwitchTab={setActiveTab}
                compact={false}
            />
        </div>
    );
});
