import React, { forwardRef, useId } from "react";

// T2.2: form field (03-UI-UX.md section 6.1, TRD section 3): English label,
// a 56px control, then one Urdu help line (lang="ur" dir="rtl") linked with
// aria-describedby. T2.1 passes `urduHelp` / `urduError` from formHelp.js.
// Styles: `.ui-field` in Shared/styles/theme.css.
const CONTROLS = new Set(["input", "select", "textarea"]);

const Field = forwardRef(function Field(
  { label, urduHelp, error, urduError, id, as = "input", className = "", children, "aria-describedby": describedByProp, ...controlProps },
  ref,
) {
  const autoId = useId();
  const controlId = id || `${autoId}control`;
  const errorId = `${controlId}-error`;
  const urduId = `${controlId}-urdu`;
  const Control = CONTROLS.has(as) ? as : "input";
  const describedBy = [describedByProp, error ? errorId : null, urduHelp ? urduId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className={["ui-field", className].filter(Boolean).join(" ")}>
      <label htmlFor={controlId} className="ui-field__label">
        {label}
      </label>
      <Control
        ref={ref}
        id={controlId}
        className="ui-field__control"
        aria-invalid={error ? "true" : undefined}
        aria-describedby={describedBy}
        {...controlProps}
      >
        {Control === "select" ? children : undefined}
      </Control>
      {error ? (
        <span id={errorId} className="ui-field__error">
          <span>
            <span aria-hidden="true">✕ </span>
            {error}
          </span>
          {urduError ? (
            <span lang="ur" dir="rtl" className="ui-field__urdu">
              {urduError}
            </span>
          ) : null}
        </span>
      ) : null}
      {urduHelp ? (
        <span id={urduId} lang="ur" dir="rtl" className="ui-field__urdu">
          {urduHelp}
        </span>
      ) : null}
    </div>
  );
});

export default Field;
