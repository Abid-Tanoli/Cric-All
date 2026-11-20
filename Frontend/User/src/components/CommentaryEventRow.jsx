// Soft tinted event row used for the new-bowler and new-batter lines. It is not
// a delivery, so it has no chip and no over.ball number.
const TINT = {
  bowler:
    "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-900/25 dark:text-sky-200",
  batter:
    "border-violet-200 bg-violet-50 text-violet-900 dark:border-violet-800 dark:bg-violet-900/25 dark:text-violet-200",
};

export default function CommentaryEventRow({ event }) {
  if (!event?.text) return null;
  const tint = TINT[event.kind] || TINT.bowler;
  return (
    <div className={`my-1.5 flex items-start gap-2 rounded-lg border px-2.5 py-2 ${tint}`}>
      <span className="mt-0.5 shrink-0 rounded bg-white/80 px-1 py-0.5 text-[8px] font-black uppercase tracking-wider dark:bg-black/20">
        {event.label}
      </span>
      <p className="min-w-0 text-[11px] font-bold leading-snug sm:text-xs">{event.text}</p>
    </div>
  );
}
