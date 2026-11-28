import React, { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

// T2.2: bottom sheet (centred dialog from 768px) for short choices such as
// "How out?" or a confirmation. Styles: `.ui-sheet` in Shared/styles/theme.css.
// Focus moves to the sheet when it opens, stays inside while Tab is pressed,
// and returns to the opener on close. Escape or a tap outside calls onClose.
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

export default function Sheet({ open, onClose, title, className = "", children }) {
  const titleId = useId();
  const sheetRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    sheetRef.current?.focus();
    return () => {
      if (opener && typeof opener.focus === "function" && document.contains(opener)) opener.focus();
    };
  }, [open]);

  if (!open) return null;

  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose?.();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...sheetRef.current.querySelectorAll(FOCUSABLE)];
    if (!focusable.length) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === sheetRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleBackdropClick = (event) => {
    if (event.target === event.currentTarget) onClose?.();
  };

  return createPortal(
    <div className="ui-sheet-backdrop" onClick={handleBackdropClick}>
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={["ui-sheet", className].filter(Boolean).join(" ")}
        onKeyDown={handleKeyDown}
      >
        <h2 id={titleId} className="ui-sheet__title">
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}
