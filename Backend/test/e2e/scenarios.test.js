import test from "node:test";
import assert from "node:assert/strict";
import { SCENARIOS, parseOnly, makeSelection, rosterRange } from "./lib/scenarios.js";

/**
 * `E2E_ONLY` parsing.
 *
 * The defect this guards: `String("").split(",")` yields `[""]`, and
 * `Number("".trim())` is `0`, which passed `Number.isInteger` and reached the
 * roster check as scenario 0. So an *unset* E2E_ONLY - the ordinary way to run
 * the whole suite - threw "E2E_ONLY names scenario 0".
 *
 * Empty entries are now dropped before conversion, so validation only ever sees
 * a real token.
 */

const ALL = [1, 2, 3, 4, 5, 6, 7];
const selectionOf = (raw) => makeSelection(parseOnly(raw));

/** `assert.throws` returns undefined, so grab the message by hand. */
function messageFrom(fn) {
  try {
    fn();
  } catch (e) {
    return e.message;
  }
  throw new assert.AssertionError({ message: "expected the call to throw, but it returned" });
}

test("roster is 1-7 and contiguous", () => {
  assert.deepEqual(SCENARIOS.map((s) => s.n), ALL);
  assert.equal(rosterRange(), "1-7");
});

test("the roster and the runner's scenario titles agree", () => {
  // A duplicated roster would let a scenario be declared in one place and
  // filtered in another, which is how a check goes missing from the report.
  const titles = SCENARIOS.map((s) => s.title);
  assert.equal(new Set(titles).size, titles.length, "titles must be unique");
  for (const { n, title } of SCENARIOS) {
    assert.match(title, new RegExp(`^Scenario ${n} - `), `title must start with its own number`);
  }
});

test("unset E2E_ONLY runs every scenario", () => {
  for (const raw of [undefined, null]) {
    const sel = selectionOf(raw);
    assert.equal(sel.runAll, true);
    assert.deepEqual(sel.selected(), ALL);
    for (const n of ALL) assert.equal(sel.wantScenario(n), true);
  }
});

test("empty E2E_ONLY runs every scenario", () => {
  const sel = selectionOf("");
  assert.deepEqual(parseOnly(""), new Set());
  assert.equal(sel.runAll, true);
  assert.deepEqual(sel.selected(), ALL);
});

test("whitespace-only E2E_ONLY runs every scenario", () => {
  for (const raw of ["   ", "\t", "\n", " \t\n "]) {
    const sel = selectionOf(raw);
    assert.equal(sel.runAll, true, `${JSON.stringify(raw)} must mean "run all"`);
    assert.deepEqual(sel.selected(), ALL);
  }
});

test("a single scenario selects only that one", () => {
  const sel = selectionOf("1");
  assert.equal(sel.runAll, false);
  assert.deepEqual(sel.selected(), [1]);
  assert.equal(sel.wantScenario(1), true);
  assert.equal(sel.wantScenario(2), false);
  assert.equal(sel.wantScenario(7), false);
});

test("several scenarios select only those, in roster order", () => {
  const sel = selectionOf("1,2");
  assert.deepEqual(sel.selected(), [1, 2]);
  assert.equal(sel.wantScenario(3), false);

  // Order in the value does not change the reported order.
  assert.deepEqual(selectionOf("7,1").selected(), [1, 7]);

  // Duplicates collapse.
  assert.deepEqual(parseOnly("1,1,2"), new Set([1, 2]));
});

test("E2E_ONLY=0 is rejected, not read as a scenario", () => {
  assert.throws(() => parseOnly("0"), /E2E_ONLY contains "0"/);
  assert.throws(() => parseOnly("0"), /numbering starts at 1/);
});

test("E2E_ONLY=abc is rejected as not a whole number", () => {
  assert.throws(() => parseOnly("abc"), /E2E_ONLY contains "abc"/);
  assert.throws(() => parseOnly("abc"), /not a whole number/);
});

test("a scenario outside the roster is rejected and names the range", () => {
  assert.throws(() => parseOnly("9"), /E2E_ONLY contains "9"/);
  assert.throws(() => parseOnly("9"), /not in the roster \(1-7\)/);
  assert.throws(() => parseOnly("1,9"), /not in the roster \(1-7\)/);
  // Negative and fractional values are rejected too.
  assert.throws(() => parseOnly("-1"), /numbering starts at 1/);
  assert.throws(() => parseOnly("1.5"), /not a whole number/);
});

test("empty entries between commas are ignored, not rejected", () => {
  const sel = selectionOf("1,,2");
  assert.deepEqual(parseOnly("1,,2"), new Set([1, 2]));
  assert.deepEqual(sel.selected(), [1, 2]);

  // Leading and trailing commas are just more empty entries.
  assert.deepEqual(parseOnly(",1,2,"), new Set([1, 2]));
  assert.deepEqual(parseOnly(",,,"), new Set());
  // A run of separators and whitespace is still "run everything".
  assert.equal(selectionOf(" , , ").runAll, true);
});

test("surrounding whitespace on real tokens is trimmed", () => {
  assert.deepEqual(parseOnly(" 1 , 2 "), new Set([1, 2]));
  assert.deepEqual(selectionOf(" 1 , 2 ").selected(), [1, 2]);
});

test("the error message points at the valid values", () => {
  // The old message rendered the roster as "1-1,2,3,4,5,6,7".
  const message = messageFrom(() => parseOnly("abc"));
  assert.ok(!message.includes("1-1,2"), `range must not be malformed: ${message}`);
  assert.match(message, /1, 2, 3, 4, 5, 6, 7/);
  assert.match(message, /leaving E2E_ONLY unset runs every scenario/);
});

test("a rejected value stops the run rather than silently running everything", () => {
  // Silently falling back to "run all" on a typo would be worse than failing:
  // the operator thinks they ran one scenario and the report says otherwise.
  assert.throws(() => selectionOf("1, typo"));
  assert.throws(() => selectionOf("0"));
});
