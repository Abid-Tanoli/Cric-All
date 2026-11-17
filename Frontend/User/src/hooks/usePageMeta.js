import { useEffect } from "react";

/** Unique, short metadata for every public route. Ads and auth stay unchanged. */
export const PAGE_META = {
  home: {
    title: "CricAll | Live Cricket Scores & Local Tournaments",
    description: "Follow live cricket scores, scorecards and local club tournaments across Pakistan on CricAll.",
  },
  live: {
    title: "Live Scores | CricAll",
    description: "See live cricket scores, results and upcoming matches from local clubs and tournaments on CricAll.",
  },
  match: {
    title: "Match Scorecard | CricAll",
    description: "Open a CricAll match scorecard for live runs, wickets, overs and results from local cricket.",
  },
  teams: {
    title: "Teams Directory | CricAll",
    description: "Browse cricket teams by club, school, academy, league and other groups on CricAll.",
  },
  tournaments: {
    title: "Series & Tournaments | CricAll",
    description: "Explore local cricket tournaments, series, fixtures, results and team pages on CricAll.",
  },
  rankings: {
    title: "Cricket Rankings | CricAll",
    description: "View team and player rankings for local cricket matches recorded on CricAll.",
  },
  blogs: {
    title: "Cricket Blogs & Stories | CricAll",
    description: "Read cricket blogs, match stories and updates from local tournaments on CricAll.",
  },
  about: {
    title: "About CricAll | Local Cricket in Pakistan",
    description: "Learn what CricAll is, who it serves and how local clubs record and share cricket matches.",
  },
  contact: {
    title: "Contact CricAll",
    description: "Find the current CricAll contact email, response time and topics we can help with.",
  },
  privacy: {
    title: "Privacy Policy | CricAll",
    description: "Read how CricAll handles account details, match data, cookies and Google AdSense.",
  },
  terms: {
    title: "Terms of Use | CricAll",
    description: "Read the simple terms for using CricAll, including content, scores and acceptable use.",
  },
};

/** Map legacy and dynamic paths onto the public metadata keys above. */
export function metaKeyForPath(pathname) {
  const path = String(pathname || "").replace(/\/+$/, "") || "/";
  if (path === "/") return "home";
  if (path === "/live") return "live";
  if (/^\/(?:match|matches|summary)\/[^/]+/.test(path)) return "match";
  if (path === "/teams" || path.startsWith("/teams/")) return "teams";
  if (path === "/tournaments" || path === "/series" || path.startsWith("/series/")) return "tournaments";
  if (path === "/rankings") return "rankings";
  if (["/blogs", "/news", "/cricket-news"].includes(path)) return "blogs";
  if (path === "/about") return "about";
  if (path === "/contact") return "contact";
  if (path === "/privacy") return "privacy";
  if (path === "/terms") return "terms";
  return null;
}

function setMetaAttribute(selector, attribute, selectorCreate, content) {
  let element = document.querySelector(selector);
  if (!element && selectorCreate) {
    element = document.createElement(selectorCreate.tag);
    element.setAttribute(selectorCreate.attribute, selectorCreate.value);
    document.head.appendChild(element);
  }
  if (element) element.setAttribute(attribute, content);
}

/**
 * Sets document.title and the meta description, and hides the static crawler
 * fallback as soon as the React app mounts.
 */
export default function usePageMeta(key) {
  useEffect(() => {
    const fallback = document.getElementById("seo-fallback");
    if (fallback) {
      fallback.hidden = true;
      fallback.setAttribute("aria-hidden", "true");
    }

    const meta = PAGE_META[key];
    if (!meta) return;

    document.title = meta.title;
    setMetaAttribute('meta[name="description"]', "content", null, meta.description);
    setMetaAttribute(
      'link[rel="canonical"]',
      "href",
      { tag: "link", attribute: "rel", value: "canonical" },
      `${window.location.origin}${window.location.pathname}`,
    );
  }, [key]);
}
