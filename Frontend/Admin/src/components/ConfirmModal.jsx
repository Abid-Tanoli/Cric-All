export default function ConfirmModal({ open, title, message, confirmLabel, cancelLabel, onConfirm, onCancel, variant }) {
  if (!open) return null;

  const btnClass = variant === 'danger'
    ? 'bg-red-600 hover:bg-red-700 text-white'
    : 'bg-cric-accent hover:bg-orange-600 text-white';

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-cric-card rounded-2xl border border-cric-border shadow-2xl max-w-md w-full mx-4 overflow-hidden">
        <div className="p-6 space-y-4">
          {title && <h3 className="text-lg font-black text-cric-text">{title}</h3>}
          <p className="text-sm text-cric-muted leading-relaxed">{message}</p>
        </div>
        <div className="flex gap-3 px-6 pb-6">
          <button
            onClick={onCancel}
            className="flex-1 py-3 rounded-xl font-black text-xs uppercase tracking-widest bg-black/5 dark:bg-white/5 text-cric-muted hover:bg-black/10 dark:hover:bg-white/10 transition-all"
          >
            {cancelLabel || 'Cancel'}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 py-3 rounded-xl font-black text-xs uppercase tracking-widest transition-all ${btnClass}`}
          >
            {confirmLabel || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
