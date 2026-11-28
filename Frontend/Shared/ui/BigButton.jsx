import React, { forwardRef } from "react";

// T2.2: large, readable button (03-UI-UX.md section 4). Styles: `.ui-button`
// in Shared/styles/theme.css. Use one `primary` per screen; others `secondary`.
const VARIANTS = new Set(["primary", "secondary", "danger", "success"]);

const BigButton = forwardRef(function BigButton(
  { variant = "primary", size = "default", block = false, icon = null, type = "button", className = "", children, ...rest },
  ref,
) {
  const classes = [
    "ui-button",
    `ui-button--${VARIANTS.has(variant) ? variant : "secondary"}`,
    size === "pad" ? "ui-button--pad" : null,
    block ? "ui-button--block" : null,
    className || null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button ref={ref} type={type} className={classes} {...rest}>
      {icon ? (
        <span className="ui-button__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="ui-button__label">{children}</span>
    </button>
  );
});

export default BigButton;
