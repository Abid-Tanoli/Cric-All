// Tailwind class strings shared by the organization dashboard tabs.
//
// They lived inline in the old single-file page; keeping them here means the
// seven components of the dashboard cannot drift apart visually, and a design
// tweak is one edit instead of seven.

import { Children, cloneElement, isValidElement, useId } from "react";

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

/**
 * A labelled form control.
 *
 * The label is wired to the control automatically: `useId` supplies a stable
 * id which is cloned onto a single control child, so `<label htmlFor>` points
 * at it. An id the caller already set is left alone.
 *
 * Why this matters: this component is used ~70 times across the seven dashboard
 * tabs and the player form, and every one of those fields previously rendered a
 * <label> with no `for` next to an <input> with no `id`. A screen reader
 * announced an unlabelled text field for all of them, and getByLabel() could
 * not find a single field. Fixing it here rather than per-field means a new tab
 * cannot reintroduce the bug.
 *
 * A Field whose child is not a single form control (the role pickers wrap a
 * group of toggle buttons) is rendered as a labelled group instead, because
 * `for` has nothing valid to point at there.
 */
export function Field({ label: text, children, hint }) {
  const generatedId = useId();
  const single = Children.count(children) === 1 ? Children.toArray(children)[0] : null;
  const isSingleControl =
    isValidElement(single) && ["input", "select", "textarea"].includes(single.type);

  if (isSingleControl) {
    // Respect an id the caller already set; only fill in a missing one.
    const controlId = single.props.id || generatedId;
    return (
      <div>
        <label className={label} htmlFor={controlId}>
          {text}
        </label>
        {cloneElement(single, {
          id: controlId,
          "aria-describedby": hint ? `${controlId}-hint` : single.props["aria-describedby"],
        })}
        {hint ? (
          <p id={`${controlId}-hint`} className="mt-1 text-[10px] font-semibold text-cric-muted">
            {hint}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-labelledby={`${generatedId}-label`}
      aria-describedby={hint ? `${generatedId}-hint` : undefined}
    >
      <span id={`${generatedId}-label`} className={label}>
        {text}
      </span>
      {children}
      {hint ? (
        <p id={`${generatedId}-hint`} className="mt-1 text-[10px] font-semibold text-cric-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Banner({ kind = "info", children }) {
  if (!children) return null;
  const cls = kind === "error" ? alertError : kind === "success" ? alertSuccess : alertInfo;
  return <div className={cls}>{children}</div>;
}

export default { card, cardSubtle, input, label, primaryButton, secondaryButton, dangerButton, chip };
