// T2.2 (B24): rules for the readable UI tokens in Frontend/Shared/styles/theme.css.
// Reads the CSS file itself, so the checks hold for both apps that import it.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// jsdom replaces the global URL, so build the path from the file URL string.
const THEME_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../Shared/styles/theme.css");
const SECTION_MARKER = "Readable UI (T2.2)";
const ROOT_FONT_PX = 16;

const css = readFileSync(THEME_PATH, "utf8");

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

// Small brace-aware parser: enough for theme.css (no strings or urls with braces).
function parseRules(source) {
  const rules = [];
  const stack = [];
  let buffer = "";
  for (const ch of stripComments(source)) {
    if (ch === "{") {
      stack.push(buffer.trim());
      buffer = "";
    } else if (ch === "}") {
      const selector = stack.pop();
      const body = buffer.trim();
      if (body && selector && !selector.startsWith("@")) {
        rules.push({ selector, context: [...stack], declarations: parseDeclarations(body) });
      }
      buffer = "";
    } else {
      buffer += ch;
    }
  }
  return rules;
}

function parseDeclarations(body) {
  return body
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const colon = part.indexOf(":");
      const property = part.slice(0, colon).trim();
      let value = part.slice(colon + 1).trim();
      const important = /!important$/.test(value);
      value = value.replace(/\s*!important$/, "");
      return { property, value, important };
    });
}

// Split "a, b:is(c, d)" into ["a", "b:is(c, d)"]: only commas outside brackets.
function splitSelectorList(selector) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of selector) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current.trim());
  return parts;
}

function tokensFor(rules, selector) {
  const tokens = {};
  for (const rule of rules) {
    if (rule.selector !== selector || rule.context.length) continue;
    for (const { property, value } of rule.declarations) {
      if (property.startsWith("--")) tokens[property] = value;
    }
  }
  return tokens;
}

const allRules = parseRules(css);
const lightTokens = tokensFor(allRules, ":root");
// `.dark` sits on <html>, so tokens it does not override keep their :root value.
const darkTokens = { ...lightTokens, ...tokensFor(allRules, ".dark") };

const sectionStart = css.indexOf(SECTION_MARKER);
const sectionRules = sectionStart === -1 ? [] : parseRules(css.slice(css.lastIndexOf("/*", sectionStart)));

function resolve(value, tokens, seen = new Set()) {
  return value.replace(/var\((--[\w-]+)\s*(?:,\s*([^)]+))?\)/g, (_, name, fallback) => {
    if (seen.has(name)) throw new Error(`Circular token ${name}`);
    if (tokens[name] === undefined) {
      if (fallback !== undefined) return fallback.trim();
      throw new Error(`Undefined token ${name}`);
    }
    return resolve(tokens[name], tokens, new Set([...seen, name]));
  });
}

function toPx(value) {
  const match = /^(-?\d*\.?\d+)(px|rem)?$/.exec(value.trim());
  if (!match) throw new Error(`Cannot read "${value}" as a size; use px or rem`);
  const n = Number(match[1]);
  return match[2] === "rem" ? n * ROOT_FONT_PX : n;
}

function hexToRgb(hex) {
  const clean = hex.trim().replace(/^#/, "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`Colour pairs must be solid hex colours, got "${hex}"`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// [foreground, background]: every place a new component puts one colour on another.
const COLOUR_PAIRS = [
  ["--ui-text", "--ui-bg"],
  ["--ui-text", "--ui-surface"],
  ["--ui-text-muted", "--ui-bg"],
  ["--ui-text-muted", "--ui-surface"],
  ["--ui-on-primary", "--ui-primary"],
  ["--ui-on-success", "--ui-success"],
  ["--ui-on-danger", "--ui-danger"],
  ["--ui-on-disabled", "--ui-disabled"],
  ["--ui-danger", "--ui-surface"],
  ["--ui-danger", "--ui-bg"],
  ["--ui-success", "--ui-surface"],
  ["--ui-success", "--ui-bg"],
  ["--ui-border", "--ui-surface"],
  ["--ui-border", "--ui-bg"],
  ["--ui-focus", "--ui-surface"],
  ["--ui-focus", "--ui-bg"],
];

describe("readable UI section in theme.css", () => {
  it("exists, marked for T2.2", () => {
    expect(sectionStart).toBeGreaterThan(-1);
    expect(sectionRules.length).toBeGreaterThan(0);
  });

  it("only styles .ui- classes and only adds --ui- tokens, so existing pages look the same", () => {
    for (const rule of sectionRules) {
      if (rule.selector === ":root" || rule.selector === ".dark") {
        for (const { property } of rule.declarations) expect(property, rule.selector).toMatch(/^--ui-/);
        continue;
      }
      for (const part of splitSelectorList(rule.selector)) expect(part, rule.selector).toContain(".ui-");
    }
  });

  it("keeps the existing --cric-* colours exactly as they ship today", () => {
    const pick = (tokens) => Object.fromEntries(Object.entries(tokens).filter(([k]) => k.startsWith("--cric-")));
    expect(pick(lightTokens)).toEqual({
      "--cric-bg": "#f8fafc",
      "--cric-card": "#ffffff",
      "--cric-accent": "#ff6b35",
      "--cric-text": "#0f172a",
      "--cric-muted": "#64748b",
      "--cric-border": "#e2e8f0",
    });
    expect(pick(tokensFor(allRules, ".dark"))).toEqual({
      "--cric-bg": "#0a0e14",
      "--cric-card": "#141b24",
      "--cric-accent": "#ff6b35",
      "--cric-text": "#e2e8f0",
      "--cric-muted": "#94a3b8",
      "--cric-border": "rgba(255, 255, 255, 0.08)",
    });
  });
});

describe("colour tokens (WCAG 2.2 AA, 4.5:1)", () => {
  for (const [themeName, tokens] of [["light", lightTokens], ["dark", darkTokens]]) {
    for (const [fg, bg] of COLOUR_PAIRS) {
      it(`${themeName}: ${fg} on ${bg} is at least 4.5:1`, () => {
        const ratio = contrast(resolve(`var(${fg})`, tokens), resolve(`var(${bg})`, tokens));
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("light theme uses the colours named in 03-UI-UX section 4", () => {
    expect(lightTokens["--ui-primary"].toLowerCase()).toBe("#c2410c");
    expect(lightTokens["--ui-on-primary"].toLowerCase()).toBe("#ffffff");
    expect(lightTokens["--ui-success"].toLowerCase()).toBe("#15803d");
    expect(lightTokens["--ui-danger"].toLowerCase()).toBe("#b91c1c");
  });

  it("dark theme keeps the brand orange with dark text (6.82:1)", () => {
    expect(darkTokens["--ui-primary"].toLowerCase()).toBe("#ff6b35");
    expect(darkTokens["--ui-on-primary"].toLowerCase()).toBe("#0a0e14");
  });

  it("every colour token a .ui- rule uses is defined in both themes", () => {
    for (const rule of sectionRules) {
      for (const { value } of rule.declarations) {
        expect(() => resolve(value, lightTokens), `${rule.selector}: ${value}`).not.toThrow();
        expect(() => resolve(value, darkTokens), `${rule.selector}: ${value}`).not.toThrow();
      }
    }
  });
});

describe("text size tokens", () => {
  const fontSizeTokens = Object.entries(lightTokens).filter(([name]) => name.startsWith("--ui-font-size-"));

  it("defines body 16px, smallest 14px, Urdu help 15px and score 40px+", () => {
    expect(toPx(resolve("var(--ui-font-size-body)", lightTokens))).toBe(16);
    expect(toPx(resolve("var(--ui-font-size-small)", lightTokens))).toBe(14);
    expect(toPx(resolve("var(--ui-font-size-urdu)", lightTokens))).toBe(15);
    expect(toPx(resolve("var(--ui-font-size-score)", lightTokens))).toBeGreaterThanOrEqual(40);
    expect(Number(resolve("var(--ui-line-height-urdu)", lightTokens))).toBe(1.8);
  });

  it("has no font-size token below 14px", () => {
    expect(fontSizeTokens.length).toBeGreaterThan(3);
    for (const [name, value] of fontSizeTokens) {
      expect(toPx(resolve(value, lightTokens)), name).toBeGreaterThanOrEqual(14);
    }
  });

  it("every font-size in a .ui- rule is 14px or more and !important", () => {
    // Both apps' index.css force `button, input, p, li ...` to 11px with
    // !important at 360px wide. The new components must not shrink with them.
    const sizes = sectionRules.flatMap((rule) =>
      rule.declarations.filter((d) => d.property === "font-size").map((d) => ({ ...d, selector: rule.selector })),
    );
    expect(sizes.length).toBeGreaterThan(0);
    for (const { selector, value, important } of sizes) {
      expect(toPx(resolve(value, lightTokens)), selector).toBeGreaterThanOrEqual(14);
      expect(important, `${selector} font-size needs !important`).toBe(true);
    }
  });

  it("never uppercases text or spreads letters", () => {
    for (const rule of sectionRules) {
      for (const { property, value } of rule.declarations) {
        if (property === "text-transform") expect(value, rule.selector).not.toMatch(/uppercase/);
        if (property === "letter-spacing") expect(value, rule.selector).toMatch(/^(normal|0)$/);
      }
    }
  });
});

describe("tap target tokens", () => {
  const px = (name) => toPx(resolve(`var(${name})`, lightTokens));
  const declared = (selector, property) => {
    const rule = sectionRules.find((r) => r.selector === selector && !r.context.length);
    const decl = rule?.declarations.find((d) => d.property === property);
    if (!decl) throw new Error(`${selector} has no ${property}`);
    return toPx(resolve(decl.value, lightTokens));
  };

  it("defines 48px targets, 56px buttons and fields, 64px scoring pad, 8px gap", () => {
    expect(px("--ui-target-min")).toBeGreaterThanOrEqual(48);
    expect(px("--ui-button-height")).toBeGreaterThanOrEqual(56);
    expect(px("--ui-field-height")).toBeGreaterThanOrEqual(56);
    expect(px("--ui-pad-height")).toBeGreaterThanOrEqual(64);
    expect(px("--ui-gap")).toBe(8);
  });

  it("BigButton and Field controls use them", () => {
    expect(declared(".ui-button", "min-height")).toBeGreaterThanOrEqual(56);
    expect(declared(".ui-button", "min-width")).toBeGreaterThanOrEqual(48);
    expect(declared(".ui-button--pad", "min-height")).toBeGreaterThanOrEqual(64);
    expect(declared(".ui-field__control", "min-height")).toBeGreaterThanOrEqual(48);
  });
});
