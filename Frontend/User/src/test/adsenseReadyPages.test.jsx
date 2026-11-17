import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import About from "../pages/About";
import Contact from "../pages/Contact";
import Terms from "../pages/Terms";
import Footer from "../components/Footer";
import usePageMeta, { PAGE_META, metaKeyForPath } from "../hooks/usePageMeta";

vi.mock("../hooks/useCricketProviderStatus", () => ({
  useCricketProviderStatus: () => null,
  isProviderConfigured: () => false,
}));

vi.mock("../components/InstallAppButton", () => ({ default: () => null }));

function MetaProbe({ path }) {
  usePageMeta(metaKeyForPath(path));
  return null;
}

describe("AdSense trust pages", () => {
  it.each([
    ["about", About, /about cricall/i],
    ["contact", Contact, /contact cricall/i],
    ["terms", Terms, /terms of use/i],
  ])("renders the %s main heading", (_name, Page, heading) => {
    render(
      <MemoryRouter>
        <Page />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
  });

  it("shows About, Contact, Privacy and Terms links in the legal footer nav", () => {
    render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>,
    );
    const legal = screen.getByRole("navigation", { name: /legal/i });
    const expected = {
      About: "/about",
      Contact: "/contact",
      Privacy: "/privacy",
      Terms: "/terms",
    };
    for (const [name, href] of Object.entries(expected)) {
      expect(within(legal).getByRole("link", { name })).toHaveAttribute("href", href);
    }
  });
});

describe("usePageMeta", () => {
  beforeEach(() => {
    document.head.innerHTML = '<meta name="description" content="" /><link rel="canonical" href="" />';
    document.body.innerHTML = '<div id="seo-fallback">Crawler links</div>';
    document.title = "Old title";
  });

  it("sets the route title and description and hides the static fallback", () => {
    render(<MetaProbe path="/about" />);
    expect(document.title).toBe(PAGE_META.about.title);
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute(
      "content",
      PAGE_META.about.description,
    );
    expect(document.getElementById("seo-fallback")).toHaveAttribute("hidden");
  });

  it("maps dynamic match paths and keeps metadata short and unique", () => {
    expect(metaKeyForPath("/match/123")).toBe("match");
    expect(metaKeyForPath("/series/premier-cup")).toBe("tournaments");
    const titles = Object.values(PAGE_META).map((meta) => meta.title);
    const descriptions = Object.values(PAGE_META).map((meta) => meta.description);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
    for (const meta of Object.values(PAGE_META)) {
      expect(meta.title.length).toBeLessThan(60);
      expect(meta.description.length).toBeLessThan(155);
    }
  });
});
