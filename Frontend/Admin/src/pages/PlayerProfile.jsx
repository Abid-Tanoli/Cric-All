import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../services/api";
import BattingPositionBadge from "@shared/components/BattingPositionBadge";

const ROLE_COLORS = {
    Batsman: "bg-blue-100 text-blue-700 border-blue-300",
    Bowler: "bg-green-100 text-green-700 border-green-300",
    "All-Rounder": "bg-purple-100 text-purple-700 border-purple-300",
    "Batting-All-Rounder": "bg-cyan-100 text-cyan-700 border-cyan-300",
    "Bowling-All-Rounder": "bg-lime-100 text-lime-700 border-lime-300",
    "Wicket-Keeper": "bg-orange-100 text-orange-700 border-orange-300",
};

const ROLE_EMOJI = {
    Batsman: "🏏",
    Bowler: "⚾",
    "All-Rounder": "🎯",
    "Batting-All-Rounder": "🏏⚾",
    "Bowling-All-Rounder": "⚾🏏",
    "Wicket-Keeper": "🥅",
};

export default function PlayerProfile() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [player, setPlayer] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchPlayer();
    }, [id]);

    const fetchPlayer = async () => {
        try {
            const res = await api.get(`/players/${id}`);
            setPlayer(res.data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50 p-6 lg:p-10 flex items-center justify-center">
                <div className="text-center">
                    <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent"></div>
                    <p className="mt-4 text-xs font-black text-slate-400 uppercase tracking-widest">
                        Loading player...
                    </p>
                </div>
            </div>
        );
    }

    if (!player) {
        return (
            <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50 p-6 lg:p-10 flex items-center justify-center">
                <p className="text-xl font-black text-slate-400">Player not found</p>
            </div>
        );
    }

    const bgColor = ROLE_COLORS[player.playingRole] || "bg-slate-100";
    const roleEmoji = ROLE_EMOJI[player.playingRole] || "👤";
    const battingStats = player.stats || {};
    const bowlingStats = player.stats || {};

    return (
        <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50 p-6 lg:p-10">
            {/* Back Button */}
            <button
                onClick={() => navigate(-1)}
                className="mb-6 flex items-center gap-2 text-blue-600 hover:text-blue-800 font-bold transition-colors"
            >
                ← Back to Players
            </button>

            {/* Header */}
            <div className={`${bgColor} rounded-2xl shadow-xl p-8 mb-8 border-2`}>
                <div className="flex flex-col md:flex-row items-center gap-6">
                    {player.imageUrl ? (
                        <img
                            src={player.imageUrl}
                            alt={player.name}
                            className="w-32 h-32 rounded-full object-cover border-4 border-white shadow-lg"
                        />
                    ) : (
                        <div className="w-32 h-32 rounded-full bg-white/20 flex items-center justify-center text-5xl shadow-lg">
                            {roleEmoji}
                        </div>
                    )}
                    <div className="text-center md:text-left">
                        <h1 className="text-4xl font-black text-[#031d44]">{player.name}</h1>
                        <p className="mt-1 flex items-center justify-center gap-2 text-lg font-bold text-slate-600 md:justify-start">
                            <span>{roleEmoji} {player.playingRole}</span>
                            <BattingPositionBadge value={player.battingPosition} />
                        </p>
                        <p className="text-sm text-slate-500 mt-1">
                            {player.battingStyle} • {player.bowlingStyle}
                        </p>
                    </div>
                </div>
            </div>

            {/* Info Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                <div className="bg-white rounded-xl shadow-lg p-4 text-center border border-slate-100">
                    <p className="text-xs font-black uppercase tracking-widest text-slate-400">Team</p>
                    <p className="text-lg font-black text-[#031d44] mt-1">
                        {player.team?.name || "Unassigned"}
                    </p>
                </div>
                <div className="bg-white rounded-xl shadow-lg p-4 text-center border border-slate-100">
                    <p className="text-xs font-black uppercase tracking-widest text-slate-400">Campus</p>
                    <p className="text-lg font-black text-[#031d44] mt-1">{player.Campus || "-"}</p>
                </div>
                <div className="bg-white rounded-xl shadow-lg p-4 text-center border border-slate-100">
                    <p className="text-xs font-black uppercase tracking-widest text-slate-400">Matches</p>
                    <p className="text-lg font-black text-[#031d44] mt-1">{battingStats.matches || 0}</p>
                </div>
                <div className="bg-white rounded-xl shadow-lg p-4 text-center border border-slate-100">
                    <p className="text-xs font-black uppercase tracking-widest text-slate-400">Average</p>
                    <p className="text-lg font-black text-[#031d44] mt-1">
                        {(battingStats.average || 0).toFixed(1)}
                    </p>
                </div>
            </div>

            {/* Batting Stats */}
            <div className="bg-white rounded-2xl shadow-xl border border-slate-100 p-6 mb-8">
                <h2 className="text-xl font-black text-[#031d44] mb-4">🏏 BATTING STATISTICS</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
                    {[
                        { label: "Runs", value: battingStats.runs || 0 },
                        { label: "Innings", value: battingStats.innings || 0 },
                        { label: "Average", value: (battingStats.average || 0).toFixed(2) },
                        { label: "Strike Rate", value: (battingStats.strikeRate || 0).toFixed(2) },
                        { label: "High Score", value: battingStats.highScore || 0 },
                        { label: "Not Outs", value: battingStats.notOuts || 0 },
                        { label: "50s / 100s", value: `${battingStats.fifties || 0} / ${battingStats.hundreds || 0}` },
                    ].map((stat) => (
                        <div key={stat.label} className="text-center p-4 bg-slate-50 rounded-xl">
                            <p className="text-2xl font-black text-[#031d44]">{stat.value}</p>
                            <p className="text-slate-500 text-xs font-bold uppercase mt-1">{stat.label}</p>
                        </div>
                    ))}
                </div>
            </div>

            {/* Bowling Stats */}
            <div className="bg-white rounded-2xl shadow-xl border border-slate-100 p-6 mb-8">
                <h2 className="text-xl font-black text-[#031d44] mb-4">⚾ BOWLING STATISTICS</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
                    {[
                        { label: "Wickets", value: bowlingStats.wickets || 0 },
                        { label: "Economy", value: (bowlingStats.economy || 0).toFixed(2) },
                        { label: "Avg", value: (bowlingStats.bowlingAverage || 0).toFixed(2) },
                        { label: "Best", value: bowlingStats.bestBowling || "-" },
                        { label: "Dot Balls", value: bowlingStats.dotBalls || 0 },
                        { label: "4 Wickets", value: bowlingStats.fourWickets || 0 },
                        { label: "5 Wickets", value: bowlingStats.fiveWickets || 0 },
                    ].map((stat) => (
                        <div key={stat.label} className="text-center p-4 bg-slate-50 rounded-xl">
                            <p className="text-2xl font-black text-[#031d44]">{stat.value}</p>
                            <p className="text-slate-500 text-xs font-bold uppercase mt-1">{stat.label}</p>
                        </div>
                    ))}
                </div>
            </div>

            {/* Playing Profile */}
            <div className="bg-white rounded-2xl shadow-xl border border-slate-100 p-6">
                <h2 className="text-xl font-black text-[#031d44] mb-4">📋 PLAYING PROFILE</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl">
                        <span className="text-3xl">🤜</span>
                        <div>
                            <p className="text-xs font-black uppercase tracking-widest text-slate-400">Batting Stance</p>
                            <p className="font-bold text-slate-800">{player.battingStyle}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl">
                        <span className="text-3xl">⚾</span>
                        <div>
                            <p className="text-xs font-black uppercase tracking-widest text-slate-400">Bowling Arm</p>
                            <p className="font-bold text-slate-800">{player.bowlingStyle}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl">
                        <span className="text-3xl">{roleEmoji}</span>
                        <div>
                            <p className="text-xs font-black uppercase tracking-widest text-slate-400">Playing Role</p>
                            <p className="font-bold text-slate-800">{player.playingRole}</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
