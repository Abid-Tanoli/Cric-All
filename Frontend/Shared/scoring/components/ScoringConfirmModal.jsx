export default function ScoringConfirmModal({ open, title, message, confirmLabel, cancelLabel, onConfirm, onCancel, variant }) {
  if (!open) return null;

  const buttonClass = variant === "danger"
    ? "bg-red-600 hover:bg-red-700 text-white"
    : "bg-cric-accent hover:bg-orange-600 text-white";

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-cric-border bg-cric-card shadow-2xl">
        <div className="space-y-4 p-6">
          {title ? <h3 className="text-lg font-black text-cric-text">{title}</h3> : null}
          <p className="text-sm leading-relaxed text-cric-muted">{message}</p>
        </div>
        <div className="flex gap-3 px-6 pb-6">
          <button type="button" onClick={onCancel} className="min-h-11 flex-1 rounded-xl bg-black/5 py-3 text-xs font-black uppercase tracking-widest text-cric-muted">
            {cancelLabel || "Cancel"}
          </button>
          <button type="button" onClick={onConfirm} className={`min-h-11 flex-1 rounded-xl py-3 text-xs font-black uppercase tracking-widest ${buttonClass}`}>
            {confirmLabel || "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
