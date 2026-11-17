// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sitemap = fs.readFileSync(path.join(currentDir, "public/sitemap.xml"), "utf8");
const routerSource = fs.readFileSync(path.join(currentDir, "src/App.jsx"), "utf8");
const robots = fs.readFileSync(path.join(currentDir, "public/robots.txt"), "utf8");

const routes = [...sitemap.matchAll(/<loc>https:\/\/cricall\.online([^<]*)<\/loc>/g)].map(
  (match) => match[1] || "/",
);

describe("public sitemap", () => {
  it("contains only routes that exist in the User router", () => {
    expect(routes.length).toBe(10);
    expect(new Set(routes).size).toBe(routes.length);
    for (const route of routes) {
      expect(routerSource).toContain(`path="${route}"`);
    }
  });

  it("is advertised in robots.txt", () => {
    expect(robots).toContain("Sitemap: https://cricall.online/sitemap.xml");
  });
});
