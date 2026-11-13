import React from 'react';
import Scorecard from '../Scorecard';
import { formatOvers } from './constants';

export default React.memo(function ScorecardTab({
    curInn,
    battingTeamName,
    bowlingTeamName,
    battingPlayingXI,
    bowlingPlayingXI,
    battingXI,
    bowlingXI,
    selectedMatch
}) {
    const tossInfo = selectedMatch?.tossWinner && selectedMatch?.tossDecision
        ? `${selectedMatch.teams.find(t => String(t._id) === String(selectedMatch.tossWinner?._id || selectedMatch.tossWinner))?.name || 'Team'} chose to ${selectedMatch.tossDecision}.`
        : null;

    return (
        <Scorecard
            curInn={curInn}
            battingTeamName={battingTeamName}
            bowlingTeamName={bowlingTeamName}
            battingXI={battingPlayingXI}
            bowlingXI={bowlingPlayingXI}
            allPlayers={[...battingXI, ...bowlingXI]}
            formatOvers={formatOvers}
            selectedMatch={selectedMatch}
            tossInfo={tossInfo}
        />
    );
});
