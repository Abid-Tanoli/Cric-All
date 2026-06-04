import React, { useRef, useState } from "react";
import { zoneToHyphen } from "./ScoreManagement/constants";

const GW = 400;
const GH = 400;
const CX = 200;
const CY = 200;
const STRIKER_Y = 182;
const NON_STRIKER_Y = 224;
const BOWLER_Y = 306;
const BOUNDARY_RADIUS = 185;
const INNER_CIRCLE_RADIUS = 96;
const CLOSE_INFIELD_RADIUS = 48;

const FIELD_POSITIONS = [
    { id: "long_stop", name: "Long stop", x: 200, y: 32, type: "out" },
    { id: "straight_top", name: "Straight", x: 238, y: 44, type: "out" },
    { id: "long_leg", name: "Long leg", x: 306, y: 48, type: "out" },
    { id: "deep_fine_leg", name: "Deep fine leg", x: 344, y: 78, type: "out" },
    { id: "deep_third_man", name: "Deep third man", x: 78, y: 76, type: "out" },
    { id: "third_man", name: "Third man", x: 122, y: 94, type: "ring" },
    { id: "fine_leg", name: "Fine leg", x: 278, y: 94, type: "ring" },
    { id: "deep_backward_point", name: "Deep backward", x: 42, y: 146, type: "out" },
    { id: "deep_square_leg", name: "Deep square", x: 370, y: 158, type: "out" },
    { id: "wicket_keeper", name: "WK", x: 200, y: 160, type: "keeper" },
    { id: "slip_1", name: "1", x: 182, y: 154, type: "close" },
    { id: "slip_2", name: "2", x: 170, y: 151, type: "close" },
    { id: "slip_3", name: "3", x: 158, y: 150, type: "close" },
    { id: "gully", name: "Gully", x: 132, y: 174, type: "ring" },
    { id: "leg_slip", name: "Leg slip", x: 224, y: 164, type: "close" },
    { id: "short_leg", name: "Short leg", x: 238, y: 184, type: "close" },
    { id: "silly_point", name: "Silly point", x: 156, y: 194, type: "close" },
    { id: "point", name: "Point", x: 92, y: 204, type: "ring" },
    { id: "backward_square_leg", name: "Backward square leg", x: 288, y: 164, type: "ring" },
    { id: "square_leg", name: "Square leg", x: 304, y: 204, type: "ring" },
    { id: "cover_point", name: "Cover point", x: 116, y: 236, type: "ring" },
    { id: "cover", name: "Cover", x: 132, y: 264, type: "ring" },
    { id: "extra_cover", name: "Extra cover", x: 154, y: 292, type: "ring" },
    { id: "silly_mid_off", name: "Silly mid-off", x: 178, y: 218, type: "close" },
    { id: "silly_mid_on", name: "Silly mid-on", x: 222, y: 218, type: "close" },
    { id: "mid_off", name: "Mid-off", x: 174, y: 318, type: "ring" },
    { id: "mid_on", name: "Mid-on", x: 226, y: 318, type: "ring" },
    { id: "mid_wicket", name: "Mid-wicket", x: 270, y: 276, type: "ring" },
    { id: "deep_point", name: "Deep point", x: 28, y: 206, type: "out" },
    { id: "deep_cover", name: "Deep cover", x: 36, y: 270, type: "out" },
    { id: "deep_extra_cover", name: "Deep extra cover", x: 58, y: 324, type: "out" },
    { id: "long_off", name: "Long off", x: 114, y: 360, type: "out" },
    { id: "straight_bottom_off", name: "Straight", x: 160, y: 374, type: "out" },
    { id: "straight_bottom_on", name: "Straight", x: 240, y: 374, type: "out" },
    { id: "long_on", name: "Long on", x: 286, y: 360, type: "out" },
    { id: "deep_mid_wicket", name: "Deep mid-wicket", x: 360, y: 258, type: "out" },
    { id: "deep_forward_square", name: "Deep forward", x: 350, y: 304, type: "out" },
];

const FIELD_LABEL_OFFSETS = {
    wicket_keeper: { dx: 0, dy: -13 },
    slip_1: { dx: -2, dy: -12 },
    slip_2: { dx: -8, dy: -12 },
    slip_3: { dx: -16, dy: -12 },
    leg_slip: { dx: 16, dy: -10 },
    short_leg: { dx: 22, dy: -2 },
    silly_point: { dx: -24, dy: -2 },
    silly_mid_off: { dx: -28, dy: 7 },
    silly_mid_on: { dx: 30, dy: 7 },
    mid_off: { dx: -18, dy: 16 },
    mid_on: { dx: 18, dy: 16 },
    straight_bottom_off: { dx: -10, dy: 15 },
    straight_bottom_on: { dx: 12, dy: 15 },
};

function getZoneStyle(zone) {
    switch (zone) {
        case "over_boundary": return { color: "#a855f7", label: "Over Boundary", bg: "rgba(168,85,247,0.15)" };
        case "outfield": return { color: "#3b82f6", label: "Outfield", bg: "rgba(59,130,246,0.12)" };
        case "inner_ring": return { color: "#22c55e", label: "Inner Ring", bg: "rgba(34,197,94,0.08)" };
        default: return { color: "#ff6b35", label: "Infield", bg: "rgba(255,107,53,0.08)" };
    }
}

function getShotName(angleDeg, side) {
    if (angleDeg >= 337.5 || angleDeg < 22.5) return "Straight";
    if (angleDeg < 67.5) return side === "off side" ? "Third man / Gully" : "Fine leg";
    if (angleDeg < 112.5) return side === "off side" ? "Point" : "Square leg";
    if (angleDeg < 157.5) return side === "off side" ? "Cover" : "Mid-wicket";
    if (angleDeg < 202.5) return side === "off side" ? "Mid-off" : "Mid-on";
    if (angleDeg < 247.5) return side === "off side" ? "Long off" : "Long on";
    if (angleDeg < 292.5) return side === "off side" ? "Deep cover" : "Deep mid-wicket";
    return side === "off side" ? "Deep third" : "Deep fine leg";
}

function detectShot(clickX, clickY) {
    const dx = clickX - CX;
    const dy = STRIKER_Y - clickY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const angleRad = Math.atan2(dx, -dy);
    const angleDeg = (angleRad * 180 / Math.PI + 360) % 360;
    const side = dx < 0 ? "off side" : "leg side";

    let zone = "close_infield";
    if (distance > BOUNDARY_RADIUS) zone = "over_boundary";
    else if (distance > INNER_CIRCLE_RADIUS) zone = "outfield";
    else if (distance > CLOSE_INFIELD_RADIUS) zone = "inner_ring";

    let nearestPos = null;
    let nearestDist = Infinity;
    FIELD_POSITIONS.forEach(pos => {
        const pd = Math.sqrt((clickX - pos.x) ** 2 + (clickY - pos.y) ** 2);
        if (pd < nearestDist) {
            nearestDist = pd;
            nearestPos = pos;
        }
    });

    return {
        distance,
        angleDeg,
        zone,
        shotType: "running",
        direction: nearestPos?.name || "",
        side,
        nearestPos,
        shotName: getShotName(angleDeg, side)
    };
}

export default function CricketGround({ onShotSelect, activeZone }) {
    const svgRef = useRef(null);
    const [hoverInfo, setHoverInfo] = useState(null);
    const [clickEffect, setClickEffect] = useState(null);

    const readPoint = (event) => {
        const svg = svgRef.current;
        if (!svg) return null;
        const rect = svg.getBoundingClientRect();
        return {
            x: (event.clientX - rect.left) * (GW / rect.width),
            y: (event.clientY - rect.top) * (GH / rect.height)
        };
    };

    const handleClick = (event) => {
        const point = readPoint(event);
        if (!point) return;
        const info = detectShot(point.x, point.y);
        setClickEffect({ x: point.x, y: point.y, zone: info.zone, key: Date.now() });
        setTimeout(() => setClickEffect(null), 650);

        // FIELD_POSITIONS IDs use underscore internally; convert to hyphen for back-end
        onShotSelect({
            x: point.x,
            y: point.y,
            angle: Math.round(info.angleDeg),
            distance: Math.round(info.distance),
            direction: info.direction,
            shotName: info.shotName,
            zone: info.zone,
            shotType: info.shotType,
            side: info.side,
            nearestPosition: info.nearestPos?.name || "",
            nearestPositionId: zoneToHyphen(info.nearestPos?.id || ""),
            autoRuns: null,
        });
    };

    const handleMouseMove = (event) => {
        const point = readPoint(event);
        if (!point) return;
        setHoverInfo(detectShot(point.x, point.y));
    };

    const activeStyle = activeZone ? getZoneStyle(activeZone.zone) : null;

    return (
        <div className="flex flex-col items-center gap-2">
            <div className="flex flex-wrap gap-3 justify-center text-[9px] font-black uppercase tracking-widest">
                {[
                    { color: "bg-purple-500", label: "Over Boundary" },
                    { color: "bg-blue-500", label: "Outfield" },
                    { color: "bg-green-500", label: "Inner Ring" },
                    { color: "bg-[#ff6b35]", label: "Infield" },
                ].map(item => (
                    <span key={item.label} className="flex items-center gap-1">
                        <span className={`w-2 h-2 rounded-full ${item.color}`} />
                        <span className="text-slate-500">{item.label}</span>
                    </span>
                ))}
            </div>

            <div className="relative w-full" style={{ maxWidth: 360, aspectRatio: "1" }}>
                <svg
                    ref={svgRef}
                    viewBox={`0 0 ${GW} ${GH}`}
                    width="100%"
                    height="100%"
                    className="cursor-crosshair select-none"
                    onClick={handleClick}
                    onMouseMove={handleMouseMove}
                    onMouseLeave={() => setHoverInfo(null)}
                >
                    <defs>
                        <radialGradient id="groundRef" cx="50%" cy="50%" r="50%">
                            <stop offset="0%" stopColor="#1f7a3c" />
                            <stop offset="70%" stopColor="#16813a" />
                            <stop offset="100%" stopColor="#4bb51d" />
                        </radialGradient>
                        <pattern id="grassGrid" width="28" height="28" patternUnits="userSpaceOnUse">
                            <rect width="28" height="28" fill="rgba(255,255,255,0.025)" />
                            <rect width="14" height="14" fill="rgba(0,0,0,0.035)" />
                            <rect x="14" y="14" width="14" height="14" fill="rgba(0,0,0,0.035)" />
                        </pattern>
                    </defs>

                    <circle cx={CX} cy={CY} r={BOUNDARY_RADIUS} fill="url(#groundRef)" stroke="#30a014" strokeWidth="3" />
                    <circle cx={CX} cy={CY} r={BOUNDARY_RADIUS - 2} fill="url(#grassGrid)" opacity="0.55" />
                    {Array.from({ length: 9 }).map((_, row) => (
                        Array.from({ length: 9 }).map((__, col) => (
                            <rect key={`${row}-${col}`} x={48 + col * 34} y={48 + row * 34} width="34" height="34"
                                fill={(row + col) % 2 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.028)"}
                                clipPath="circle(185px at 200px 200px)" />
                        ))
                    ))}
                    <circle cx={CX} cy={CY} r={INNER_CIRCLE_RADIUS} fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="1.6" strokeDasharray="5 4" />
                    <circle cx={CX} cy={CY} r={BOUNDARY_RADIUS} fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2" />

                    {Array.from({ length: 12 }).map((_, idx) => {
                        const angle = (idx / 12) * Math.PI * 2;
                        return (
                            <line key={idx} x1={CX} y1={CY}
                                x2={CX + Math.cos(angle) * (BOUNDARY_RADIUS - 10)}
                                y2={CY + Math.sin(angle) * (BOUNDARY_RADIUS - 10)}
                                stroke="rgba(0,0,0,0.16)" strokeWidth="0.7" strokeDasharray="3 4" />
                        );
                    })}

                    <text x="52" y="384" fontSize="13" fill="#111827" fontFamily="serif">Off side</text>
                    <text x="308" y="384" fontSize="13" fill="#111827" fontFamily="serif">On (Leg) side</text>

                    <rect x={CX - 8} y={STRIKER_Y - 18} width="16" height="82" fill="#c9a46a" rx="2" />
                    <line x1={CX - 16} y1={STRIKER_Y - 4} x2={CX + 16} y2={STRIKER_Y - 4} stroke="white" strokeWidth="1.3" />
                    <line x1={CX - 16} y1={NON_STRIKER_Y + 20} x2={CX + 16} y2={NON_STRIKER_Y + 20} stroke="white" strokeWidth="1.3" />

                    <circle cx={CX} cy={STRIKER_Y} r="5" fill="#ff6b35" />
                    <text x={CX + 10} y={STRIKER_Y + 4} fontSize="9" fontWeight="900" fill="#0f172a">S</text>
                    <circle cx={CX} cy={NON_STRIKER_Y} r="4" fill="#2563eb" />
                    <text x={CX - 26} y={NON_STRIKER_Y + 4} fontSize="9" fontWeight="900" fill="#0f172a">NS</text>
                    <circle cx={CX} cy={BOWLER_Y} r="4" fill="#ef4444" />
                    <text x={CX - 25} y={BOWLER_Y + 4} fontSize="9" fontWeight="900" fill="#0f172a">Bowler</text>

                    {FIELD_POSITIONS.map(pos => (
                        <g key={pos.id}>
                            <circle cx={pos.x} cy={pos.y} r="8" fill="transparent" onClick={(event) => { event.stopPropagation(); handleClick(event); }} />
                            <circle cx={pos.x} cy={pos.y} r={pos.type === "out" ? 4.6 : pos.type === "close" ? 3.5 : 4.2}
                                fill={pos.type === "keeper" ? "#ef4444" : pos.type === "out" ? "#ef4444" : "#f59e0b"}
                                stroke="rgba(255,255,255,0.7)" strokeWidth="0.7" />
                            <text
                                x={pos.x + (FIELD_LABEL_OFFSETS[pos.id]?.dx || 0)}
                                y={pos.y + (FIELD_LABEL_OFFSETS[pos.id]?.dy ?? -7)}
                                textAnchor="middle"
                                fontSize={pos.type === "close" ? "6.5" : "7.5"}
                                fontWeight="700"
                                fill="#0f172a" pointerEvents="none">
                                {pos.name}
                            </text>
                        </g>
                    ))}

                    {activeZone && (
                        <>
                            <line x1={CX} y1={STRIKER_Y} x2={activeZone.x} y2={activeZone.y}
                                stroke={activeStyle?.color || "#ff6b35"} strokeWidth="1.5" strokeDasharray="4 3" opacity="0.7" />
                            <circle cx={activeZone.x} cy={activeZone.y} r="7"
                                fill={activeStyle?.color || "#ff6b35"} stroke="white" strokeWidth="1.6" />
                        </>
                    )}

                    {clickEffect && (
                        <circle key={clickEffect.key} cx={clickEffect.x} cy={clickEffect.y} r="6"
                            fill={getZoneStyle(clickEffect.zone).color} opacity="0.7">
                            <animate attributeName="r" from="6" to="32" dur="0.6s" fill="freeze" />
                            <animate attributeName="opacity" from="0.7" to="0" dur="0.6s" fill="freeze" />
                        </circle>
                    )}
                </svg>

                {hoverInfo && (
                    <div className="absolute bottom-1 left-1/2 -translate-x-1/2 pointer-events-none z-10">
                        <div className="text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest shadow-lg whitespace-nowrap"
                            style={{ background: getZoneStyle(hoverInfo.zone).color, color: "white" }}>
                            {getZoneStyle(hoverInfo.zone).label}
                        </div>
                    </div>
                )}
            </div>

            {activeZone ? (
                <div className="w-full bg-black/30 rounded-2xl p-3 border border-white/5 space-y-1">
                    <div className="flex items-center justify-between">
                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Shot</span>
                        <span className="text-[10px] font-black" style={{ color: activeStyle?.color }}>
                            {getZoneStyle(activeZone.zone).label}
                        </span>
                    </div>
                    <div className="text-xs font-bold text-white">{activeZone.shotName}</div>
                    <div className="text-[9px] text-slate-400">
                        {activeZone.side}
                        {activeZone.nearestPosition && ` | near ${activeZone.nearestPosition}`}
                    </div>
                </div>
            ) : (
                <div className="text-[9px] text-slate-600 uppercase tracking-widest font-black">
                    Click anywhere on the ground
                </div>
            )}
        </div>
    );
}
