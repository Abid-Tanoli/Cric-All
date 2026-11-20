import CommentaryChip from "./CommentaryChip";

// One delivery row: over.ball number, chip, plain sentence, and — on a wicket —
// the batter's final score. Spacing is deliberately roomy so every row is a
// comfortable tap target on a phone.
export default function CommentaryBall({ delivery, useAiCommentary = false, compact = false }) {
  if (!delivery) return null;

  const { ball, label, chip, tone, text, dismissal, wicket } = delivery;
  const stored = ball?.vividCommentary || ball?.commentary || "";
  // AI commentary stays exactly as it is today: shown under the line when the
  // match has it on. With it off the deterministic sentence is the commentary.
  const note = useAiCommentary ? stored : "";

  return (
    <div
      className={`grid grid-cols-[2.5rem_1.75rem_minmax(0,1fr)] items-start gap-2 border-b border-cric-border/60 px-1 sm:grid-cols-[3rem_2rem_minmax(0,1fr)] sm:gap-3 sm:px-2 ${
        compact ? "py-2" : "min-h-[44px] py-2.5 sm:py-3"
      } last:border-b-0 ${wicket ? "bg-red-50/70 dark:bg-red-900/15" : ""}`}
    >
      <span className="pt-1 text-[10px] font-bold tabular-nums text-cric-muted sm:text-[11px]">
        {label}
      </span>
      <CommentaryChip chip={chip} tone={tone} />
      <div className="min-w-0">
        <p
          className={`${
            compact ? "text-[11px] sm:text-xs" : "text-xs sm:text-sm"
          } font-semibold leading-snug text-cric-text`}
        >
          {text}
        </p>

        {dismissal && (
          <p className="mt-1 text-[11px] font-black leading-snug text-red-700 dark:text-red-300 sm:text-xs">
            {dismissal}
          </p>
        )}

        {note && (
          <div className="mt-1 flex items-start gap-1.5">
            <p className="text-[11px] italic leading-snug text-cric-muted sm:text-xs">{note}</p>
            {ball?.isAi && (
              <span className="shrink-0 rounded border border-violet-300 px-1 py-0.5 text-[8px] font-bold uppercase text-violet-600 dark:border-violet-700 dark:text-violet-300">
                AI
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
