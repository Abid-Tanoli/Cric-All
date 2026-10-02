/**
 * The E2E scenario roster and the `E2E_ONLY` selector.
 *
 * This is the single source of truth for both. The runner and the report writer
 * are both told about the roster up front, so a scenario that is filtered out
 * is rendered as SKIPPED rather than quietly disappearing.
 */

/**
 * The roster, in the order the scenarios run.
 */
export const SCENARIOS = [
  { n: 1, title: "Scenario 1 - full T20 innings (20 overs, every ball type) and the chase" },
  { n: 2, title: "Scenario 2 - free hit (a no-ball must protect the next delivery)" },
  { n: 3, title: "Scenario 3 - innings bowled out inside the overs" },
  { n: 4, title: "Scenario 4 - tie, then Super Over" },
  { n: 5, title: "Scenario 5 - negative tests (HTTP authorization and Laws)" },
  { n: 6, title: "Scenario 6 - negative tests (Socket.IO cannot score)" },
  { n: 7, title: "Scenario 7 - other Match.matchType formats" },
];

const rosterNumbers = () => SCENARIOS.map((s) => s.n).sort((a, b) => a - b);
const knownNumbers = new Set(SCENARIOS.map((s) => s.n));

/** `1-7` when the roster is contiguous, otherwise the explicit list. */
export function rosterRange() {
  const nums = rosterNumbers();
  const min = nums[0];
  const max = nums[nums.length - 1];
  return max - min + 1 === nums.length ? `${min}-${max}` : nums.join(", ");
}

const listAll = () => rosterNumbers().join(", ");

function reject(token, problem) {
  throw new Error(
    `E2E_ONLY contains ${JSON.stringify(token)}, ${problem}. ` +
      `Expected a comma-separated list of scenario numbers: ${listAll()}. ` +
      `Empty entries are ignored, and leaving E2E_ONLY unset runs every scenario.`,
  );
}

/**
 * Parses `E2E_ONLY` into the set of scenarios to run.
 *
 * An unset, empty, or whitespace-only value means "run everything" and yields an
 * empty set - which is exactly how `wantScenario` is defined to behave.
 *
 * Empty entries *between* commas are ignored, so `1,,2` is the same as `1,2`.
 * Validation applies only to non-empty entries, and rejects a token that is not
 * a positive integer in the roster. That means `""` can never be read as `0`.
 *
 * @param {string|undefined|null} raw   the raw environment value
 * @returns {Set<number>}               scenario numbers to run; empty means all
 */
export function parseOnly(raw) {
  const tokens = String(raw ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token !== "");

  const only = new Set();

  for (const token of tokens) {
    const n = Number(token);

    if (!Number.isInteger(n)) reject(token, "which is not a whole number");
    if (n <= 0) reject(token, `but scenario numbering starts at ${rosterNumbers()[0]}`);
    if (!knownNumbers.has(n)) reject(token, `which is not in the roster (${rosterRange()})`);

    only.add(n);
  }

  return only;
}

/**
 * Builds the `wantScenario` predicate and the ordered selection for a parsed
 * `E2E_ONLY` set. `wantScenario(n)` is true for every roster entry when the set
 * is empty.
 */
export function makeSelection(only) {
  const runAll = only.size === 0;
  return {
    runAll,
    wantScenario: (n) => runAll || only.has(n),
    selected: () => SCENARIOS.filter((s) => runAll || only.has(s.n)).map((s) => s.n),
  };
}
