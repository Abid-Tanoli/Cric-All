import { ballChipText, ballChipTone } from "@shared/scoring/utils/plainCommentary";

export default function BallBadge({ ball, small = false }) {
  const tone = ballChipTone(ball);
  const notation = ballChipText(ball);
  const base = small ? "w-5 h-5 sm:w-6 sm:h-6 text-[8px] sm:text-[9px] rounded" : "w-8 h-8 sm:w-9 sm:h-9 text-[11px] sm:text-xs rounded-lg";
  const color = ball.wicketCancelled
    ? "bg-orange-600 text-white ring-2 ring-red-500"
    : tone === "wicket"
      ? "bg-red-600 text-white"
      : tone === "boundary"
        ? (ball.runs === 6 && !ball.isWide && !ball.isNoBall ? "bg-purple-600 text-white" : "bg-cric-accent text-white")
        : tone === "extra" ? "bg-amber-500 text-white" : "bg-cric-border text-cric-muted";
  return (
    <div className={`${base} ${color} flex items-center justify-center font-black shrink-0 shadow-sm`}>
      {notation}
    </div>
  );
}
