import React, { useCallback, useRef, useState } from "react";
import { SHOTS } from "../data/shotsData";

const SVG_W = 420;
const SVG_H = 720;
const PITCH_X = 155;
const PITCH_Y = 42;
const PITCH_W = 110;
const PITCH_H = 602;

const LINE_ZONES = [
    { id: "wide_outside_off", label: "Wide Outside Off", xMin: 0, xMax: 0.10 },
    { id: "outside_off", label: "Outside Off", xMin: 0.10, xMax: 0.25 },
    { id: "off_stump", label: "Off Stump", xMin: 0.25, xMax: 0.40 },
    { id: "middle_stump", label: "Middle Stump", xMin: 0.40, xMax: 0.60 },
    { id: "leg_stump", label: "Leg Stump", xMin: 0.60, xMax: 0.75 },
    { id: "outside_leg", label: "Outside Leg", xMin: 0.75, xMax: 0.90 },
    { id: "wide_outside_leg", label: "Wide Outside Leg", xMin: 0.90, xMax: 1.0 },
];

const LENGTH_ZONES = [
    { id: "full_toss",   label: "Full toss", yMin: 0,    yMax: 0.08, dist: "0m"      },
    { id: "yorker",      label: "Yorker",    yMin: 0.08, yMax: 0.20, dist: "2m"      },
    { id: "full",        label: "Full",      yMin: 0.20, yMax: 0.40, dist: "4m"      },
    { id: "good_length", label: "Good",      yMin: 0.40, yMax: 0.58, dist: "6m"      },
    { id: "hard_length", label: "Hard",      yMin: 0.58, yMax: 0.75, dist: "8m"      },
    { id: "bouncer",     label: "Bouncer",   yMin: 0.75, yMax: 1.0,  dist: "Halfway" },
];

const SHOT_TYPES = [
    "Straight Drive", "Cover Drive", "Off Drive", "On Drive", "Square Drive", "Front Foot Defence",
    "Square Cut", "Late Cut", "Back Foot Punch", "Pull", "Hook", "Back Foot Defence",
    "Flick Shot", "Leg Glance", "Sweep Shot", "Paddle Sweep", "Slog Sweep",
    "Reverse Sweep", "Switch Hit", "Scoop Shot", "Ramp Shot", "Upper Cut", "Helicopter Shot", "Dil Scoop",
    "Lofted Drive", "Inside Out Shot", "Slog", "Chip Shot",
    "Defended", "Left / Padded Away", "Missed / Beaten", "Edged", "No Shot Offered"
];

const shotToId = (shot) => shot.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const shotLabel = (shotId) => SHOTS.find(shot => shot.id === shotId)?.name || SHOT_TYPES.find(shot => shotToId(shot) === shotId) || shotId;

function getDotColor(outcome) {
    if (outcome.wicket) return "#f71963";
    if (outcome.runs === 6) return "#4b5563";
    if (outcome.runs === 4) return "#6b7280";
    if (outcome.runs >= 1) return "#a8adb7";
    return "#f4f4f5";
}

function getDotStroke(outcome) {
    if (outcome.wicket) return "#f71963";
    if (outcome.runs === 6) return "#111827";
    if (outcome.runs === 4) return "#374151";
    return "#e5e7eb";
}

function lineToX(lineId) {
    const zone = LINE_ZONES.find(z => z.id === lineId);
    if (!zone) return PITCH_X + PITCH_W / 2;
    return PITCH_X + ((zone.xMin + zone.xMax) / 2) * PITCH_W;
}

function lengthToY(lengthId) {
    const zone = LENGTH_ZONES.find(z => z.id === lengthId);
    if (!zone) return PITCH_Y + PITCH_H / 2;
    return PITCH_Y + ((zone.yMin + zone.yMax) / 2) * PITCH_H;
}

function xToLine(px) {
    const rel = (px - PITCH_X) / PITCH_W;
    for (const zone of LINE_ZONES) {
        if (rel >= zone.xMin && rel <= zone.xMax) return zone.id;
    }
    return rel < 0.5 ? "wide_outside_off" : "wide_outside_leg";
}

function yToLength(py) {
    const rel = (py - PITCH_Y) / PITCH_H;
    for (const zone of LENGTH_ZONES) {
        if (rel >= zone.yMin && rel <= zone.yMax) return zone.id;
    }
    return rel < 0.5 ? "full_toss" : "bouncer";
}

export default React.memo(function PitchMap({
    balls = [],
    currentOver = 0,
    bowlerName = "",
    batsmanName = "",
    viewMode = "this_over",
    selectedLine: controlledLine,
    onLineChange,
    selectedLength: controlledLength,
    onLengthChange,
    selectedShot: controlledShot,
    onShotChange,
    clickPosition: controlledClickPos,
    onClickPositionChange,
}) {
    const svgRef = useRef(null);
    const [internalLine, setInternalLine] = useState("");
    const [internalLength, setInternalLength] = useState("");
    const [internalShot, setInternalShot] = useState("");
    const [internalClickPos, setInternalClickPos] = useState(null);
    const [hoverPos, setHoverPos] = useState(null);
    const [ripple, setRipple] = useState(null);

    const selectedLine = controlledLine ?? internalLine;
    const selectedLength = controlledLength ?? internalLength;
    const selectedShot = controlledShot ?? internalShot;
    const clickPos = controlledClickPos ?? internalClickPos;

    const updateLine = (value) => {
        setInternalLine(value);
        onLineChange?.(value);
    };

    const updateLength = (value) => {
        setInternalLength(value);
        onLengthChange?.(value);
    };

    const updateShot = (value) => {
        setInternalShot(value);
        onShotChange?.(value);
    };

    const updateClickPos = (value) => {
        setInternalClickPos(value);
        onClickPositionChange?.(value);
    };

    const handlePitchClick = useCallback((event) => {
        const svg = svgRef.current;
        if (!svg) return;
        const rect = svg.getBoundingClientRect();
        const sx = (event.clientX - rect.left) * (SVG_W / rect.width);
        const sy = (event.clientY - rect.top) * (SVG_H / rect.height);
        const cx = Math.max(PITCH_X, Math.min(PITCH_X + PITCH_W, sx));
        const cy = Math.max(PITCH_Y, Math.min(PITCH_Y + PITCH_H, sy));

        updateClickPos({ x: cx, y: cy });
        updateLine(xToLine(cx));
        updateLength(yToLength(cy));
        setRipple({ x: cx, y: cy, key: Date.now() });
        setTimeout(() => setRipple(null), 500);
    }, []);

    const handleMouseMove = useCallback((event) => {
        const svg = svgRef.current;
        if (!svg) return;
        const rect = svg.getBoundingClientRect();
        const sx = (event.clientX - rect.left) * (SVG_W / rect.width);
        const sy = (event.clientY - rect.top) * (SVG_H / rect.height);
        if (sx >= PITCH_X && sx <= PITCH_X + PITCH_W && sy >= PITCH_Y && sy <= PITCH_Y + PITCH_H) {
            setHoverPos({ x: sx, y: sy, line: xToLine(sx), length: yToLength(sy) });
        } else {
            setHoverPos(null);
        }
    }, []);

    const handleLineChange = (value) => {
        updateLine(value);
        if (value && selectedLength) updateClickPos({ x: lineToX(value), y: lengthToY(selectedLength) });
    };

    const handleLengthChange = (value) => {
        updateLength(value);
        if (selectedLine && value) updateClickPos({ x: lineToX(selectedLine), y: lengthToY(value) });
    };

    const displayBalls = viewMode === "this_over"
        ? balls.filter(ball => parseInt(String(ball.ballId).split(".")[0], 10) === currentOver)
        : balls;

    const hoverLineLabel = hoverPos ? LINE_ZONES.find(z => z.id === hoverPos.line)?.label : "";
    const hoverLengthLabel = hoverPos ? LENGTH_ZONES.find(z => z.id === hoverPos.length)?.label : "";

    return (
        <div className="flex flex-col gap-2.5 max-w-[160px] w-full">
            <div className="flex items-baseline gap-2 px-0.5">
                <h4 className="text-[10px] font-black tracking-[0.25em] uppercase text-[#ff6b35] m-0">Pitch Map</h4>
                <span className="text-[9px] font-bold tracking-[0.15em] uppercase text-slate-500">{bowlerName && batsmanName ? `${bowlerName} to ${batsmanName}` : "Bowling Length Map"}</span>
            </div>

            <div className="relative flex items-stretch w-full justify-center">
                <svg
                    ref={svgRef}
                    viewBox={`0 0 ${SVG_W} ${SVG_H}`}
                    className="flex-1 cursor-crosshair select-none rounded-xl overflow-hidden max-h-[380px] min-h-[260px] w-full aspect-[16/32]"
                    onClick={handlePitchClick}
                    onMouseMove={handleMouseMove}
                    onMouseLeave={() => setHoverPos(null)}
                >
                    <defs>
                        <filter id="pm-dot-shadow">
                            <feDropShadow dx="0" dy="2" stdDeviation="2" floodOpacity="0.22" />
                        </filter>
                        <style>{`
                            @keyframes pm-pulse { 0%,100% { opacity: 0.95; } 50% { opacity: 0.7; } }
                            @keyframes pm-ring-pulse { 0%,100% { opacity: 0.4; } 50% { opacity: 0.15; } }
                            .pm-active-dot { animation: pm-pulse 1.5s ease-in-out infinite; }
                            .pm-active-ring { animation: pm-ring-pulse 1.5s ease-in-out infinite; }
                            .pm-ripple { pointer-events: none; }
                        `}</style>
                    </defs>

                    <rect x="0" y="0" width={SVG_W} height={SVG_H} rx="8" fill="#2c7a17" />

                    <rect x={PITCH_X} y={PITCH_Y} width={PITCH_W} height={PITCH_H} fill="#ffd333" />
                    <rect x={PITCH_X + PITCH_W * 0.41} y={PITCH_Y} width={PITCH_W * 0.18} height={PITCH_H} fill="#f3c927" />
                    <rect x={PITCH_X} y={PITCH_Y} width={PITCH_W * 0.065} height={PITCH_H} fill="#ffe35c" />
                    <rect x={PITCH_X + PITCH_W * 0.935} y={PITCH_Y} width={PITCH_W * 0.065} height={PITCH_H} fill="#ffe35c" />

                    {LENGTH_ZONES.slice(1).map(zone => {
                        const y = PITCH_Y + zone.yMin * PITCH_H;
                        return (
                            <line key={zone.id} x1={0} y1={y} x2={PITCH_X} y2={y}
                                stroke="rgba(255,255,255,0.88)" strokeWidth="1.4" />
                        );
                    })}

                    {LENGTH_ZONES.map(zone => {
                        const centerY = PITCH_Y + ((zone.yMin + zone.yMax) / 2) * PITCH_H;
                        const boundaryY = PITCH_Y + zone.yMin * PITCH_H;
                        return (
                            <g key={zone.id}>
                                <text x={PITCH_X - 40} y={centerY + 8} textAnchor="end"
                                    fill="#f8fafc" fontSize="16" fontWeight="800" fontFamily="Inter, sans-serif">
                                    {zone.label}
                                </text>
                                <line x1={PITCH_X + PITCH_W} y1={boundaryY} x2={PITCH_X + PITCH_W + 30} y2={boundaryY}
                                    stroke="#f8fafc" strokeWidth="1.8" />
                                <text x={PITCH_X + PITCH_W + 36} y={boundaryY + 8}
                                    fill="#f8fafc" fontSize="15" fontWeight="700" fontFamily="Inter, sans-serif">
                                    {zone.dist}
                                </text>
                            </g>
                        );
                    })}

                    <line x1={PITCH_X + 8} y1={PITCH_Y + 50} x2={PITCH_X + PITCH_W - 8} y2={PITCH_Y + 50}
                        stroke="white" strokeWidth="2.6" />
                    <line x1={PITCH_X - 14} y1={PITCH_Y + 112} x2={PITCH_X + PITCH_W + 14} y2={PITCH_Y + 112}
                        stroke="white" strokeWidth="4" />
                    {/* 3 stump lines */}
                    {[-10, 0, 10].map((offset, i) => (
                        <line key={i}
                            x1={PITCH_X + PITCH_W / 2 + offset} y1={PITCH_Y + 8}
                            x2={PITCH_X + PITCH_W / 2 + offset} y2={PITCH_Y + 42}
                            stroke="white" strokeWidth="3.5" strokeLinecap="round"
                        />
                    ))}
                    {/* Bail across top */}
                    <line
                        x1={PITCH_X + PITCH_W / 2 - 14} y1={PITCH_Y + 8}
                        x2={PITCH_X + PITCH_W / 2 + 14} y2={PITCH_Y + 8}
                        stroke="white" strokeWidth="2"
                    />

                    {hoverPos && (
                        <g>
                            <line x1={hoverPos.x} y1={PITCH_Y} x2={hoverPos.x} y2={PITCH_Y + PITCH_H}
                                stroke="rgba(255,255,255,0.45)" strokeWidth="0.8" />
                            <line x1={PITCH_X} y1={hoverPos.y} x2={PITCH_X + PITCH_W} y2={hoverPos.y}
                                stroke="rgba(255,255,255,0.55)" strokeWidth="0.8" />
                        </g>
                    )}

                    {displayBalls.map((ball, index) => {
                        const bx = ball.pitchX != null ? PITCH_X + (ball.pitchX / 100) * PITCH_W : lineToX(ball.line);
                        const by = ball.pitchY != null ? PITCH_Y + (ball.pitchY / 100) * PITCH_H : lengthToY(ball.length);
                        const outcome = ball.outcome || { runs: ball.runs || 0, wicket: ball.isWicket };
                        return (
                            <circle key={ball.ballId || index} cx={bx} cy={by} r="7"
                                fill={getDotColor(outcome)} stroke={getDotStroke(outcome)} strokeWidth="1.5"
                                filter="url(#pm-dot-shadow)" />
                        );
                    })}

                    {clickPos && (
                        <g>
                            <circle cx={clickPos.x} cy={clickPos.y} r="8"
                                fill="#f71963" stroke="white" strokeWidth="2" className="pm-active-dot" />
                            <circle cx={clickPos.x} cy={clickPos.y} r="14"
                                fill="none" stroke="#f71963" strokeWidth="1.5" opacity="0.4" className="pm-active-ring" />
                        </g>
                    )}

                    {ripple && (
                        <circle key={ripple.key} cx={ripple.x} cy={ripple.y} r="5"
                            fill="rgba(247,25,99,0.45)" className="pm-ripple">
                            <animate attributeName="r" from="5" to="28" dur="0.45s" fill="freeze" />
                            <animate attributeName="opacity" from="0.45" to="0" dur="0.45s" fill="freeze" />
                        </circle>
                    )}
                </svg>
            </div>

            {hoverPos && (
                <div className="text-center text-[9px] font-black uppercase tracking-[0.15em] text-[#ff6b35] px-3 py-1 bg-black/30 rounded-full self-center border border-[#ff6b35]/20">
                    {hoverLengthLabel} | {hoverLineLabel}
                </div>
            )}

            <div className="flex flex-wrap gap-3 justify-center pt-2.5 pb-1">
                {[
                    { color: "#f4f4f5", border: "#e5e7eb", label: "0" },
                    { color: "#a8adb7", border: "#e5e7eb", label: "1+" },
                    { color: "#6b7280", border: "#374151", label: "4" },
                    { color: "#4b5563", border: "#111827", label: "6" },
                    { color: "#f71963", border: "#f71963", label: "W" },
                ].map(item => (
                    <div key={item.label} className="flex items-center gap-1">
                        <span className="w-4 h-4 rounded-full border-[1.5px] shrink-0" style={{ background: item.color, borderColor: item.border }} />
                        <span className="text-[13px] font-black uppercase tracking-[0.1em] text-slate-400">{item.label}</span>
                    </div>
                ))}
            </div>

            {(selectedLine || selectedLength || selectedShot) && (
                <div className="bg-black/15 border border-white/5 rounded-2xl px-3 py-2">
                    <div className="flex flex-wrap gap-1.5 items-center">
                        {selectedLine && <span className="text-[9px] font-black uppercase tracking-[0.1em] px-2.5 py-[3px] rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/20">{LINE_ZONES.find(z => z.id === selectedLine)?.label}</span>}
                        {selectedLength && <span className="text-[9px] font-black uppercase tracking-[0.1em] px-2.5 py-[3px] rounded-full bg-green-500/15 text-green-400 border border-green-500/20">{LENGTH_ZONES.find(z => z.id === selectedLength)?.label}</span>}
                        {selectedShot && <span className="text-[9px] font-black uppercase tracking-[0.1em] px-2.5 py-[3px] rounded-full bg-[#ff6b35]/15 text-[#ff6b35] border border-[#ff6b35]/20">{shotLabel(selectedShot)}</span>}
                    </div>
                </div>
            )}
        </div>
    );
});

export { LINE_ZONES, LENGTH_ZONES, SHOT_TYPES, getDotColor, lineToX, lengthToY };
