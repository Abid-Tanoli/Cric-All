// One chip look for every commentary surface: over strip, ball rows and the
// end-of-over card all read the same tone from the shared builder.
const TONE_CLASS = {
  wicket: "bg-red-600 text-white",
  boundary: "bg-cric-accent text-white",
  extra: "bg-cric-bg text-cric-text ring-1 ring-cric-border",
  normal: "bg-cric-bg text-cric-text ring-1 ring-cric-border",
};

export default function CommentaryChip({ chip, tone = "normal", className = "" }) {
  return (
    <span
      className={`inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md px-1.5 text-[10px] font-black tabular-nums sm:h-7 sm:min-w-7 sm:text-[11px] ${
        TONE_CLASS[tone] || TONE_CLASS.normal
      } ${className}`}
    >
      {chip}
    </span>
  );
}
