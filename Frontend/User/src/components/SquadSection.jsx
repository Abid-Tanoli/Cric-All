import { idOf, playerName } from "../utils/matchHelpers";
import BattingPositionBadge from "@shared/components/BattingPositionBadge";

export default function SquadSection({ title, players: squadPlayers, allPlayers, muted = false }) {
  return (
    <div className="border-t border-cric-border bg-cric-bg/50 px-3 sm:px-4 py-2 sm:py-3">
      <h4 className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-cric-muted">{title}</h4>
      <div className="mt-1.5 sm:mt-2 grid gap-1.5 sm:gap-2 grid-cols-1 sm:grid-cols-2">
        {squadPlayers.map((player) => (
          <div key={idOf(player)} className={`flex items-center justify-between rounded-lg px-2 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm ${muted ? "bg-cric-card text-cric-text" : "bg-cric-bg text-cric-text"}`}>
            <span className="font-bold truncate min-w-0">{playerName(player, allPlayers)}</span>
            <span className="ml-2 flex shrink-0 items-center gap-1 text-[9px] sm:text-[10px] font-bold uppercase text-cric-muted">
              <span>{player?.playingRole || player?.role || "Player"}</span>
              <BattingPositionBadge value={player?.battingPosition} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
