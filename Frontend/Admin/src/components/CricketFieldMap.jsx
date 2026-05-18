import React from "react";

const POSITIONS = [
    { id: "wicket-keeper", label: "WK", x: 200, y: 155 },
    { id: "first-slip", label: "1st Slip", x: 172, y: 165 },
    { id: "second-slip", label: "2nd Slip", x: 155, y: 172 },
    { id: "gully", label: "Gully", x: 124, y: 188 },
    { id: "third-man", label: "Third Man", x: 92, y: 85 },
    { id: "deep-third-man", label: "Deep Third", x: 72, y: 116 },
    { id: "backward-point", label: "Backward Point", x: 86, y: 220 },
    { id: "point", label: "Point", x: 72, y: 250 },
    { id: "deep-point", label: "Deep Point", x: 36, y: 250 },
    { id: "cover-point", label: "Cover Point", x: 105, y: 284 },
    { id: "cover", label: "Cover", x: 120, y: 318 },
    { id: "deep-cover", label: "Deep Cover", x: 58, y: 320 },
    { id: "extra-cover", label: "Extra Cover", x: 150, y: 335 },
    { id: "deep-extra-cover", label: "Deep Extra Cover", x: 92, y: 365 },
    { id: "mid-off", label: "Mid Off", x: 176, y: 306 },
    { id: "long-off", label: "Long Off", x: 148, y: 382 },
    { id: "straight", label: "Straight", x: 200, y: 386 },
    { id: "mid-on", label: "Mid On", x: 224, y: 306 },
    { id: "long-on", label: "Long On", x: 252, y: 382 },
    { id: "mid-wicket", label: "Mid Wicket", x: 282, y: 318 },
    { id: "deep-mid-wicket", label: "Deep Mid Wicket", x: 342, y: 320 },
    { id: "square-leg", label: "Square Leg", x: 328, y: 250 },
    { id: "deep-square-leg", label: "Deep Square Leg", x: 364, y: 250 },
    { id: "backward-square-leg", label: "Backward Square", x: 314, y: 220 },
    { id: "fine-leg", label: "Fine Leg", x: 292, y: 170 },
    { id: "deep-fine-leg", label: "Deep Fine Leg", x: 335, y: 118 },
    { id: "long-leg", label: "Long Leg", x: 308, y: 84 },
    { id: "short-fine-leg", label: "Short Fine", x: 252, y: 186 },
    { id: "bowler", label: "Bowler", x: 200, y: 295 },
];

export default function CricketFieldMap({ onFieldClick, selectedZone }) {
    const handlePosClick = (pos) => {
        onFieldClick({
            position: pos.id,
            positionLabel: pos.label,
            x: pos.x,
            y: pos.y
        });
    };

    return (
        <div className="flex flex-col items-center gap-4 w-full h-full">
            <div className="relative w-full min-w-[280px] min-h-[280px] aspect-square bg-[#2d6a4f] rounded-full shadow-2xl overflow-hidden border-8 border-[#1b4332]" style={{ maxWidth: '400px', maxHeight: '400px' }}>
                <svg viewBox="0 0 400 400" className="absolute inset-0 w-full h-full">
                    {/* Inner Ring */}
                    <circle cx="200" cy="200" r="120" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="2" strokeDasharray="5,5" />
                    
                    {/* Pitch */}
                    <rect x="190" y="150" width="20" height="170" fill="#d8ad68" />
                    <line x1="188" y1="172" x2="212" y2="172" stroke="white" strokeWidth="1" />
                    <line x1="188" y1="306" x2="212" y2="306" stroke="white" strokeWidth="1" />
                    
                    {/* Bowler/Striker indicators */}
                    <text x="200" y="205" textAnchor="middle" fill="white" fontSize="11" fontWeight="900">S</text>
                    <text x="200" y="258" textAnchor="middle" fill="white" fontSize="11" fontWeight="900">NS</text>
                    <circle cx="200" cy="145" r="3" fill="white" />
                    <rect x="197" y="320" width="6" height="2" fill="white" />
                </svg>

                {/* Fielding Buttons */}
                {POSITIONS.map((pos) => (
                    <button
                        key={pos.id}
                        onClick={() => handlePosClick(pos)}
                        title={pos.label}
                        className={`absolute w-4 h-4 rounded-full border-2 border-white transition-all transform -translate-x-1/2 -translate-y-1/2 group ${
                            selectedZone === pos.id 
                            ? "bg-[#ff6b35] scale-150 shadow-[0_0_15px_#ff6b35]" 
                            : "bg-white/80 hover:bg-white hover:scale-125"
                        }`}
                        style={{ left: `${(pos.x / 400) * 100}%`, top: `${(pos.y / 400) * 100}%` }}
                    >
                        <span className="absolute bottom-5 left-1/2 -translate-x-1/2 bg-black/80 text-white text-[8px] px-1 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none transition-opacity font-bold">
                            {pos.label}
                        </span>
                    </button>
                ))}
            </div>
            
            <div className="bg-white/10 backdrop-blur-md border border-white/20 px-6 py-2 rounded-full shadow-lg">
                <p className="text-sm font-black text-white uppercase tracking-widest">
                    Selected: <span className="text-[#ff6b35]">{POSITIONS.find(p => p.id === selectedZone)?.label || "None"}</span>
                </p>
            </div>
        </div>
    );
}
