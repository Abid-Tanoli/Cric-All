import { useState } from "react";
import { teamPreviewUrl, playerPreviewUrl, postPreviewUrl } from "./communityConfig";

// A simple, dependency-free share menu.
//
// WHY NOT just window.open(): pop-up blockers and mobile browsers swallow
// window.open, so the menu is an inline dropdown of real <a> links (target
// _blank, rel noopener) plus a Copy button and the native Web Share API.
//
// ALL links point at the BACKEND preview URL (`<apiOrigin>/share/{post|team|player}/:id`),
// never the SPA URL and never a hardcoded localhost, so WhatsApp/Facebook/X/
// Telegram render a real link preview. Instagram has no web share URL, so it is
// covered by the native share sheet + "Copy link".
//
// `onShare` fires once per share action (the post page passes POST /posts/:id/share;
// team/player pages pass the built-in counter endpoint).

const MENU_ITEMS = [
  { key: "whatsapp", label: "WhatsApp", icon: "🟢", build: ({ url, title }) => `https://wa.me/?text=${encodeURIComponent(`${title ? `${title} ` : ""}${url}`)}` },
  { key: "facebook", label: "Facebook", icon: "🔵", build: ({ url }) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}` },
  { key: "x", label: "X", icon: "⚫", build: ({ url, title }) => `https://x.com/intent/tweet?text=${encodeURIComponent(title || "")}&url=${encodeURIComponent(url)}` },
  { key: "telegram", label: "Telegram", icon: "🔷", build: ({ url, title }) => `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title || "")}` },
];

// Best-effort title/image for the native share sheet. The backend preview page
// is the link target; the extra fields only enrich the OS share sheet.
async function enrichWithOpenGraph(previewHref) {
  try {
    const res = await fetch(previewHref, { headers: { Accept: "text/html" } });
    const html = await res.text();
    const meta = (prop) =>
      html.match(new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i"))?.[1] ||
      "";
    return { title: meta("og:title") || document.title, text: meta("og:description") || "" };
  } catch {
    return { title: document.title, text: "" };
  }
}

export default function ShareMenu({ kind = "post", id, title = "", onShare, disabled }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!id) return null;

  const url =
    kind === "team" ? teamPreviewUrl(id) : kind === "player" ? playerPreviewUrl(id) : postPreviewUrl(id);

  const fire = async () => {
    if (!onShare) return;
    try {
      await onShare();
    } catch {
      /* a failed counter must never block sharing */
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      fire();
    } catch {
      /* clipboard may be blocked; the link is still visible in the menu */
    }
  };

  const handleNative = async () => {
    if (!navigator.share) return;
    try {
      const og = await enrichWithOpenGraph(url);
      await navigator.share({ title: og.title || title, text: og.text, url });
      fire();
    } catch {
      /* user cancelled the share sheet */
    }
  };

  const handleLinkClick = () => {
    fire();
    setOpen(false);
  };

  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <div className="relative inline-block" data-testid="share-menu">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        className="min-h-[40px] rounded-lg px-3 text-xs font-black uppercase tracking-widest text-cric-muted transition hover:text-cric-accent disabled:opacity-60"
      >
        Share
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close share menu"
            className="fixed inset-0 z-10 cursor-default"
            tabIndex={-1}
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="absolute right-0 z-20 mt-2 w-52 overflow-hidden rounded-xl border border-cric-border bg-cric-card shadow-xl"
          >
            {MENU_ITEMS.map((item) => (
              <a
                key={item.key}
                role="menuitem"
                href={item.build({ url, title })}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleLinkClick}
                className="flex items-center gap-3 px-4 py-3 text-sm font-bold text-cric-text hover:bg-cric-bg"
              >
                <span aria-hidden="true">{item.icon}</span>
                {item.label}
              </a>
            ))}
            {canNativeShare ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  handleNative();
                  setOpen(false);
                }}
                className="flex w-full items-center gap-3 px-4 py-3 text-sm font-bold text-cric-text hover:bg-cric-bg"
              >
                <span aria-hidden="true">📱</span>
                Share via device
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              onClick={handleCopy}
              className="flex w-full items-center gap-3 border-t border-cric-border px-4 py-3 text-sm font-bold text-cric-text hover:bg-cric-bg"
            >
              <span aria-hidden="true">🔗</span>
              {copied ? "Copied!" : "Copy link"}
            </button>
            <p className="border-t border-cric-border px-4 py-2 text-[10px] font-semibold text-cric-muted">
              Instagram: use “Share via device” or copy the link.
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}
