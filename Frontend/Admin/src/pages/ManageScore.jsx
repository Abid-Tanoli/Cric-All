import React, { useState } from 'react';
import { NavLink, useParams, useNavigate } from 'react-router-dom';
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
import BattingPositionBadge from '@shared/components/BattingPositionBadge';
import StatsTab from '../components/ScoreManagement/StatsTab';
import { TABS, getScoreTabPath, formatOvers, FIELD_POSITIONS, WICKET_TYPES } from '../components/ScoreManagement/constants';
import ScoringMobileBar from '../components/ScoringMobileBar';
import PlayerOfMatchCard from '../components/ScoreManagement/PlayerOfMatchCard';

export default function ManageScore() {
    const navigate = useNavigate();
    const { matchId } = useParams();
    const {
        matches,
        selectedMatch,
        setSelectedMatch,
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
        formattedHistory,
        pitchMapBalls,
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
        handleSaveFormat,
        handleSavePlayingXI,
        handleSaveToss,
        handleSaveOpeners,
        reverting,
        handleResolveTie,
        handleStartSuperOver,
        handleDeleteMatch,
        getPlayingXI,
        getSquad,
        showToast,
        reloadMatch,
        fieldedById,
        setFieldedById,
        fieldedByPosition,
        setFieldedByPosition,
    } = useMatchScoring();

    const [loadTimeout, setLoadTimeout] = useState(false);
    const [activeScorePanel, setActiveScorePanel] = useState(() =>
        typeof window !== 'undefined' && window.matchMedia('(max-width: 1279px)').matches ? 'management' : 'main'
    );

    React.useEffect(() => {
        setLoadTimeout(false);
        const timer = setTimeout(() => setLoadTimeout(true), 4000);
        return () => clearTimeout(timer);
    }, [matchId]);

    if (loading && !selectedMatch && !loadTimeout) {
        return (
            <div className="p-6 sm:p-10 text-center text-lg sm:text-xl font-bold bg-cric-bg min-h-screen text-cric-text flex flex-col items-center justify-center">
                <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-cric-accent border-t-transparent mb-4" />
                <p>Loading match data...</p>
                <p className="text-sm text-cric-muted mt-2">Connecting to server</p>
            </div>
        );
    }

    if (!selectedMatch) {
        const isValidMatchId = matchId && matchId !== 'score';

        if (isValidMatchId && loadTimeout) {
            return (
                <div className="p-4 sm:p-8 max-w-[1200px] mx-auto min-h-screen bg-cric-bg transition-colors duration-300 text-center">
                    <div className="bg-cric-card rounded-[2rem] sm:rounded-[2.5rem] p-6 sm:p-12 border border-cric-border shadow-xl max-w-md mx-auto">
                        <div className="w-16 h-16 mx-auto mb-6 bg-red-500/10 rounded-full flex items-center justify-center">
                            <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.636 5.636a9 9 0 1012.728 0M12 9v4m0 4h.01" />
                            </svg>
                        </div>
                        <h2 className="text-2xl font-black font-raj text-cric-text mb-3">Unable to Load Match</h2>
                        <p className="text-cric-muted mb-2">Could not connect to the server. Please make sure:</p>
                        <ul className="text-sm text-cric-muted mb-6 text-left list-disc list-inside">
                            <li>The backend server is running on port 5000</li>
                            <li>The match ID is correct</li>
                            <li>Your network connection is working</li>
                        </ul>
                        <div className="flex flex-col sm:flex-row gap-3 justify-center">
                            <button 
                                onClick={() => navigate('/admin/score')}
                                className="px-6 py-3 bg-cric-accent text-white font-black rounded-xl hover:scale-105 transition-all"
                            >
                                Back to Match List
                            </button>
                            <button 
                                onClick={() => window.location.reload()}
                                className="px-6 py-3 bg-cric-bg text-cric-text border border-cric-border font-black rounded-xl hover:bg-cric-border transition-all"
                            >
                                Retry
                            </button>
                        </div>
                    </div>
                </div>
            );
        }
        
        return (
            <div className="p-4 sm:p-8 max-w-[1200px] mx-auto min-h-screen bg-cric-bg transition-colors duration-300">
                <h1 className="text-2xl sm:text-3xl font-black text-cric-text mb-6 sm:mb-8 uppercase tracking-tight">Select Match to Score</h1>
                {matches.length === 0 && !loading && (
                    <div className="bg-cric-card rounded-[2rem] sm:rounded-[2.5rem] p-6 sm:p-12 border border-cric-border shadow-xl text-center">
                        <div className="w-16 h-16 mx-auto mb-6 bg-cric-accent/10 rounded-full flex items-center justify-center">
                            <svg className="w-8 h-8 text-cric-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </div>
                        <h2 className="text-xl font-black font-raj text-cric-text mb-2">No Matches Available</h2>
                        <p className="text-cric-muted mb-6">Create a match from the Events panel to start scoring.</p>
                        <button 
                            onClick={() => navigate('/admin/events')}
                            className="px-6 py-3 bg-cric-accent text-white font-black rounded-xl hover:scale-105 transition-all"
                        >
                            Go to Events
                        </button>
                    </div>
                )}
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

    const matchStatus = selectedMatch?.status;
    const isUpcoming = matchStatus === 'upcoming' || matchStatus === 'scheduled';
    const isCompleted = matchStatus === 'completed';

    if (isUpcoming && !isPreMatchComplete) {
        return (
            <MatchSetupWizard
                wizardStep={wizardStep}
                selectedMatch={selectedMatch}
                setSelectedMatch={setSelectedMatch}
                setupState={setupState}
                setSetupState={setSetupState}
                handleSaveFormat={handleSaveFormat}
                handleSavePlayingXI={handleSavePlayingXI}
                handleSaveToss={handleSaveToss}
                handleSaveOpeners={handleSaveOpeners}
                battingXI={battingXI}
                bowlingXI={bowlingXI}
            />
        );
    }

    if (isUpcoming) {
        return (
            <div className="p-4 sm:p-8 max-w-[1200px] mx-auto min-h-screen bg-cric-bg transition-colors duration-300">
                <div className="bg-cric-card rounded-[2rem] sm:rounded-[2.5rem] p-6 sm:p-12 border border-cric-border shadow-xl max-w-2xl mx-auto text-center">
                    <div className="w-16 h-16 sm:w-20 sm:h-20 mx-auto mb-4 sm:mb-6 bg-amber-500/10 rounded-full flex items-center justify-center">
                        <svg className="w-8 h-8 sm:w-10 sm:h-10 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                    </div>
                    <h2 className="text-2xl sm:text-3xl font-black font-raj text-cric-text mb-3 sm:mb-4 uppercase tracking-tight">Match Has Not Started Yet</h2>
                    <div className="text-lg sm:text-xl font-black text-cric-text mb-4 sm:mb-6">
                        {selectedMatch.teams?.[0]?.name} <span className="text-cric-accent">VS</span> {selectedMatch.teams?.[1]?.name}
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-6 sm:mb-8 text-left bg-cric-bg rounded-2xl p-4 sm:p-6 border border-cric-border">
                        <div>
                            <p className="text-[9px] font-black text-cric-muted uppercase tracking-widest">Format</p>
                            <p className="text-sm font-bold text-cric-text">{selectedMatch.matchType || selectedMatch.format || 'N/A'}</p>
                        </div>
                        <div>
                            <p className="text-[9px] font-black text-cric-muted uppercase tracking-widest">Venue</p>
                            <p className="text-sm font-bold text-cric-text">{selectedMatch.venue || 'N/A'}</p>
                        </div>
                        <div>
                            <p className="text-[9px] font-black text-cric-muted uppercase tracking-widest">Date</p>
                            <p className="text-sm font-bold text-cric-text">{selectedMatch.startAt ? new Date(selectedMatch.startAt).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : 'TBD'}</p>
                        </div>
                        <div>
                            <p className="text-[9px] font-black text-cric-muted uppercase tracking-widest">Time</p>
                            <p className="text-sm font-bold text-cric-text">{selectedMatch.startAt ? new Date(selectedMatch.startAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : 'TBD'}</p>
                        </div>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center">
                        <button
                            onClick={() => navigate('/admin/score')}
                            className="px-6 py-3 bg-cric-accent text-white font-black rounded-xl hover:bg-[#e55a2b] transition-all uppercase tracking-widest text-xs"
                        >
                            Back to Match List
                        </button>
                        <button
                            onClick={() => { setShowSettings(true); }}
                            className="px-6 py-3 bg-cric-bg text-cric-text border border-cric-border font-black rounded-xl hover:bg-cric-border transition-all uppercase tracking-widest text-xs"
                        >
                            Match Settings
                        </button>
                    </div>
                </div>
                {showSettings && (
                    <MatchSettings
                        match={selectedMatch}
                        onClose={() => setShowSettings(false)}
                        onUpdate={() => { setShowSettings(false); reloadMatch(); }}
                    />
                )}
            </div>
        );
    }

    if (isCompleted) {
        return (
            <div className="p-4 sm:p-8 max-w-[1200px] mx-auto min-h-screen bg-cric-bg transition-colors duration-300">
                <div className="bg-cric-card rounded-[2rem] sm:rounded-[2.5rem] p-6 sm:p-12 border border-cric-border shadow-xl max-w-2xl mx-auto text-center">
                    <div className="w-16 h-16 sm:w-20 sm:h-20 mx-auto mb-4 sm:mb-6 bg-green-500/10 rounded-full flex items-center justify-center">
                        <svg className="w-8 h-8 sm:w-10 sm:h-10 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </div>
                    <h2 className="text-2xl sm:text-3xl font-black font-raj text-cric-text mb-3 sm:mb-4 uppercase tracking-tight">Match Completed</h2>
                    <div className="text-lg sm:text-xl font-black text-cric-text mb-2">
                        {selectedMatch.teams?.[0]?.name} <span className="text-cric-accent">VS</span> {selectedMatch.teams?.[1]?.name}
                    </div>
                    {selectedMatch.result?.description && (
                        <p className="text-cric-accent font-bold text-base sm:text-lg mb-4 sm:mb-6">{selectedMatch.result.description}</p>
                    )}
                    <PlayerOfMatchCard
                        match={selectedMatch}
                        onSaved={() => reloadMatch()}
                        showToast={showToast}
                    />
                    <div className="flex flex-col sm:flex-row justify-center gap-4 sm:gap-8 mb-6 sm:mb-8 mt-6 sm:mt-8">
                        {(selectedMatch.innings || []).map((inn, idx) => (
                            <div key={inn._id || idx} className="bg-cric-bg rounded-2xl p-4 sm:p-6 border border-cric-border text-center min-w-0 sm:min-w-[180px]">
                                <p className="text-[9px] font-black text-cric-muted uppercase tracking-widest mb-2">
                                    {selectedMatch.teams?.find(t => String(t._id) === String(inn.team?._id || inn.team))?.name || `Team ${idx + 1}`}
                                </p>
                                <p className="text-3xl sm:text-4xl font-black text-cric-text">{inn.runs}/{inn.wickets}</p>
                                <p className="text-sm font-bold text-cric-muted">Overs {formatOvers(inn.balls)}</p>
                                {inn.runRate && <p className="text-xs font-bold text-cric-muted">RR: {inn.runRate.toFixed(2)}</p>}
                            </div>
                        ))}
                    </div>
                    <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center">
                        <button
                            onClick={() => navigate('/admin/score')}
                            className="px-6 py-3 bg-cric-accent text-white font-black rounded-xl hover:bg-[#e55a2b] transition-all uppercase tracking-widest text-xs"
                        >
                            Back to Match List
                        </button>
                        <button
                            onClick={() => navigate(`/admin/score/${selectedMatch._id}/scorecard`)}
                            className="px-6 py-3 bg-cric-bg text-cric-text border border-cric-border font-black rounded-xl hover:bg-cric-border transition-all uppercase tracking-widest text-xs"
                        >
                            View Scorecard
                        </button>
                    </div>
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
                handleSaveFormat={handleSaveFormat}
                handleSavePlayingXI={handleSavePlayingXI}
                handleSaveToss={handleSaveToss}
                handleSaveOpeners={handleSaveOpeners}
                battingXI={battingXI}
                bowlingXI={bowlingXI}
            />
        );
    }

    const responsivePanelClass = (panel) =>
        `${activeScorePanel === panel ? 'block' : 'hidden'} xl:block min-w-0`;

    return (
        <div className="min-h-[60vh] bg-cric-bg text-cric-text transition-colors duration-300 max-w-full overflow-x-hidden">
            <ScoringMobileBar
                activePanel={activeScorePanel}
                onPanelChange={setActiveScorePanel}
            />

            <div className="grid grid-cols-1 gap-3 xl:gap-6 xl:grid-cols-[280px_minmax(0,1fr)_460px]">
                <aside className={responsivePanelClass('sidebar')}>
                    <div className="xl:sticky xl:top-4 rounded-[2rem] border border-cric-border bg-cric-card p-5 shadow-xl">
                        <div className="mb-5">
                            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-cric-accent">Match Control</p>
                            <h2 className="mt-2 text-2xl font-black font-raj italic uppercase leading-none text-cric-text">
                                {battingTeamTeam?.shortName || battingTeamTeam?.name || 'Batting'} vs {bowlingTeamTeam?.shortName || bowlingTeamTeam?.name || 'Bowling'}
                            </h2>
                            <p className="mt-2 text-xs font-semibold text-cric-muted break-words">{selectedMatch.venue || 'Venue TBC'}</p>
                        </div>

                        <div className="grid grid-cols-2 gap-3 text-center">
                            <div className="rounded-xl bg-cric-bg p-3 ring-1 ring-cric-border">
                                <p className="text-[9px] font-black uppercase tracking-widest text-cric-muted">Score</p>
                                <p className="mt-1 text-xl font-black text-cric-text">{curInn?.runs}/{curInn?.wickets}</p>
                            </div>
                            <div className="rounded-xl bg-cric-bg p-3 ring-1 ring-cric-border">
                                <p className="text-[9px] font-black uppercase tracking-widest text-cric-muted">Overs</p>
                                <p className="mt-1 text-xl font-black text-cric-text">{formatOvers(curInn?.balls)}</p>
                            </div>
                        </div>

                        <div className="mt-5 space-y-2">
                            {TABS.map(tab => (
                                <NavLink
                                    key={tab.id}
                                    to={getScoreTabPath(selectedMatch._id, tab.id)}
                                    end={tab.id === 'live'}
                                    onClick={() => setActiveScorePanel('main')}
                                    className={() => `flex items-center justify-between rounded-xl px-3 py-3 text-xs font-black uppercase tracking-widest transition-all ${activeTab === tab.id ? 'bg-cric-accent text-white' : 'bg-cric-bg text-cric-muted hover:text-cric-text'}`}
                                >
                                    <span>{tab.label}</span>
                                    <span aria-hidden="true">&gt;</span>
                                </NavLink>
                            ))}
                        </div>
                    </div>
                </aside>

                {/* MAIN CONTENT */}
                <main className={`${responsivePanelClass('main')} flex flex-col min-w-0`}>
                <div className="bg-cric-card rounded-2xl lg:rounded-[2.5rem] p-3 sm:p-6 md:p-8 border border-cric-border shadow-xl mb-4 xl:mb-6">
                    <div className="flex flex-wrap justify-between items-start gap-3 mb-4 sm:mb-6">
                        <div className="flex items-center gap-3 min-w-0">
                            <div className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse shrink-0"></div>
                            <span className="text-[10px] font-black tracking-[0.3em] uppercase text-cric-muted">Live Match</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <div className="text-[9px] font-black tracking-widest uppercase text-cric-accent hidden sm:block">ID: {selectedMatch._id.slice(-6)}</div>
                            <button
                                onClick={() => setShowSettings(true)}
                                className="score-touch-btn p-2 rounded-xl bg-cric-bg hover:bg-cric-border transition-all text-cric-muted hover:text-cric-text border border-cric-border"
                                title="Match Settings"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                            </button>
                        </div>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-2 sm:gap-4">
                        <div className="space-y-1 sm:space-y-2 min-w-0 flex-1">
                            <h1 className="text-base sm:text-xl md:text-3xl lg:text-4xl font-black font-raj italic tracking-tighter uppercase leading-tight break-words">
                                {battingTeamTeam?.shortName || battingTeamTeam?.name} <span className="text-cric-accent">VS</span> {bowlingTeamTeam?.shortName || bowlingTeamTeam?.name}
                            </h1>
                            <div className="text-cric-muted font-medium flex flex-wrap items-center gap-1.5 sm:gap-2 text-[10px] sm:text-xs lg:text-sm">
                                <span className="break-words max-w-[160px] sm:max-w-none truncate">{selectedMatch.venue}</span>
                                <span className="px-2 py-0.5 rounded-full bg-cric-bg border border-cric-border text-[9px] sm:text-[10px] font-black uppercase">{selectedMatch.matchType || 'T20'}</span>
                                {(() => {
                                    const pp = selectedMatch.powerplayConfig || curInn?.powerplayConfig;
                                    if (pp?.enabled && curInn) {
                                        const completedOvers = Math.floor((curInn.balls || 0) / 6);
                                        const ppActive = completedOvers < (pp.overs || 0);
                                        return ppActive ? (
                                            <span className="px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 text-[10px] font-black uppercase tracking-wider flex items-center gap-1">
                                                <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
                                                Powerplay {completedOvers + 1}/{pp.overs}
                                            </span>
                                        ) : (
                                            <span className="px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 text-[10px] font-black uppercase tracking-wider">
                                                PP done
                                            </span>
                                        );
                                    }
                                    return null;
                                })()}
                            </div>
                            {isInnings2 && firstInn && (
                                <div className="mt-2 flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4">
                                    <div className="bg-slate-100 dark:bg-slate-800 rounded-lg px-3 py-1.5">
                                        <span className="text-xs font-bold text-slate-500">1st Innings:</span>
                                        <span className="text-sm font-black text-[#031d44] dark:text-white ml-2">
                                            {selectedMatch.teams?.find(t => String(t._id) === String(firstInn.team?._id || firstInn.team))?.shortName || 'Team A'} {firstInn.runs}/{firstInn.wickets} ({formatOvers(firstInn.balls)})
                                        </span>
                                    </div>
                                    <div className="bg-[#ff6b35]/10 rounded-lg px-3 py-1.5">
                                        <span className="text-xs font-bold text-[#ff6b35]">Target:</span>
                                        <span className="text-sm font-black text-[#ff6b35] ml-2">{target}</span>
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="text-left sm:text-right shrink-0">
                            <div className="text-3xl sm:text-4xl md:text-5xl font-black font-raj italic text-cric-text leading-none tabular-nums">
                                {curInn?.runs}/{curInn?.wickets}
                            </div>
                            <div className="text-sm md:text-lg font-bold text-cric-muted mt-1">OVERS {formatOvers(curInn?.balls)}</div>
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
                            className={() => `flex-1 flex items-center justify-center gap-1 sm:gap-2 py-2.5 sm:py-4 px-2 sm:px-6 rounded-full transition-all whitespace-nowrap ${activeTab === tab.id ? 'bg-cric-accent text-white shadow-lg shadow-cric-accent/20' : 'text-cric-muted hover:text-cric-text hover:bg-black/5 dark:hover:bg-white/5'}`}
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d={tab.icon} />
                            </svg>
                            <span className="text-[10px] font-black tracking-widest uppercase">{tab.label}</span>
                        </NavLink>
                    ))}
                </div>

                {/* Tab Content Area */}
                <div className="flex-1 bg-cric-card rounded-[1.5rem] sm:rounded-[2rem] lg:rounded-[3.5rem] border border-cric-border shadow-2xl p-2 sm:p-4 md:p-8 overflow-y-auto no-scrollbar min-h-[300px] sm:min-h-[400px] lg:min-h-[600px]">
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
                        <StatsTab
                            innings={curInn}
                            strikerStats={strikerStats}
                            nonStrikerStats={nonStrikerStats}
                            activeBowlerStats={activeBowlerStats}
                            totalOvers={selectedMatch?.totalOvers}
                        />
                    )}

                    {activeTab === 'overs' && (
                        <div className="space-y-6 animate-fadeIn">
                            <h3 className="text-xl font-black font-raj italic uppercase text-cric-accent tracking-tight">Over-by-Over Summary</h3>
                            {(curInn?.oversHistory || []).slice().reverse().map((over, idx) => {
                                const overRuns = over.balls.reduce((s, b) => s + (b.runs || 0) + (b.isWide ? 1 : 0) + (b.isNoBall ? 1 : 0), 0);
                                const overWkts = over.balls.filter(b => b.isWicket).length;
                                const overKey = over._id || (over.overNumber ?? idx);
                                return (
                                    <div key={overKey} className="bg-black/[0.03] dark:bg-white/[0.03] rounded-2xl p-5 border border-cric-border/50">
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
                                                    <div key={b._id || `${overKey}-${bi}`} className={`w-9 h-9 rounded-lg flex items-center justify-center text-xs font-black shrink-0 shadow-sm ${
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
                                                <tr key={inn._id || idx} className={`border-b border-cric-border/50 ${idx === selectedMatch.currentInnings ? 'bg-cric-accent/5' : ''}`}>
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
                                                <span className="flex items-center gap-1.5 text-[10px] font-black text-cric-accent uppercase tracking-widest">
                                                    {p.playingRole || 'Player'}
                                                    <BattingPositionBadge value={p.battingPosition} />
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {['photos', 'videos', 'blogs'].includes(activeTab) && (
                        <div className="animate-fadeIn text-center py-16">
                            <div className="w-16 h-16 mx-auto mb-4 bg-cric-bg rounded-full flex items-center justify-center">
                                <svg className="w-8 h-8 text-cric-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                                </svg>
                            </div>
                            <h3 className="text-lg font-black text-cric-muted uppercase tracking-wider mb-2 capitalize">{activeTab}</h3>
                            <p className="text-sm text-cric-muted/70">Media upload feature coming soon</p>
                        </div>
                    )}
                </div>
                </main>

                <section className={responsivePanelClass('management')}>
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
                useAICommentary={useAICommentary}
                setUseAICommentary={setUseAICommentary}
                manualCommentary={manualCommentary}
                setManualCommentary={setManualCommentary}
                fieldedById={fieldedById}
                setFieldedById={setFieldedById}
                fieldedByPosition={fieldedByPosition}
                setFieldedByPosition={setFieldedByPosition}
                formattedHistory={formattedHistory}
                matchId={matchId}
            />
                </section>
            </div>

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
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 dark:bg-black/90 backdrop-blur-sm">
                    <div className="bg-cric-card w-full max-w-4xl max-h-[92vh] rounded-t-2xl sm:rounded-[2rem] lg:rounded-[3.5rem] border border-cric-border shadow-2xl overflow-y-auto animate-zoomIn">
                        <div className="p-4 sm:p-8 md:p-12">
                            <div className="flex justify-between items-start gap-3 mb-4 sm:mb-8 md:mb-12">
                                <h3 className="text-2xl sm:text-3xl md:text-4xl font-black font-raj italic uppercase tracking-tighter text-cric-text leading-none break-words">
                                    {showSelectionModal === 'wicket' ? 'DISMISSAL DETAILS' :
                                        showSelectionModal === 'striker' ? 'SELECT NEW STRIKER' :
                                            showSelectionModal === 'nonStriker' ? 'SELECT NEW NON-STRIKER' :
                                                showSelectionModal === 'bowler' ? 'CHANGE BOWLER' : 'SELECTION'}
                                </h3>
                                <button onClick={() => setShowSelectionModal('')} className="score-touch-btn w-11 h-11 sm:w-12 sm:h-12 shrink-0 rounded-full bg-black/5 dark:bg-white/5 flex items-center justify-center hover:bg-red-500 transition-all text-cric-text hover:text-white">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12" /></svg>
                                </button>
                            </div>

                            {showSelectionModal === 'wicket' && (
                                <div className="space-y-8">
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 sm:gap-4">
                                        {WICKET_TYPES.map(type => (
                                            <button key={type} onClick={() => setSelectedWicket(type)} className={`score-touch-btn p-3 sm:p-6 rounded-2xl sm:rounded-3xl border-2 font-black uppercase text-[9px] sm:text-xs tracking-widest transition-all ${selectedWicket === type ? 'bg-red-600 border-red-400 text-white shadow-lg' : 'bg-black/5 dark:bg-white/2 border-cric-border text-slate-500 hover:border-cric-border/80'}`}>
                                                {type}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-8">
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest pl-2">Next Batsman</label>
                                            <select value={setupState.wicketNewBatter} onChange={(e) => setSetupState(s => ({ ...s, wicketNewBatter: e.target.value }))} className="w-full p-3 sm:p-6 bg-cric-bg border border-cric-border rounded-2xl sm:rounded-3xl text-cric-text font-black outline-none focus:border-red-500">
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
                                            <select value={setupState.wicketFielder} onChange={(e) => setSetupState(s => ({ ...s, wicketFielder: e.target.value }))} className="w-full p-3 sm:p-6 bg-cric-bg border border-cric-border rounded-2xl sm:rounded-3xl text-cric-text font-black outline-none focus:border-red-500">
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
                                        className="score-touch-btn w-full py-4 sm:py-8 rounded-2xl sm:rounded-[2rem] bg-red-600 text-white font-black font-raj text-base sm:text-2xl italic tracking-tighter uppercase shadow-xl hover:scale-105 transition-all mt-4 sm:mt-8"
                                    >
                                        Confirm Wicket Details
                                    </button>
                                </div>
                            )}

                            {(showSelectionModal === 'striker' || showSelectionModal === 'nonStriker') && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
                                    {battingXI.filter(p => {
                                        const pId = p._id || p;
                                        const stats = curInn?.batting?.find(b => String(b.player?._id || b.player) === String(pId));
                                        const isOut = stats?.isOut || stats?.isRetired;
                                        return (!stats || stats.isRetiredHurt) && !isOut;
                                    }).map(p => (
                                        <button key={p._id} onClick={() => setRole(p._id, showSelectionModal)} className="score-touch-btn p-4 sm:p-8 rounded-2xl sm:rounded-[2rem] bg-black/5 dark:bg-white/5 border border-cric-border hover:border-cric-accent hover:bg-cric-accent/5 transition-all text-left min-w-0">
                                            <div className="text-base sm:text-xl font-black text-cric-text">{p.name}</div>
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
                                                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
                                                            {mainBowlers.map(p => (
                                                                <button key={p._id} onClick={() => setRole(p._id, 'bowler')} className="score-touch-btn p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] bg-black/5 dark:bg-white/5 border border-cric-border hover:border-blue-500 hover:bg-blue-500/5 transition-all text-left min-w-0">
                                                                    <div className="text-sm sm:text-lg font-black text-cric-text">{p.name}</div>
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
                                                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
                                                            {partTimers.map(p => (
                                                                <button key={p._id} onClick={() => setRole(p._id, 'bowler')} className="score-touch-btn p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] bg-black/5 dark:bg-white/5 border border-cric-border hover:border-blue-500 hover:bg-blue-500/5 transition-all text-left min-w-0">
                                                                    <div className="text-sm sm:text-lg font-black text-cric-text">{p.name}</div>
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
