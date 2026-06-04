import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import useMatchScoring from '../hooks/useMatchScoring';
import MatchSetupWizard from '../components/ScoreManagement/MatchSetupWizard';
import RightSidebarControls from '../components/ScoreManagement/RightSidebarControls';
import TieResolutionModal from '../components/ScoreManagement/TieResolutionModal';
import SuperOverSetupModal from '../components/ScoreManagement/SuperOverSetupModal';
import MatchSettings from '../components/MatchSettings';
import ConfirmModal from '../components/ConfirmModal';
import LiveTab from '../components/ScoreManagement/LiveTab';
import ScorecardTab from '../components/ScoreManagement/ScorecardTab';
import CommentaryTab from '../components/ScoreManagement/CommentaryTab';
import StatsTab from '../components/ScoreManagement/StatsTab';
import { TABS, getScoreTabPath, formatOvers, FIELD_POSITIONS, WICKET_TYPES } from '../components/ScoreManagement/constants';

export default function ManageScore() {
    const navigate = useNavigate();
    const {
        matches,
        selectedMatch,
        loading,
        showSettings,
        setShowSettings,
        activeTab,
        setActiveTab,
        selectedRuns,
        setSelectedRuns,
        selectedExtra,
        setSelectedExtra,
        selectedWicket,
        setSelectedWicket,
        manualCommentary,
        setManualCommentary,
        fieldPos,
        setFieldPos,
        isWicketDropdownOpen,
        setIsWicketDropdownOpen,
        loadingCommentary,
        setLoadingCommentary,
        toast,
        confirmModal,
        setConfirmModal,
        isDRSModalOpen,
        setIsDRSModalOpen,
        drsData,
        setDrsData,
        showSelectionModal,
        setShowSelectionModal,
        useAICommentary,
        setUseAICommentary,
        activeGroundZone,
        setActiveGroundZone,
        pitchMapLine,
        setPitchMapLine,
        pitchMapLength,
        setPitchMapLength,
        pitchMapShot,
        setPitchMapShot,
        pitchMapClickPos,
        setPitchMapClickPos,
        pitchMapViewMode,
        setPitchMapViewMode,
        ballMovement,
        setBallMovement,
        ballOutcome,
        setBallOutcome,
        setupState,
        setSetupState,
        wizardStep,
        setWizardStep,
        isPreMatchComplete,
        setIsPreMatchComplete,
        curInn,
        firstInn,
        battingTeamId,
        target,
        isInnings2,
        winProb,
        battingTeamTeam,
        bowlingTeamTeam,
        battingXI,
        bowlingXI,
        battingPlayingXI,
        bowlingPlayingXI,
        strikerId,
        nonStrikerId,
        bowlerId,
        strikerStats,
        nonStrikerStats,
        activeBowlerStats,
        currentPartnership,
        formattedHistory,
        pitchMapBalls,
        fetchMatches,
        handleSelectMatch,
        submitBall,
        handleEndInnings,
        handleStartNext,
        handleRevert,
        handleRetire,
        handleGroundClick,
        handleEditBall,
        handleResetInnings,
        handleResetMatch,
        setRole,
        handleSavePlayingXI,
        handleSaveToss,
        handleSaveOpeners,
        handleTimeout,
        handleDRSReview,
        handleResolveTie,
        handleStartSuperOver,
        handleDeleteMatch,
        getPlayingXI,
        getSquad,
        getSquadMeta,
        showToast,
        reloadMatch
    } = useMatchScoring();

    if (loading && !selectedMatch) return <div className="p-10 text-center text-xl font-bold bg-[#f1f5f9] min-h-screen">Loading matches...</div>;

    if (!selectedMatch) {
        return (
            <div className="p-8 max-w-[1200px] mx-auto min-h-screen bg-cric-bg transition-colors duration-300">
                <h1 className="text-3xl font-black text-cric-text mb-8 uppercase tracking-tight">Select Match to Score</h1>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {matches.map(m => (
                        <div key={m._id} onClick={() => navigate(`/admin/score/${m._id}`)} className="bg-cric-card p-8 rounded-3xl shadow-sm border border-cric-border hover:border-cric-accent cursor-pointer transition-all relative group overflow-hidden">
                            <div className="absolute top-0 left-0 w-2 h-full bg-cric-blue"></div>
                            <button
                                onClick={(e) => handleDeleteMatch(m._id, e)}
                                className="absolute top-4 right-4 w-10 h-10 rounded-full bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
                                title="Delete match"
                            >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12" /></svg>
                            </button>
                            <div className="text-[10px] font-black text-cric-muted uppercase tracking-widest mb-2">{m.format} • {m.venue}</div>
                            <h2 className="text-xl font-black text-cric-text leading-tight mb-4 uppercase">{m.teams[0]?.name} <br /><span className="text-cric-blue">VS</span><br /> {m.teams[1]?.name}</h2>
                            <div className="flex items-center justify-between mt-4">
                                <span className={`text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest ${m.status === 'live' ? 'bg-red-500/20 text-red-500' : 'bg-cric-muted/20 text-cric-muted'}`}>{m.status}</span>
                                <div className="text-cric-blue group-hover:translate-x-1 transition-transform">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (!isPreMatchComplete) {
        return (
            <MatchSetupWizard
                wizardStep={wizardStep}
                selectedMatch={selectedMatch}
                setSelectedMatch={setSelectedMatch}
                setupState={setupState}
                setSetupState={setSetupState}
                handleSavePlayingXI={handleSavePlayingXI}
                handleSaveToss={handleSaveToss}
                handleSaveOpeners={handleSaveOpeners}
                battingXI={battingXI}
                bowlingXI={bowlingXI}
            />
        );
    }

    return (
        <div className="flex flex-col lg:flex-row min-h-screen bg-cric-bg text-cric-text p-4 lg:p-8 gap-8 transition-colors duration-300">
            {/* MAIN CONTENT (Left) */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* Header / Match Info */}
                <div className="bg-cric-card rounded-[2.5rem] p-8 border border-cric-border shadow-xl mb-6">
                    <div className="flex justify-between items-center mb-6">
                        <div className="flex items-center gap-4">
                            <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                            <span className="text-[10px] font-black tracking-[0.3em] uppercase text-slate-400">Live Match Tracking</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="text-[10px] font-black tracking-[0.3em] uppercase text-[#ff6b35]">Match ID: {selectedMatch._id.slice(-6)}</div>
                            <button
                                onClick={() => setShowSettings(true)}
                                className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 transition-all text-slate-600 hover:text-slate-900"
                                title="Match Settings"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                            </button>
                        </div>
                    </div>

                    <div className="flex justify-between items-end">
                        <div className="space-y-2">
                            <h1 className="text-5xl font-black font-raj italic tracking-tighter uppercase leading-none">
                                {battingTeamTeam?.name} <span className="text-[#ff6b35]">VS</span> {bowlingTeamTeam?.name}
                            </h1>
                            <div className="text-slate-400 font-medium">{selectedMatch.venue} • {selectedMatch.format}</div>
                            {isInnings2 && firstInn && (
                                <div className="mt-2 flex items-center gap-4">
                                    <div className="bg-slate-100 dark:bg-slate-800 rounded-lg px-3 py-1.5">
                                        <span className="text-xs font-bold text-slate-500">1st Innings:</span>
                                        <span className="text-sm font-black text-[#031d44] dark:text-white ml-2">
                                            {selectedMatch.teams?.find(t => String(t._id) === String(firstInn.team?._id || firstInn.team))?.shortName || 'Team 1'} {firstInn.runs}/{firstInn.wickets} ({formatOvers(firstInn.balls)})
                                        </span>
                                    </div>
                                    <div className="bg-[#ff6b35]/10 rounded-lg px-3 py-1.5">
                                        <span className="text-xs font-bold text-[#ff6b35]">Target:</span>
                                        <span className="text-sm font-black text-[#ff6b35] ml-2">{target}</span>
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="text-right">
                            <div className="text-6xl font-black font-raj italic text-black leading-none">
                                {curInn?.runs}/{curInn?.wickets}
                            </div>
                            <div className="text-xl font-bold text-slate-500 mt-2">OVERS {formatOvers(curInn?.balls)}</div>
                            {isInnings2 && target > 0 && (
                                <div className="text-sm font-bold text-[#ff6b35] mt-1">
                                    Need {target - (curInn?.runs || 0)} runs from {selectedMatch.totalOvers * 6 - (curInn?.balls || 0)} balls
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Tab Navigation */}
                <div className="flex bg-cric-card rounded-full p-1 border border-cric-border mb-6 overflow-x-auto no-scrollbar">
                    {TABS.map(tab => (
                        <NavLink
                            key={tab.id}
                            to={getScoreTabPath(selectedMatch._id, tab.id)}
                            end={tab.id === 'live'}
                            className={() => `flex-1 flex items-center justify-center gap-2 py-4 px-6 rounded-full transition-all whitespace-nowrap ${activeTab === tab.id ? 'bg-cric-accent text-white shadow-lg shadow-cric-accent/20' : 'text-cric-muted hover:text-cric-text hover:bg-black/5 dark:hover:bg-white/5'}`}
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d={tab.icon} />
                            </svg>
                            <span className="text-[10px] font-black tracking-widest uppercase">{tab.label}</span>
                        </NavLink>
                    ))}
                </div>

                {/* Tab Content Area */}
                <div className="flex-1 bg-cric-card rounded-[3.5rem] border border-cric-border shadow-2xl p-8 overflow-y-auto no-scrollbar min-h-[600px]">
                    {activeTab === 'live' && (
                        <LiveTab
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
                            curInn={curInn}
                            onRetire={handleRetire}
                            handleEditBall={handleEditBall}
                            setActiveTab={setActiveTab}
                        />
                    )}

                    {activeTab === 'scorecard' && (
                        <ScorecardTab
                            curInn={curInn}
                            battingTeamName={battingTeamTeam?.name || 'Batting Team'}
                            bowlingTeamName={bowlingTeamTeam?.name || 'Bowling Team'}
                            battingPlayingXI={battingPlayingXI}
                            bowlingPlayingXI={bowlingPlayingXI}
                            battingXI={battingXI}
                            bowlingXI={bowlingXI}
                            selectedMatch={selectedMatch}
                        />
                    )}

                    {activeTab === 'commentary' && (
                        <CommentaryTab
                            formattedHistory={formattedHistory}
                            oversHistory={curInn?.oversHistory || []}
                            handleEditBall={handleEditBall}
                            setActiveTab={setActiveTab}
                        />
                    )}

                    {activeTab === 'stats' && (
                        <StatsTab />
                    )}

                    {activeTab === 'overs' && (
                        <div className="space-y-6 animate-fadeIn">
                            <h3 className="text-xl font-black font-raj italic uppercase text-cric-accent tracking-tight">Over-by-Over Summary</h3>
                            {(curInn?.oversHistory || []).slice().reverse().map((over, idx) => {
                                const overRuns = over.balls.reduce((s, b) => s + (b.runs || 0) + (b.isWide ? 1 : 0) + (b.isNoBall ? 1 : 0), 0);
                                const overWkts = over.balls.filter(b => b.isWicket).length;
                                return (
                                    <div key={idx} className="bg-black/[0.03] dark:bg-white/[0.03] rounded-2xl p-5 border border-cric-border/50">
                                        <div className="flex justify-between items-center mb-3">
                                            <div className="flex items-center gap-3">
                                                <span className="text-cric-accent font-black text-base">Over {over.overNumber + 1}</span>
                                                <span className="text-[10px] font-bold text-slate-500">
                                                    {over.bowler?.name || bowlingXI.find(p => String(p._id) === String(over.bowler?._id || over.bowler))?.name || 'Bowler'}
                                                </span>
                                            </div>
                                            <div className="text-sm font-black text-cric-text">
                                                {overRuns} run{overRuns !== 1 ? 's' : ''}
                                                {overWkts > 0 && <span className="text-red-500 ml-2">{overWkts} wkt{overWkts !== 1 ? 's' : ''}</span>}
                                                {over.maidenOver && <span className="text-green-500 ml-2">M</span>}
                                            </div>
                                        </div>
                                        <div className="flex gap-2 flex-wrap">
                                            {over.balls.map((b, bi) => {
                                                const isW = b.isWicket;
                                                const is4 = b.runs === 4 && !b.isWide && !b.isNoBall && !b.isWicket;
                                                const is6 = b.runs === 6 && !b.isWide && !b.isNoBall && !b.isWicket;
                                                const notation = isW ? 'W' : b.isWide ? `${b.runs}wd` : b.isNoBall ? `${b.runs}nb` : b.isBye ? `${b.runs}b` : b.isLegBye ? `${b.runs}lb` : b.runs === 0 ? '\u2022' : String(b.runs);
                                                return (
                                                    <div key={bi} className={`w-9 h-9 rounded-lg flex items-center justify-center text-xs font-black shrink-0 shadow-sm ${
                                                        isW ? 'bg-red-600 text-white' :
                                                        is6 ? 'bg-purple-600 text-white' :
                                                        is4 ? 'bg-blue-600 text-white' :
                                                        (b.isWide || b.isNoBall) ? 'bg-amber-500 text-white' :
                                                        'bg-black/10 dark:bg-white/10 text-cric-text'
                                                    }`}>{notation}</div>
                                                );
                                            })}
                                        </div>
                                        {over.summary && (
                                            <p className="text-[11px] text-slate-400 italic mt-3 border-t border-cric-border/30 pt-2">{over.summary}</p>
                                        )}
                                    </div>
                                );
                            })}
                            {(!curInn?.oversHistory || curInn.oversHistory.length === 0) && (
                                <div className="text-center py-12 text-slate-500 italic text-sm">No overs bowled yet.</div>
                            )}
                        </div>
                    )}

                    {activeTab === 'table' && (
                        <div className="space-y-8 animate-fadeIn">
                            <h3 className="text-xl font-black font-raj italic uppercase text-cric-accent tracking-tight">Match Summary Table</h3>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="border-b-2 border-cric-border">
                                            <th className="py-3 pl-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Team</th>
                                            <th className="py-3 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest">Score</th>
                                            <th className="py-3 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest">Overs</th>
                                            <th className="py-3 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest">RR</th>
                                            <th className="py-3 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest pr-4">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(selectedMatch?.innings || []).map((inn, idx) => {
                                            const teamName = selectedMatch.teams.find(t => String(t._id) === String(inn.team?._id || inn.team))?.name || 'Team';
                                            const ov = formatOvers(inn.balls);
                                            const rr = inn.runRate?.toFixed(2) || (inn.balls > 0 ? (inn.runs / (inn.balls / 6)).toFixed(2) : '0.00');
                                            return (
                                                <tr key={idx} className={`border-b border-cric-border/50 ${idx === selectedMatch.currentInnings ? 'bg-cric-accent/5' : ''}`}>
                                                    <td className="py-4 pl-4 font-bold text-sm text-cric-text">
                                                        {teamName}
                                                        {idx === selectedMatch.currentInnings && <span className="ml-2 text-[9px] bg-cric-accent/20 text-cric-accent px-2 py-0.5 rounded-full font-black uppercase">Batting</span>}
                                                    </td>
                                                    <td className="py-4 text-right font-black text-sm text-cric-text">{inn.runs}/{inn.wickets}</td>
                                                    <td className="py-4 text-right text-sm text-slate-500">{ov}</td>
                                                    <td className="py-4 text-right text-sm text-slate-500">{rr}</td>
                                                    <td className="py-4 text-right text-sm pr-4">
                                                        <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${
                                                            inn.status === 'live' ? 'bg-red-500/20 text-red-500' :
                                                            inn.status === 'completed' ? 'bg-green-500/20 text-green-500' :
                                                            'bg-slate-500/20 text-slate-500'
                                                        }`}>{inn.status || 'upcoming'}</span>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            {selectedMatch?.result?.description && (
                                <div className="bg-cric-accent/5 rounded-2xl p-5 border border-cric-accent/20 text-center">
                                    <span className="text-sm font-black text-cric-text">{selectedMatch.result.description}</span>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'xi' && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 animate-fadeIn">
                            {[battingTeamTeam, bowlingTeamTeam].map((team, idx) => (
                                <div key={idx} className="space-y-6">
                                    <div className="flex items-center gap-4 mb-4">
                                        <div className={`w-2 h-8 ${idx === 0 ? 'bg-[#ff6b35]' : 'bg-blue-500'} rounded-full`}></div>
                                        <h3 className="text-2xl font-black font-raj italic uppercase tracking-tighter">{team?.name} XI</h3>
                                    </div>
                                    <div className="space-y-3">
                                        {getPlayingXI(team?._id).map((p, pIdx) => (
                                            <div key={pIdx} className="bg-black/[0.03] dark:bg-white/[0.03] p-4 rounded-2xl border border-cric-border/50 flex justify-between items-center group hover:border-cric-accent/30 transition-all">
                                                <span className="font-bold text-cric-text group-hover:text-cric-accent transition-all">{p.name}</span>
                                                <span className="text-[10px] font-black text-cric-accent uppercase tracking-widest">{p.playingRole || 'Player'}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {['photos', 'videos', 'blogs'].includes(activeTab) && (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 animate-fadeIn">
                            {[1, 2, 3, 4, 5, 6].map(i => (
                                <div key={i} className="group cursor-pointer">
                                    <div className="aspect-video bg-black/40 rounded-[2rem] border border-white/5 overflow-hidden relative mb-4">
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-all"></div>
                                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all scale-75 group-hover:scale-100">
                                            <div className="w-12 h-12 rounded-full bg-[#ff6b35] flex items-center justify-center">
                                                <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                                            </div>
                                        </div>
                                        <div className="absolute inset-0 flex items-center justify-center text-[10px] font-black text-slate-700 uppercase tracking-widest group-hover:hidden">Media Preview {i}</div>
                                    </div>
                                    <h4 className="font-bold text-slate-300 group-hover:text-white transition-all px-2 uppercase text-sm tracking-tight">Match Highlight: {activeTab.slice(0, -1).toUpperCase()} #{i}</h4>
                                    <div className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] px-2 mt-2">2 Hours Ago • {activeTab.toUpperCase()}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* PERMANENT MANAGEMENT PANEL (Right Sidebar) */}
            <RightSidebarControls
                curInn={curInn}
                handleResetInnings={handleResetInnings}
                handleResetMatch={handleResetMatch}
                handleEndInnings={handleEndInnings}
                handleStartNext={handleStartNext}
                setShowSelectionModal={setShowSelectionModal}
                battingXI={battingXI}
                bowlingXI={bowlingXI}
                strikerId={strikerId}
                nonStrikerId={nonStrikerId}
                bowlerId={bowlerId}
                selectedRuns={selectedRuns}
                setSelectedRuns={setSelectedRuns}
                handleRevert={handleRevert}
                selectedExtra={selectedExtra}
                setSelectedExtra={setSelectedExtra}
                selectedWicket={selectedWicket}
                submitBall={submitBall}
                activeGroundZone={activeGroundZone}
                handleGroundClick={handleGroundClick}
                pitchMapBalls={pitchMapBalls}
                pitchMapCurrentOver={curInn?.overs || 0}
                pitchMapLine={pitchMapLine}
                setPitchMapLine={setPitchMapLine}
                pitchMapLength={pitchMapLength}
                setPitchMapLength={setPitchMapLength}
                pitchMapShot={pitchMapShot}
                setPitchMapShot={setPitchMapShot}
                pitchMapClickPos={pitchMapClickPos}
                setPitchMapClickPos={setPitchMapClickPos}
                pitchMapViewMode={pitchMapViewMode}
                setPitchMapViewMode={setPitchMapViewMode}
                ballMovement={ballMovement}
                setBallMovement={setBallMovement}
                ballOutcome={ballOutcome}
                setBallOutcome={setBallOutcome}
            />

            {/* MODALS */}
            <TieResolutionModal 
                isOpen={selectedMatch.status === 'pending_tie_resolution' && selectedMatch.tieResolution !== 'super_over'}
                onResolve={handleResolveTie}
            />

            <SuperOverSetupModal
                isOpen={showSelectionModal === 'super_over_setup' || (selectedMatch.status === 'pending_tie_resolution' && selectedMatch.tieResolution === 'super_over')}
                selectedMatch={selectedMatch}
                battingTeam={(() => {
                    const totalInnings = selectedMatch.innings.length;
                    const isFirstInnOfSO = totalInnings % 2 === 0;
                    return isFirstInnOfSO ? selectedMatch.teams[1] : selectedMatch.teams[0];
                })()}
                bowlingTeam={(() => {
                    const totalInnings = selectedMatch.innings.length;
                    const isFirstInnOfSO = totalInnings % 2 === 0;
                    return isFirstInnOfSO ? selectedMatch.teams[0] : selectedMatch.teams[1];
                })()}
                battingXI={getSquad(
                    (selectedMatch.innings.length % 2 === 0) 
                        ? (selectedMatch.teams[1]?._id || selectedMatch.teams[1])
                        : (selectedMatch.teams[0]?._id || selectedMatch.teams[0])
                )}
                bowlingXI={getSquad(
                    (selectedMatch.innings.length % 2 === 0) 
                        ? (selectedMatch.teams[0]?._id || selectedMatch.teams[0])
                        : (selectedMatch.teams[1]?._id || selectedMatch.teams[1])
                )}
                onStart={handleStartSuperOver}
            />

            {/* Selection Modals */}
            {showSelectionModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 dark:bg-black/90 backdrop-blur-sm">
                    <div className="bg-cric-card w-full max-w-4xl rounded-[3.5rem] border border-cric-border shadow-2xl overflow-hidden animate-zoomIn">
                        <div className="p-12">
                            <div className="flex justify-between items-center mb-12">
                                <h3 className="text-4xl font-black font-raj italic uppercase tracking-tighter text-cric-text">
                                    {showSelectionModal === 'wicket' ? 'DISMISSAL DETAILS' :
                                        showSelectionModal === 'striker' ? 'SELECT NEW STRIKER' :
                                            showSelectionModal === 'nonStriker' ? 'SELECT NEW NON-STRIKER' :
                                                showSelectionModal === 'bowler' ? 'CHANGE BOWLER' : 'SELECTION'}
                                </h3>
                                <button onClick={() => setShowSelectionModal('')} className="w-12 h-12 rounded-full bg-black/5 dark:bg-white/5 flex items-center justify-center hover:bg-red-500 transition-all text-cric-text hover:text-white">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12" /></svg>
                                </button>
                            </div>

                            {showSelectionModal === 'wicket' && (
                                <div className="space-y-8">
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                        {WICKET_TYPES.map(type => (
                                            <button key={type} onClick={() => setSelectedWicket(type)} className={`p-6 rounded-3xl border-2 font-black uppercase text-xs tracking-widest transition-all ${selectedWicket === type ? 'bg-red-600 border-red-400 text-white shadow-lg' : 'bg-black/5 dark:bg-white/2 border-cric-border text-slate-500 hover:border-cric-border/80'}`}>
                                                {type}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest pl-2">Next Batsman</label>
                                            <select value={setupState.wicketNewBatter} onChange={(e) => setSetupState(s => ({ ...s, wicketNewBatter: e.target.value }))} className="w-full p-6 bg-cric-bg border border-cric-border rounded-3xl text-cric-text font-black outline-none focus:border-red-500">
                                                <option value="">Select Next In...</option>
                                                {battingXI.filter(p => {
                                                    const pId = p._id || p;
                                                    const stats = curInn?.batting?.find(b => String(b.player?._id || b.player) === String(pId));
                                                    const isCurrent = [String(strikerId), String(nonStrikerId)].includes(String(pId));
                                                    const isOut = stats?.isOut || stats?.isRetired;
                                                    return !isCurrent && (!stats || stats.isRetiredHurt) && !isOut;
                                                }).map(p => (
                                                    <option key={p._id} value={p._id}>{p.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest pl-2">Fielder Involved</label>
                                            <select value={setupState.wicketFielder} onChange={(e) => setSetupState(s => ({ ...s, wicketFielder: e.target.value }))} className="w-full p-6 bg-cric-bg border border-cric-border rounded-3xl text-cric-text font-black outline-none focus:border-red-500">
                                                <option value="">Select Fielder...</option>
                                                {bowlingXI.map(p => (
                                                    <option key={p._id} value={p._id}>{p.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                    <button 
                                        onClick={() => {
                                            if (!setupState.wicketNewBatter && curInn.wickets < 9 && selectedWicket !== 'retired hurt') {
                                                showToast("Please select the next batsman before confirming.", 'warning');
                                                return;
                                            }
                                            setShowSelectionModal('');
                                        }} 
                                        className="w-full py-8 rounded-[2rem] bg-red-600 text-white font-black font-raj text-2xl italic tracking-tighter uppercase shadow-xl hover:scale-105 transition-all mt-8"
                                    >
                                        Confirm Wicket Details
                                    </button>
                                </div>
                            )}

                            {(showSelectionModal === 'striker' || showSelectionModal === 'nonStriker') && (
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                    {battingXI.filter(p => {
                                        const pId = p._id || p;
                                        const stats = curInn?.batting?.find(b => String(b.player?._id || b.player) === String(pId));
                                        const isOut = stats?.isOut || stats?.isRetired;
                                        return (!stats || stats.isRetiredHurt) && !isOut;
                                    }).map(p => (
                                        <button key={p._id} onClick={() => setRole(p._id, showSelectionModal)} className="p-8 rounded-[2rem] bg-black/5 dark:bg-white/5 border border-cric-border hover:border-cric-accent hover:bg-cric-accent/5 transition-all text-left">
                                            <div className="text-xl font-black text-cric-text">{p.name}</div>
                                            <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mt-2 select-none">
                                                {curInn?.batting?.find(b => String(b.player?._id || b.player) === String(p._id))?.isRetiredHurt ? 'Return Retired Hurt' : 'Select Batter'}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}

                            {showSelectionModal === 'bowler' && (
                                <div className="space-y-8">
                                    {(() => {
                                        const mainBowlers = bowlingXI.filter(p => 
                                            ['Bowler', 'All-Rounder', 'Bowling-All-Rounder'].includes(p.playingRole)
                                        );
                                        const partTimers = bowlingXI.filter(p => 
                                            !['Bowler', 'All-Rounder', 'Bowling-All-Rounder'].includes(p.playingRole)
                                        );

                                        return (
                                            <>
                                                {mainBowlers.length > 0 && (
                                                    <div>
                                                        <h4 className="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-4 pl-2">Main Bowlers</h4>
                                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                                            {mainBowlers.map(p => (
                                                                <button key={p._id} onClick={() => setRole(p._id, 'bowler')} className="p-6 rounded-[2rem] bg-black/5 dark:bg-white/5 border border-cric-border hover:border-blue-500 hover:bg-blue-500/5 transition-all text-left">
                                                                    <div className="text-lg font-black text-cric-text">{p.name}</div>
                                                                    <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mt-2 select-none">
                                                                        {p.bowlingStyle && p.bowlingStyle !== 'Not Applicable' ? p.bowlingStyle : 'BOWLER'}
                                                                    </div>
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                {partTimers.length > 0 && (
                                                    <div className="pt-4 border-t border-cric-border/30">
                                                        <h4 className="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-4 pl-2">Part-timer Bowlers</h4>
                                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                                            {partTimers.map(p => (
                                                                <button key={p._id} onClick={() => setRole(p._id, 'bowler')} className="p-6 rounded-[2rem] bg-black/5 dark:bg-white/5 border border-cric-border hover:border-blue-500 hover:bg-blue-500/5 transition-all text-left">
                                                                    <div className="text-lg font-black text-cric-text">{p.name}</div>
                                                                    <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mt-2 select-none">
                                                                        {p.bowlingStyle && p.bowlingStyle !== 'Not Applicable' ? p.bowlingStyle : 'PART-TIMER'}
                                                                    </div>
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </>
                                        );
                                    })()}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {showSettings && (
                <MatchSettings
                    match={selectedMatch}
                    onClose={() => setShowSettings(false)}
                    onUpdate={() => {
                        setShowSettings(false);
                        reloadMatch();
                    }}
                />
            )}
            <ConfirmModal
                open={confirmModal.open}
                title={confirmModal.title}
                message={confirmModal.message}
                confirmLabel={confirmModal.confirmLabel}
                variant={confirmModal.variant}
                onConfirm={confirmModal.onConfirm}
                onCancel={() => setConfirmModal({ open: false })}
            />
        </div>
    );
}
