import { number, playerName } from "../utils/matchHelpers";
import { ballChipText, ballChipTone, ballSentence } from "@shared/scoring/utils/plainCommentary";
import BallBadge from "./BallBadge";

const TONE_CLASS = {
  wicket: "bg-red-600 text-white",
  boundary: "bg-cric-accent text-white",
  extra: "bg-cric-bg text-cric-text ring-1 ring-cric-border",
  normal: "bg-cric-bg text-cric-text ring-1 ring-cric-border",
};

export default function CommentaryBall({ over, ball, players, compact = false, useAiCommentary = false }) {
  const ballNum = ball.displayBall || ball.displayBallNumber || ball.ballNumber || 1;
  const overText = `${number(over.overNumber) + 1}.${ballNum}`;
  const bowler = ball.bowlerName || playerName(ball.bowler || over.bowler, players);
  const batsman = ball.batsmanName || playerName(ball.batsmanOnStrike, players);
  const sentence = ballSentence(ball, { bowlerName: bowler, batsmanName: batsman });
  const stored = ball.vividCommentary || ball.commentary || "";
  // AI commentary stays exactly as it is today: shown under the line when the
  // match has it on. With it off (or an old match with nothing stored) the
  // deterministic sentence above is the whole commentary.
  const note = useAiCommentary ? stored : "";
  const runs = ball.runs || 0;
  const isSix = ballChipTone(ball) === "boundary" && runs === 6;
  const isBoundary = ballChipTone(ball) === "boundary" && runs === 4;
  const isWicket = ball?.isWicket;

  if (compact) {
    return (
      <div className="grid grid-cols-[1.5rem_1rem_minmax(0,1fr)] sm:grid-cols-[2rem_1.25rem_minmax(0,1fr)] gap-1 sm:gap-2 px-2 sm:px-4 py-1 sm:py-1.5 hover:bg-cric-accent/5 text-[11px] sm:text-xs">
        <span className="text-[9px] sm:text-[10px] font-bold tabular-nums text-cric-muted shrink-0 pt-0.5">{overText}</span>
        <span className={`w-4 h-4 sm:w-5 sm:h-5 rounded flex items-center justify-center text-[7px] sm:text-[8px] font-black shrink-0 ${TONE_CLASS[ballChipTone(ball)] || TONE_CLASS.normal}`}>
          {ballChipText(ball)}
        </span>
        <div className="min-w-0">
          <p className="text-cric-text font-semibold">{sentence}</p>
          {note && <p className="mt-0.5 truncate text-cric-muted/70">{note}</p>}
          {note && ball.isAi && (
            <span className="mt-0.5 inline-flex rounded border border-violet-300 px-1 text-[8px] font-bold uppercase text-violet-600 dark:border-violet-700 dark:text-violet-300">
              AI
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`p-2 sm:p-3 rounded-xl transition-all ${isWicket ? "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800" : "hover:bg-cric-accent/5"}`}>
      <div className="flex items-center gap-2 sm:gap-3">
        <BallBadge ball={ball} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1 sm:gap-2 flex-wrap">
            <span className="text-cric-muted font-bold text-[10px] sm:text-xs tabular-nums">{overText}</span>
            <span className="text-cric-text font-bold text-xs sm:text-sm leading-tight">{sentence}</span>
          </div>
        </div>
      </div>
      {note && (
        <div className="ml-8 sm:ml-12 mt-1 sm:mt-1.5 flex items-start gap-1.5">
          <p className="text-[11px] sm:text-xs text-cric-muted italic leading-relaxed">{note}</p>
          {ball.isAi && (
            <span className="shrink-0 rounded border border-violet-300 px-1 py-0.5 text-[8px] font-bold uppercase text-violet-600 dark:border-violet-700 dark:text-violet-300">
              AI
            </span>
          )}
        </div>
      )}
      {(isSix || isBoundary) && (
        <div className="ml-8 sm:ml-12 mt-1 flex items-center gap-1 text-[8px] sm:text-[9px] font-bold uppercase text-cric-muted">
          {ball.regionName || ball.zone || ""}
        </div>
      )}
    </div>
  );
}
