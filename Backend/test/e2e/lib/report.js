/**
 * Result collection and Markdown rendering for the E2E suite.
 *
 * Four outcome kinds, kept distinct on purpose:
 *   PASS        the assertion held
 *   FAIL        the assertion did not hold - a defect or a broken environment
 *   DIVERGENCE  the independent tally and the server disagree; that is a
 *               finding about the product, not about the harness
 *   SKIPPED     the scenario never ran, so its assertions are absent. This is
 *               not a pass. It is recorded as its own outcome so a partial run
 *               can never be read as a complete one.
 *
 * The writer is deliberately unforgiving: a check addressed to a section that
 * was never opened throws instead of landing in the last section. A silently
 * mis-filed assertion is a report that lies about which scenario proved what.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function createReport({ scenarios = [], selected = null, canonicalPath = null } = {}) {
  const sections = [];
  const declared = new Map(scenarios.map((s) => [s.title, s.n]));

  /** Every scenario in the roster, whether or not it produced a section. */
  const skippedScenarios = () => {
    if (!declared.size) return [];
    return scenarios
      .filter((s) => !sections.some((x) => x.title === s.title))
      .map((s) => ({
        n: s.n,
        title: s.title,
        // A scenario the run *selected* but that produced nothing is a harness
        // bug, not a deliberate skip. Say so, loudly.
        reason: selected && !selected.has(s.n)
          ? "not selected by E2E_ONLY"
          : "selected by this run but produced no section - the scenario body did not execute",
      }));
  };

  const isPartial = () => skippedScenarios().length > 0;

  const openSection = (sectionTitle, method) => {
    if (declared.size && !declared.has(sectionTitle)) {
      throw new Error(
        `report.${method}: unknown scenario title ${JSON.stringify(sectionTitle)}. ` +
          `Declare it in SCENARIOS so skipped scenarios are still reported.`,
      );
    }
    const s = sections.find((x) => x.title === sectionTitle);
    if (!s) {
      throw new Error(
        `report.${method}: no open section titled ${JSON.stringify(sectionTitle)}. ` +
          `Call report.section() for it first.`,
      );
    }
    return s;
  };

  return {
    sections,

    section(title, note = "") {
      if (declared.size && !declared.has(title)) {
        throw new Error(
          `report.section: unknown scenario title ${JSON.stringify(title)}. ` +
            `Declare it in SCENARIOS first.`,
        );
      }
      if (sections.some((x) => x.title === title)) {
        throw new Error(`report.section: section ${JSON.stringify(title)} opened twice.`);
      }
      sections.push({ title, note, checks: [] });
      return sections[sections.length - 1];
    },

    /** Records a boolean assertion. */
    check(sectionTitle, name, passed, detail = "") {
      openSection(sectionTitle, "check").checks.push({ kind: passed ? "PASS" : "FAIL", name, detail });
      return passed;
    },

    /** Records an independent-tally vs server comparison. */
    diff(sectionTitle, name, divergences) {
      openSection(sectionTitle, "diff").checks.push({
        kind: divergences.length === 0 ? "PASS" : "DIVERGENCE",
        name,
        detail: divergences.length === 0 ? "independent tally and server agree" : "",
        divergences,
      });
      return divergences.length === 0;
    },

    note(sectionTitle, text) {
      const s = openSection(sectionTitle, "note");
      s.note = s.note ? `${s.note}\n${text}` : text;
    },

    skippedScenarios,
    isPartial,

    counts() {
      const tally = { PASS: 0, FAIL: 0, DIVERGENCE: 0 };
      for (const s of sections) for (const c of s.checks) tally[c.kind] += 1;
      return tally;
    },

    /**
     * A run that skipped a scenario has not passed the suite. `PARTIAL` is a
     * distinct outcome precisely so it cannot be quoted as a clean pass.
     */
    overall() {
      const t = this.counts();
      if (t.FAIL > 0) return "FAIL";
      if (t.DIVERGENCE > 0) return "PASS_WITH_FINDINGS";
      if (isPartial()) return "PARTIAL";
      return "PASS";
    },

    /** Scenarios that ran, for the header and for the log line. */
    coverage() {
      const ran = sections.length;
      const skipped = skippedScenarios().length;
      return { ran, skipped, total: declared.size || sections.length };
    },

    toMarkdown({ apiBase, runId, durationMs, extra = "" }) {
      const t = this.counts();
      const cov = this.coverage();
      const skipped = skippedScenarios();
      const out = [];
      out.push("# E2E Results - Local Only");
      out.push("");
      out.push(`- Run id: \`${runId}\``);
      out.push(`- API base: \`${apiBase}\` (loopback only - guard enforced)`);
      out.push("- Database: `cric-all-e2e` on `127.0.0.1:27017` (local Docker Mongo)");
      out.push(`- Duration: ${(durationMs / 1000).toFixed(1)}s`);
      out.push(
        `- Scenarios: ${cov.ran} of ${cov.total} ran` +
          (cov.skipped ? `, **${cov.skipped} skipped**` : ""),
      );
      out.push(`- Overall: **${this.overall()}** (${t.PASS} pass, ${t.FAIL} fail, ${t.DIVERGENCE} divergence)`);
      out.push("");

      if (skipped.length) {
        out.push("> ## PARTIAL RUN - this is not a pass");
        out.push(">");
        out.push(
          `> ${skipped.length} of ${cov.total} scenarios did not run. Their assertions are ` +
            "**absent from this report**, not passing. A full-suite number is not derived from this file.",
        );
        out.push(">");
        for (const s of skipped) {
          out.push(`> - **${s.title}** - ${s.reason}`);
        }
        out.push("");
      }

      if (declared.size) {
        out.push("## Scenario coverage");
        out.push("");
        out.push("Every scenario in the roster appears here, including the ones that did not run.");
        out.push("");
        out.push("| Scenario | Status | Checks |");
        out.push("| --- | --- | --- |");
        for (const s of sections) {
          out.push(`| ${s.title} | ran | ${s.checks.length} |`);
        }
        for (const s of skipped) {
          out.push(`| ${s.title} | **SKIPPED** - ${s.reason} | 0 |`);
        }
        out.push(`| **Total** | ${cov.ran} ran, ${cov.skipped} skipped | **${t.PASS + t.FAIL + t.DIVERGENCE}** |`);
        out.push("");
      }

      out.push(
        "Every score below was produced by sending balls to `POST /api/matches/:id/score`",
      );
      out.push("as the invited `score_handler`. No result was inserted into MongoDB. The expected");
      out.push("scorecard comes from a tally written from the Laws of Cricket that shares no code");
      out.push("with `ScoringEngine`; agreement between the two is a real cross-check.");
      out.push("");
      out.push(extra);
      out.push("");

      for (const s of sections) {
        out.push(`## ${s.title}`);
        out.push("");
        if (s.note) {
          out.push(s.note);
          out.push("");
        }
        if (s.checks.length === 0) {
          out.push("_No checks recorded._");
          out.push("");
          continue;
        }
        out.push("| Result | Check | Detail |");
        out.push("| --- | --- | --- |");
        for (const c of s.checks) {
          const detail = (c.detail || "").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
          out.push(`| ${c.kind} | ${c.name} | ${detail} |`);
        }
        out.push("");

        const withDivergences = s.checks.filter((c) => c.divergences?.length);
        if (withDivergences.length) {
          out.push("### Divergence detail");
          out.push("");
          for (const c of withDivergences) {
            out.push(`**${c.name}**`);
            out.push("");
            out.push("| Field | Independent tally | Server |");
            out.push("| --- | --- | --- |");
            for (const d of c.divergences) {
              out.push(`| \`${d.field}\` | ${JSON.stringify(d.independent)} | ${JSON.stringify(d.server)} |`);
            }
            out.push("");
          }
        }
      }

      out.push("## Laws applied by the independent tally");
      out.push("");
      out.push("- A legal delivery is anything that is not a Wide or a No-ball (byes and leg-byes are legal).");
      out.push("- A wide is one extra, plus any runs the batters completed.");
      out.push("- A No-ball is one extra, plus runs off the bat credited to the batter.");
      out.push("- Byes and leg-byes are run by the fielders, so an odd number does not change the strike.");
      out.push("- A run-out is not charged to the bowler.");
      out.push("- Six legal deliveries make an over and the ends change at the end of it.");
      out.push("- On a free hit only a run-out, obstructing the field, or hit twice can dismiss.");
      out.push("");

      return out.join("\n");
    },

    /**
     * Refuses to let a partial run become the canonical report, unless the
     * caller opts in. A partial run may always be written somewhere else, so
     * iteration is unaffected - what is protected is the project's evidence
     * file, which must be the product of a full-suite run.
     */
    write(path, meta) {
      const target = String(path);
      const isCanonical = canonicalPath && target.replace(/\\/g, "/") === String(canonicalPath).replace(/\\/g, "/");
      if (isCanonical && isPartial() && !meta?.allowPartial) {
        const cov = this.coverage();
        throw new Error(
          `Refusing to write a PARTIAL report to ${target}: ${cov.ran} of ${cov.total} scenarios ran ` +
            `(${skippedScenarios()
              .map((s) => s.n)
              .join(", ")} skipped). The canonical report is the record of a full-suite run, and a ` +
            `partial run would silently drop ${skippedScenarios().length} scenarios' assertions from it. ` +
            `Re-run without E2E_ONLY, or send this run elsewhere with E2E_RESULTS_PATH=<path>, or set ` +
            `E2E_ALLOW_PARTIAL_REPORT=1 to overwrite on purpose.`,
        );
      }
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, this.toMarkdown(meta), "utf8");
      return target;
    },
  };
}
