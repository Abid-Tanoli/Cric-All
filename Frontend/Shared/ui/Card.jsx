import React, { useId } from "react";

// T2.2: plain surface for one group of content. Styles: `.ui-card` in
// Shared/styles/theme.css. A <div> by default; pass as="section" to make it a
// landmark named by its title.
export default function Card({ title, headingLevel = 2, as = "div", className = "", children, ...rest }) {
  const titleId = useId();
  const Tag = as;
  const level = Math.min(6, Math.max(2, Number(headingLevel) || 2));
  const Heading = `h${level}`;
  const namedByTitle = Boolean(title) && (Tag === "section" || Tag === "article");

  return (
    <Tag className={["ui-card", className].filter(Boolean).join(" ")} aria-labelledby={namedByTitle ? titleId : undefined} {...rest}>
      {title ? (
        <Heading id={titleId} className="ui-card__title">
          {title}
        </Heading>
      ) : null}
      {children}
    </Tag>
  );
}
