// Tailwind class strings shared by the organization dashboard tabs.
//
// They lived inline in the old single-file page; keeping them here means the
// seven components of the dashboard cannot drift apart visually, and a design
// tweak is one edit instead of seven.

export const card = "rounded-2xl border border-cric-border bg-cric-card p-6 shadow-sm";
export const cardSubtle = "rounded-xl border border-cric-border bg-cric-bg p-4";

export const input =
  "w-full rounded-lg border border-cric-border bg-cric-bg px-3 py-3 text-sm font-semibold text-cric-text focus:outline-none focus:ring-2 focus:ring-cric-accent/30 focus:border-cric-accent disabled:opacity-60";

export const label = "block text-[10px] font-black uppercase tracking-widest text-cric-muted mb-2";

export const primaryButton =
  "rounded-lg bg-cric-accent px-6 py-3 text-xs font-black uppercase tracking-widest text-white shadow-sm transition hover:bg-orange-600 disabled:opacity-60";

export const secondaryButton =
  "rounded-lg border border-cric-border bg-cric-bg px-5 py-3 text-xs font-black uppercase tracking-widest text-cric-muted transition hover:text-cric-text disabled:opacity-60";

export const dangerButton =
  "rounded-lg border border-red-300 bg-white px-5 py-2 text-[10px] font-black uppercase tracking-widest text-red-600 transition hover:bg-red-50 disabled:opacity-60";

export const chip =
  "rounded-full border border-cric-border bg-cric-bg px-3 py-1 text-[10px] font-black uppercase tracking-widest text-cric-muted";

export const alertError = "rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-bold text-red-700";
export const alertSuccess =
  "rounded-xl border border-green-300 bg-green-50 px-4 py-3 text-sm font-bold text-green-700";
export const alertInfo = "rounded-xl border border-cric-border bg-cric-bg px-4 py-3 text-sm font-semibold text-cric-muted";

export const sectionTitle = "text-sm font-black uppercase tracking-widest text-cric-text";
export const eyebrow = "text-[10px] font-black uppercase tracking-widest text-cric-muted";

export function Stat({ label: text, value, hint }) {
  return (
    <div className={cardSubtle}>
      <p className={eyebrow}>{text}</p>
      <p className="mt-1 text-2xl font-black text-cric-text">{value}</p>
      {hint ? <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-cric-muted">{hint}</p> : null}
    </div>
  );
}

export function Field({ label: text, children, hint }) {
  return (
    <div>
      <label className={label}>{text}</label>
      {children}
      {hint ? <p className="mt-1 text-[10px] font-semibold text-cric-muted">{hint}</p> : null}
    </div>
  );
}

export function Banner({ kind = "info", children }) {
  if (!children) return null;
  const cls = kind === "error" ? alertError : kind === "success" ? alertSuccess : alertInfo;
  return <div className={cls}>{children}</div>;
}

export default { card, cardSubtle, input, label, primaryButton, secondaryButton, dangerButton, chip };
