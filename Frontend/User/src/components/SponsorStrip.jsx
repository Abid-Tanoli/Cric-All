import React from "react";
import SafeImage from "../../../Shared/components/SafeImage.jsx";

// Local sponsor strip — deliberately NOT an AdSlot and never an AdSense unit.
// It is plain content: lazy images in fixed boxes, title sponsor called out,
// supporting sponsors in a compact wrapping row. An empty list renders nothing.

const REL = "noopener noreferrer sponsored";

function SponsorLogo({ sponsor, prominent }) {
  const inner = (
    <>
      <span className={`${prominent ? "h-14 w-14 sm:h-16 sm:w-16" : "h-9 w-9"} block overflow-hidden rounded-lg bg-white`}>
        <SafeImage
          src={sponsor.logoUrl}
          alt={`${sponsor.name} logo`}
          loading="lazy"
          className="h-full w-full object-contain"
        />
      </span>
      <span className={prominent ? "text-xs font-black uppercase tracking-wide" : "text-[10px] font-bold"}>
        {sponsor.name}
      </span>
    </>
  );

  const classes = prominent
    ? "flex items-center gap-3 rounded-xl border border-cric-border bg-cric-card px-3 py-2"
    : "flex items-center gap-2 rounded-lg border border-cric-border bg-cric-card px-2 py-1";

  if (!sponsor.linkUrl) {
    return <span className={classes}>{inner}</span>;
  }

  return (
    <a
      href={sponsor.linkUrl}
      target="_blank"
      rel={REL}
      className={`${classes} hover:border-cric-accent transition-colors`}
      aria-label={`${sponsor.name} (opens in a new tab)`}
    >
      {inner}
    </a>
  );
}

export default function SponsorStrip({ sponsors = [], compact = false }) {
  const list = Array.isArray(sponsors) ? sponsors.filter((entry) => entry && entry.logoUrl && entry.name) : [];
  if (list.length === 0) return null;

  const title = list.find((entry) => entry.tier === "title");
  const supporting = list.filter((entry) => entry.tier !== "title");

  return (
    <section
      data-testid="sponsor-strip"
      aria-label="Sponsored by"
      className={`${compact ? "mt-3" : "mt-4"} flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/10 pt-3 first:mt-0 first:border-t-0 first:pt-0`}
    >
      <span className="text-[10px] font-black uppercase tracking-[0.18em] text-cric-muted">Sponsored by</span>
      {title ? (
        <div className="flex items-center gap-2">
          <span className="rounded bg-cric-accent px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-white">
            Title
          </span>
          <SponsorLogo sponsor={title} prominent />
        </div>
      ) : null}
      {supporting.length ? (
        <div data-testid="supporting-sponsors" className="flex flex-wrap items-center gap-2">
          {supporting.map((sponsor) => (
            <SponsorLogo key={sponsor._id || sponsor.name} sponsor={sponsor} prominent={false} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
