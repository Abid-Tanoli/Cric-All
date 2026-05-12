import React, { useMemo, useState } from "react";

const getId = (value) => {
    if (!value) return "";
    return String(value._id || value);
};

const uniqueById = (players) => {
    const seen = new Set();
    return players.filter((player) => {
        const id = getId(player);
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
    });
};

const formatOversFromBalls = (balls = 0) => `${Math.floor(balls / 6)}.${balls % 6}`;

const formatDecimalOvers = (value) => {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return "?";
    const numeric = Number(value);
    const whole = Math.floor(numeric);
    const balls = Math.round((numeric - whole) * 6);
    return `${whole}.${balls}`;
};

const getPlayerName = (player, allPlayers, fallback = "Player") => {
    if (!player) return fallback;
    if (typeof player === "object" && player.name) return player.name;
    const id = getId(player);
    return allPlayers.find((candidate) => getId(candidate) === id)?.name || fallback;
};

const getBallRunsForBowler = (ball) => {
    const runs = Number(ball.runs || 0);
    if (ball.isBye || ball.isLegBye) return 0;
    if (ball.isWide) return runs + 1;
    if (ball.isNoBall) return runs + 1;
    return runs;
};

const getDismissalText = (batter, allPlayers, wicketBall) => {
    if (batter.isRetiredHurt) return "retired hurt";
    if (batter.isRetired) return "retired hurt";
    if (!batter.isOut) return "not out";

    const type = (batter.dismissalType || wicketBall?.wicketType || "").toLowerCase();
    const bowlerName = getPlayerName(batter.dismissedBy || wicketBall?.bowler, allPlayers, "Bowler");
    const fielderName = getPlayerName(batter.fielder || wicketBall?.fielder, allPlayers, "");

    switch (type) {
        case "bowled":
            return `b ${bowlerName}`;
        case "caught":
            return fielderName ? `c ${fielderName} b ${bowlerName}` : `c & b ${bowlerName}`;
        case "lbw":
            return `lbw b ${bowlerName}`;
        case "run out":
            return fielderName ? `run out (${fielderName})` : "run out";
        case "stumped":
            return fielderName ? `st ${fielderName} b ${bowlerName}` : `st b ${bowlerName}`;
        case "hit wicket":
            return `hit wicket b ${bowlerName}`;
        default:
            return type || "dismissed";
    }
};

export default function Scorecard({
    curInn,
    battingTeamName,
    bowlingTeamName,
    battingXI = [],
    bowlingXI = [],
    allPlayers = [],
    formatOvers,
    selectedMatch,
    tossInfo,
}) {
    const [expandedBowlerId, setExpandedBowlerId] = useState("");

    const scorecard = useMemo(() => {
        if (!curInn) return null;

        const oversHistory = curInn.oversHistory || [];
        const balls = oversHistory.flatMap((over) =>
            (over.balls || []).map((ball) => ({
                ...ball,
                overNumber: over.overNumber,
                overBowler: over.bowler
            }))
        );

        const teamsPlayers = (selectedMatch?.teams || []).flatMap((team) => team.players || []);
        const statPlayers = [
            ...(curInn.batting || []).map((row) => row.player),
            ...(curInn.bowling || []).map((row) => row.player),
            curInn.currentBatsman1,
            curInn.currentBatsman2,
            curInn.onStrikeBatsman,
            curInn.currentBowler
        ];
        const ballPlayers = balls.flatMap((ball) => [
            ball.batsmanOnStrike,
            ball.batsmanNonStrike,
            ball.bowler,
            ball.dismissedPlayer,
            ball.fielder
        ]);
        const playerPool = uniqueById([
            ...allPlayers,
            ...battingXI,
            ...bowlingXI,
            ...teamsPlayers,
            ...statPlayers,
            ...ballPlayers
        ].filter(Boolean));

        const battingRows = [...(curInn.batting || [])];
        [curInn.currentBatsman1, curInn.currentBatsman2].filter(Boolean).forEach((player) => {
            const playerId = getId(player);
            const exists = battingRows.some((row) => getId(row.player) === playerId);
            if (!exists) {
                battingRows.push({
                    player,
                    runs: 0,
                    balls: 0,
                    fours: 0,
                    sixes: 0,
                    isOut: false
                });
            }
        });

        const batting = battingRows.map((row) => {
            const playerId = getId(row.player);
            const wicketBall = balls.find((ball) => {
                if (!ball.isWicket) return false;
                const dismissedId = getId(ball.dismissedPlayer) || getId(ball.batsmanOnStrike);
                return dismissedId === playerId;
            });
            const ballsFaced = Number(row.balls || 0);
            return {
                id: playerId,
                name: getPlayerName(row.player, playerPool),
                dismissal: getDismissalText(row, playerPool, wicketBall),
                isNotOut: !row.isOut && !row.isRetiredHurt && !row.isRetired,
                runs: Number(row.runs || 0),
                balls: ballsFaced,
                fours: Number(row.fours || 0),
                sixes: Number(row.sixes || 0),
                strikeRate: ballsFaced > 0 ? ((Number(row.runs || 0) / ballsFaced) * 100).toFixed(2) : "0.00"
            };
        });

        const extras = curInn.extras || {};
        const extrasTotal = Number(
            extras.total ?? ((extras.wides || 0) + (extras.noBalls || 0) + (extras.byes || 0) + (extras.legByes || 0) + (extras.penalties || 0))
        );

        const bowlingFromBalls = new Map();
        balls.forEach((ball) => {
            const bowlerId = getId(ball.bowler || ball.overBowler);
            if (!bowlerId) return;
            if (!bowlingFromBalls.has(bowlerId)) {
                bowlingFromBalls.set(bowlerId, {
                    player: ball.bowler || ball.overBowler,
                    balls: 0,
                    runs: 0,
                    wickets: 0,
                    dotBalls: 0,
                    wides: 0,
                    noBalls: 0,
                    maidens: 0,
                    wicketDetails: []
                });
            }
            const row = bowlingFromBalls.get(bowlerId);
            const legal = !ball.isWide && !ball.isNoBall;
            if (legal) row.balls += 1;
            row.runs += getBallRunsForBowler(ball);
            if (legal && Number(ball.runs || 0) === 0 && !ball.isBye && !ball.isLegBye) row.dotBalls += 1;
            if (ball.isWide) row.wides += 1;
            if (ball.isNoBall) row.noBalls += 1;
            const wicketType = (ball.wicketType || "").toLowerCase();
            if (ball.isWicket && !["run out", "retired hurt", "obstructing the field", "timed out", "handled ball"].includes(wicketType)) {
                row.wickets += 1;
                const dismissedId = getId(ball.dismissedPlayer) || getId(ball.batsmanOnStrike);
                const batterRow = battingRows.find((batter) => getId(batter.player) === dismissedId);
                const wicketBatter = batterRow || {
                    player: ball.dismissedPlayer || ball.batsmanOnStrike,
                    isOut: true,
                    dismissalType: ball.wicketType,
                    dismissedBy: ball.bowler,
                    fielder: ball.fielder
                };
                row.wicketDetails.push({
                    dismissedId,
                    batterName: getPlayerName(wicketBatter.player, playerPool, "Batter"),
                    dismissal: getDismissalText(wicketBatter, playerPool, ball),
                    over: `${ball.overNumber}.${ball.ballNumber || "?"}`,
                    wicketType: ball.wicketType || "wicket"
                });
            }
        });

        oversHistory.forEach((over) => {
            if ((over.balls || []).filter((ball) => !ball.isWide && !ball.isNoBall).length !== 6) return;
            if (Number(over.runsScored || 0) !== 0) return;
            const bowlerId = getId(over.bowler || over.balls?.[0]?.bowler);
            const row = bowlingFromBalls.get(bowlerId);
            if (row) row.maidens += 1;
        });

        const bowlingRows = (curInn.bowling && curInn.bowling.length > 0 ? curInn.bowling : Array.from(bowlingFromBalls.values()))
            .map((row) => {
                const fallback = bowlingFromBalls.get(getId(row.player)) || {};
                const ballsBowled = Number(row.balls ?? fallback.balls ?? 0);
                const runs = Number(row.runs ?? fallback.runs ?? 0);
                return {
                    id: getId(row.player),
                    name: getPlayerName(row.player, playerPool),
                    overs: formatOversFromBalls(ballsBowled),
                    maidens: Number(row.maidens ?? fallback.maidens ?? 0),
                    runs,
                    wickets: Number(row.wickets ?? fallback.wickets ?? 0),
                    economy: ballsBowled > 0 ? (runs / (ballsBowled / 6)).toFixed(2) : "0.00",
                    dotBalls: Number(row.dotBalls ?? fallback.dotBalls ?? 0),
                    wides: Number(row.wides ?? fallback.wides ?? 0),
                    noBalls: Number(row.noBalls ?? fallback.noBalls ?? 0),
                    wicketDetails: fallback.wicketDetails || []
                };
            });

        const battedIds = new Set(batting.map((row) => row.id));
        const yetToBat = battingXI.filter((player) => !battedIds.has(getId(player)));
        const fallOfWickets = curInn.fallOfWickets || [];
        const legalBalls = Number(curInn.balls || 0);
        const oversDisplay = formatOvers ? formatOvers(legalBalls) : formatOversFromBalls(legalBalls);
        const oversDecimal = legalBalls / 6;
        const runRate = oversDecimal > 0 ? (Number(curInn.runs || 0) / oversDecimal).toFixed(2) : "0.00";

        return {
            batting,
            bowling: bowlingRows,
            playerPool,
            extras,
            extrasTotal,
            yetToBat,
            fallOfWickets,
            oversDisplay,
            runRate
        };
    }, [curInn, battingXI, bowlingXI, allPlayers, formatOvers, selectedMatch]);

    if (!curInn || !scorecard) {
        return (
            <div className="text-center py-12 text-slate-500 italic text-sm">
                No innings data available.
            </div>
        );
    }

    return (
        <div className="bg-white text-slate-900 rounded-lg border border-slate-200 shadow-sm overflow-hidden animate-fadeIn">
            <div className="px-4 py-3 border-b border-slate-200 bg-white shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div>
                        <h3 className="text-xl sm:text-2xl font-black tracking-tight text-slate-950">
                            {battingTeamName}
                        </h3>
                        <p className="text-xs sm:text-sm text-slate-500 font-semibold mt-1">
                            {tossInfo || "Toss details unavailable."}
                        </p>
                    </div>
                    <div className="sm:text-right">
                        <div className="text-2xl sm:text-3xl font-black text-slate-950">
                            {curInn.runs || 0}/{curInn.wickets || 0}
                        </div>
                        <div className="text-xs font-bold text-slate-500">
                            ({scorecard.oversDisplay}/{selectedMatch?.totalOvers || 20} ov)
                        </div>
                    </div>
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left">
                    <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                            <th className="py-2.5 pl-4 text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Batting</th>
                            <th className="py-2.5 text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">&nbsp;</th>
                            <th className="py-3 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest">R</th>
                            <th className="py-3 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest">B</th>
                            <th className="py-3 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest">4s</th>
                            <th className="py-3 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest">6s</th>
                            <th className="py-3 pr-5 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest">SR</th>
                        </tr>
                    </thead>
                    <tbody>
                        {scorecard.batting.map((row, idx) => (
                            <tr key={`${row.id}-${idx}`} className={`${idx % 2 ? "bg-slate-50/40" : "bg-white"} ${row.isNotOut ? "border-l-2 border-l-blue-500" : "border-l-2 border-l-transparent"}`}>
                                <td className="py-3 pl-4 w-[23%]">
                                    <div className="font-black text-xs text-slate-950">{row.name}</div>
                                </td>
                                <td className="py-3 text-xs text-slate-500 w-[42%]">{row.dismissal}</td>
                                <td className="py-3 text-right font-black text-sm text-slate-950">{row.runs}</td>
                                <td className="py-3 text-right text-sm text-slate-600">{row.balls}</td>
                                <td className="py-3 text-right text-sm text-slate-600">{row.fours}</td>
                                <td className="py-3 text-right text-sm text-slate-600">{row.sixes}</td>
                                <td className="py-3 pr-5 text-right text-sm font-bold text-cric-accent">{row.strikeRate}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="grid grid-cols-[23%_1fr_auto] gap-4 items-center px-4 py-3 bg-white">
                <div className="text-xs font-black text-slate-950">Extras</div>
                <div>
                    <span className="ml-2 text-xs text-slate-500">
                        (w {scorecard.extras.wides || 0}, nb {scorecard.extras.noBalls || 0}, b {scorecard.extras.byes || 0}, lb {scorecard.extras.legByes || 0})
                    </span>
                </div>
                <div className="font-black text-sm text-slate-950">{scorecard.extrasTotal}</div>
            </div>

            <div className="grid grid-cols-[23%_1fr_auto] gap-4 items-center px-4 py-3 bg-slate-100 border-y border-slate-200">
                <div className="text-sm font-black text-slate-950">Total</div>
                <div className="text-sm font-black text-slate-950">
                    {scorecard.oversDisplay} Ov (RR: {scorecard.runRate})
                </div>
                <div className="text-sm font-black text-slate-950">{curInn.runs || 0}/{curInn.wickets || 0}</div>
            </div>

            <div className="px-4 py-3 border-b border-slate-200">
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-2">Yet To Bat</div>
                <div className="text-sm font-semibold leading-relaxed text-slate-800">
                    {scorecard.yetToBat.length > 0
                        ? scorecard.yetToBat.map((player) => getPlayerName(player, scorecard.playerPool)).join(", ")
                        : "None"}
                </div>
            </div>

            <div className="px-4 py-3 border-b border-slate-200">
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-2">Fall Of Wickets</div>
                <div className="text-sm font-semibold leading-relaxed text-slate-800">
                    {scorecard.fallOfWickets.length > 0
                        ? scorecard.fallOfWickets.map((wicket) => {
                            const name = getPlayerName(wicket.player, scorecard.playerPool, "Player");
                            return `${wicket.wickets}-${wicket.runs} (${name}, ${formatDecimalOvers(wicket.overs)})`;
                        }).join(", ")
                        : "No wickets"}
                </div>
            </div>

            <div>
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-left">
                        <thead className="bg-slate-50 border-y border-slate-200">
                            <tr>
                                <th className="py-2.5 pl-4 text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Bowling</th>
                                <th className="py-3 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest">O</th>
                                <th className="py-3 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest">M</th>
                                <th className="py-3 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest">R</th>
                                <th className="py-3 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest">W</th>
                                <th className="py-3 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest">ECON</th>
                                <th className="py-3 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest">0S</th>
                                <th className="py-3 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest">WD</th>
                                <th className="py-3 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest">NB</th>
                                <th className="py-3 pr-4 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest">&nbsp;</th>
                            </tr>
                        </thead>
                        <tbody>
                            {scorecard.bowling.map((row, idx) => {
                                const isExpanded = expandedBowlerId === row.id;
                                const hasWicketDetails = row.wicketDetails.length > 0;

                                return (
                                    <React.Fragment key={`${row.id}-${idx}`}>
                                        <tr className={`${idx % 2 ? "bg-slate-50/40" : "bg-white"} border-b border-slate-100`}>
                                            <td className="py-3 pl-4 font-black text-xs text-slate-950">{row.name}</td>
                                            <td className="py-3 text-right font-bold text-sm text-slate-800">{row.overs}</td>
                                            <td className="py-3 text-right text-sm text-slate-600">{row.maidens}</td>
                                            <td className="py-3 text-right text-sm text-slate-600">{row.runs}</td>
                                            <td className="py-3 text-right font-black text-sm text-slate-950">{row.wickets}</td>
                                            <td className="py-3 text-right text-sm text-slate-600">{row.economy}</td>
                                            <td className="py-3 text-right text-sm text-slate-600">{row.dotBalls}</td>
                                            <td className="py-3 text-right text-sm text-slate-600">{row.wides}</td>
                                            <td className="py-3 text-right text-sm text-slate-600">{row.noBalls}</td>
                                            <td className="py-3 pr-4 text-right font-black text-sm">
                                                {row.wickets > 0 && (
                                                    <button
                                                        type="button"
                                                        onClick={() => hasWicketDetails && setExpandedBowlerId(isExpanded ? "" : row.id)}
                                                        className={`inline-flex h-7 w-7 items-center justify-center rounded-full font-black ${hasWicketDetails ? "text-cric-accent hover:bg-orange-50 hover:text-orange-700 cursor-pointer" : "text-cric-accent cursor-default"}`}
                                                        title={hasWicketDetails ? "Show wicket details" : "Wicket details unavailable"}
                                                    >
                                                        {isExpanded ? "↑" : "↓"}
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                        {isExpanded && hasWicketDetails && (
                                            <tr className="bg-orange-50/70 border-b border-orange-100">
                                                <td colSpan="10" className="px-4 py-3">
                                                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-700 mb-2">
                                                        Wicket Details
                                                    </div>
                                                    <div className="space-y-1">
                                                        {row.wicketDetails.map((detail, detailIdx) => (
                                                            <div key={`${detail.dismissedId}-${detailIdx}`} className="text-xs sm:text-sm text-slate-700">
                                                                <span className="font-black text-slate-950">{detail.batterName}</span>
                                                                <span className="text-slate-500"> at {detail.over} ov, </span>
                                                                <span className="font-semibold">{detail.dismissal}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="px-4 py-4 bg-white border-t border-slate-200">
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-2">
                    {bowlingTeamName} Playing XI
                </div>
                <div className="text-sm font-semibold leading-relaxed text-slate-800">
                    {bowlingXI.length > 0
                        ? bowlingXI.map((player) => getPlayerName(player, scorecard.playerPool)).join(", ")
                        : "Not available"}
                </div>
            </div>
        </div>
    );
}
