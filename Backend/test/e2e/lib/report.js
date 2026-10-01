/**
 * Result collection and Markdown rendering for the E2E suite.
 *
 * Three outcome kinds, kept distinct on purpose:
 *   PASS        the assertion held
 *   FAIL        the assertion did not hold - a defect or a broken environment
 *   DIVERGENCE  the independent tally and the server disagree; that is a
 *               finding about the product, not about the harness
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function createReport() {
  const checks = [];
  const sections = [];

  return {
    sections,

    section(title, note = "") {
      sections.push({ title, note, checks: [] });
      return sections[sections.length - 1];
    },

    /** Records a boolean assertion. */
    check(sectionTitle, name, passed, detail = "") {
      const s = sections.find((x) => x.title === sectionTitle) || sections[sections.length - 1];
      s.checks.push({ kind: passed ? "PASS" : "FAIL", name, detail });
      return passed;
    },

    /** Records an independent-tally vs server comparison. */
    diff(sectionTitle, name, divergences) {
      const s = sections.find((x) => x.title === sectionTitle) || sections[sections.length - 1];
      s.checks.push({
        kind: divergences.length === 0 ? "PASS" : "DIVERGENCE",
        name,
        detail: divergences.length === 0 ? "independent tally and server agree" : "",
        divergences,
      });
      return divergences.length === 0;
    },

    note(sectionTitle, text) {
      const s = sections.find((x) => x.title === sectionTitle) || sections[sections.length - 1];
      s.note = s.note ? `${s.note}\n${text}` : text;
    },

    counts() {
      const tally = { PASS: 0, FAIL: 0, DIVERGENCE: 0 };
      for (const s of sections) for (const c of s.checks) tally[c.kind] += 1;
      return tally;
    },

    overall() {
      const t = this.counts();
      return t.FAIL === 0 ? (t.DIVERGENCE === 0 ? "PASS" : "PASS_WITH_FINDINGS") : "FAIL";
    },

    toMarkdown({ apiBase, runId, durationMs, extra = "" }) {
      const t = this.counts();
      const out = [];
      out.push("# E2E Results - Local Only");
      out.push("");
      out.push(`- Run id: \`${runId}\``);
      out.push(`- API base: \`${apiBase}\` (loopback only - guard enforced)`);
      out.push(`- Database: \`cric-all-e2e\` on \`127.0.0.1:27017\` (local Docker Mongo)`);
      out.push(`- Duration: ${(durationMs / 1000).toFixed(1)}s`);
      out.push(`- Overall: **${this.overall()}** (${t.PASS} pass, ${t.FAIL} fail, ${t.DIVERGENCE} divergence)`);
      out.push("");
      out.push("Every score below was produced by sending balls to `POST /api/matches/:id/score`");
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
      out.push("- A Wide is one extra, plus any runs the batters completed.");
      out.push("- A No-ball is one extra, plus runs off the bat credited to the batter.");
      out.push("- Byes and leg-byes are run by the fielders, so an odd number does not change the strike.");
      out.push("- A run-out is not charged to the bowler.");
      out.push("- Six legal deliveries make an over and the ends change at the end of it.");
      out.push("- On a free hit only a run-out, obstructing the field, or hit twice can dismiss.");
      out.push("");

      return out.join("\n");
    },

    write(path, meta) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, this.toMarkdown(meta), "utf8");
      return path;
    },
  };
}
