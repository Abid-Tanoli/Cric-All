import { useRef } from "react";
import { toPng } from "html-to-image";
import { teamShortName } from "../utils/teamDisplay";

const MatchSummaryCard = ({ match }) => {
  const cardRef = useRef(null);

  if (!match) return null;

  const team1 = match.teams?.[0];
  const team2 = match.teams?.[1];
  const inn1 = match.innings?.[0];
  const inn2 = match.innings?.[1];
  const result = match.result;

  const handleDownload = async () => {
    if (!cardRef.current) return;
    try {
      const dataUrl = await toPng(cardRef.current, {
        quality: 1,
        pixelRatio: 2,
        backgroundColor: "var(--cric-accent)",
      });
      const link = document.createElement("a");
      link.download = `match-summary-${match._id || "card"}.png`;
      link.href = dataUrl;
      link.click();
    } catch {
      // Ignore a failed download; the UI simply does not save a file.
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${team1?.name || "Team1"} vs ${team2?.name || "Team2"}`,
          text: result?.description || "Match summary",
          url: window.location.href,
        });
      } catch {
        // The native share sheet was dismissed or is unavailable.
      }
    } else {
      handleDownload();
    }
  };

  const getShortName = (team) => teamShortName(team);
  const getLogo = (team) => team?.logo || "";

  return (
    <div>
      {/* Hidden card for image export */}
      <div
        ref={cardRef}
        style={{
          width: "600px",
          padding: "32px",
          background: "linear-gradient(135deg, var(--cric-accent) 0%, #1a3a6b 100%)",
          borderRadius: "24px",
          color: "white",
          fontFamily: "system-ui, sans-serif",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "-40px",
            right: "-40px",
            width: "200px",
            height: "200px",
            borderRadius: "50%",
            background: "rgba(255,107,53,0.1)",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: "-60px",
            left: "-60px",
            width: "300px",
            height: "300px",
            borderRadius: "50%",
            background: "rgba(255,107,53,0.05)",
          }}
        />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
          <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "4px", textTransform: "uppercase", color: "#ff6b35" }}>
            Match Summary
          </div>
          <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase", color: "rgba(255,255,255,0.5)" }}>
            CricAll
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "28px" }}>
          <div style={{ textAlign: "center", flex: 1 }}>
            {getLogo(team1) && (
              <img src={getLogo(team1)} alt="" style={{ width: "48px", height: "48px", borderRadius: "50%", margin: "0 auto 8px" }} />
            )}
            <div style={{ fontSize: "16px", fontWeight: 700 }}>{getShortName(team1)}</div>
            {inn1 && (
              <div style={{ fontSize: "32px", fontWeight: 900, color: "#ffb400", marginTop: "4px" }}>
                {inn1.runs}/{inn1.wickets}
              </div>
            )}
            {inn1 && (
              <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)", marginTop: "2px" }}>
                {inn1.overs}.{inn1.balls % 6} ov
              </div>
            )}
          </div>

          <div style={{ padding: "0 16px", textAlign: "center" }}>
            <div style={{ fontSize: "12px", fontWeight: 700, color: "#ff6b35", letterSpacing: "3px", textTransform: "uppercase" }}>VS</div>
            <div style={{ width: "40px", height: "2px", background: "#ff6b35", margin: "8px auto" }} />
            {match.matchType && (
              <div style={{ fontSize: "10px", fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" }}>
                {match.matchType}
              </div>
            )}
          </div>

          <div style={{ textAlign: "center", flex: 1 }}>
            {getLogo(team2) && (
              <img src={getLogo(team2)} alt="" style={{ width: "48px", height: "48px", borderRadius: "50%", margin: "0 auto 8px" }} />
            )}
            <div style={{ fontSize: "16px", fontWeight: 700 }}>{getShortName(team2)}</div>
            {inn2 && (
              <div style={{ fontSize: "32px", fontWeight: 900, color: "#ffb400", marginTop: "4px" }}>
                {inn2.runs}/{inn2.wickets}
              </div>
            )}
            {inn2 && (
              <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)", marginTop: "2px" }}>
                {inn2.overs}.{inn2.balls % 6} ov
              </div>
            )}
          </div>
        </div>

        {result && (
          <div
            style={{
              background: "rgba(255,107,53,0.15)",
              border: "1px solid rgba(255,107,53,0.3)",
              borderRadius: "12px",
              padding: "12px 16px",
              textAlign: "center",
              marginBottom: "16px",
            }}
          >
            <div style={{ fontSize: "13px", fontWeight: 700, color: "#ffb400" }}>{result.description}</div>
          </div>
        )}

        {match.manOfMatch && (
          <div style={{ display: "flex", alignItems: "center", gap: "10px", justifyContent: "center" }}>
            <div
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "50%",
                background: "#ff6b35",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "14px",
                fontWeight: 700,
              }}
            >
              {match.manOfMatch.name?.charAt(0) || "M"}
            </div>
            <div>
              <div style={{ fontSize: "10px", fontWeight: 700, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "2px" }}>
                Player of the Match
              </div>
              <div style={{ fontSize: "14px", fontWeight: 700 }}>{match.manOfMatch.name}</div>
            </div>
          </div>
        )}

        <div style={{ marginTop: "20px", paddingTop: "16px", borderTop: "1px solid rgba(255,255,255,0.1)", textAlign: "center" }}>
          <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)" }}>
            {match.venue} &bull; {match.startAt ? new Date(match.startAt).toLocaleDateString("en-GB") : ""}
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3 mt-4">
        <button
          onClick={handleShare}
          className="px-6 py-3 bg-cric-accent text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-cric-accent/90 transition-all shadow-xl shadow-cric-accent/20 flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
          Share Match Card
        </button>
        <button
          onClick={handleDownload}
          className="px-6 py-3 bg-white/10 text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-white/20 transition-all border border-white/20 flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Download Image
        </button>
      </div>
    </div>
  );
};

export default MatchSummaryCard;
