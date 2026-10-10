import fetch from "node-fetch";
import Anthropic from '@anthropic-ai/sdk';
import { getPlatformSettings } from "../models/SystemSettings.js";

// ─── AI KILL SWITCH (Terminal A, oct11-A) ────────────────────────
//
// Every paid model call in this module is gated on the platform's
// `aiCommentaryEnabled` flag, so a superadmin can stop AI commentary entirely
// (for example to cap spend during a live tournament) without a redeploy. The
// template commentary in `buildStructuredCommentary` is pure and always runs,
// so turning AI off degrades to the structured text rather than to nothing.
//
// The flag defaults to OFF. Only two things can enable it:
//   1. an explicit `AI_COMMENTARY_ENABLED=true` at first boot (the value the
//      settings document is seeded from), or
//   2. a superadmin flipping the Sync Panel toggle at runtime.
// Any other state (env unset, field missing, fresh database) reads as off, so a
// tournament cannot accrue model spend by accident.
//
// The flag is cached briefly because `generateBallCommentary` is called once per
// delivery and a database round-trip on every ball is not worth it; a 10s stale
// window is invisible to an operator flipping the switch.
let _aiFlagCache = { value: null, at: 0 };
const AI_FLAG_TTL_MS = 10000;

export async function isAiCommentaryEnabled() {
  const now = Date.now();
  if (_aiFlagCache.value !== null && now - _aiFlagCache.at < AI_FLAG_TTL_MS) {
    return _aiFlagCache.value;
  }
  let enabled;
  try {
    const settings = await getPlatformSettings();
    // Opt-in only: a missing/undefined flag is "off", not "on".
    enabled = settings?.aiCommentaryEnabled === true;
  } catch {
    // If settings cannot be read, fall back to the env default rather than
    // silently disabling (which would look like "AI broke"). The env default is
    // also off unless AI_COMMENTARY_ENABLED is explicitly "true".
    enabled = String(process.env.AI_COMMENTARY_ENABLED ?? "false").toLowerCase() === "true";
  }
  _aiFlagCache.value = enabled;
  _aiFlagCache.at = now;
  return enabled;
}

// Test hook: let a test force the cached value without hitting the database.
export function __setAiCommentaryEnabledForTests(value) {
  _aiFlagCache = { value, at: Date.now() };
}

// ─── LABEL MAPS ──────────────────────────────────────────────────

const LINE_LABELS = {
  wide_outside_off: "wide outside off",
  outside_off: "outside off",
  off_stump: "on off stump",
  middle_stump: "on middle stump",
  leg_stump: "on leg stump",
  outside_leg: "outside leg",
  wide_outside_leg: "wide down leg",
};
const LENGTH_LABELS = {
  full_toss: "Full toss",
  yorker: "Yorker",
  full: "Full",
  good_length: "Good length",
  hard_length: "Hard length",
  short: "Short",
  bouncer: "Bouncer",
};
const MOVEMENT_LABELS = {
  inswing: "swinging in",
  outswing: "swinging away",
  "off-cutter": "cutting back off the seam",
  "leg-cutter": "cutting away",
  "seam-movement": "moving off the seam",
  googly: "turning in (googly)",
  "leg-spin": "turning away",
  "off-spin": "turning in",
  doosra: "going the other way (doosra)",
  flipper: "skidding through (flipper)",
};
const RUN_OUTCOME = {
  0: "no run",
  1: "1 run",
  2: "2 runs",
  3: "3 runs",
  4: "FOUR!",
  6: "SIX!",
};
const WICKET_WORDS = {
  bowled: "BOWLED HIM! The stumps are shattered!",
  caught: "CAUGHT! Straight to the fielder!",
  lbw: "LBW! Struck in front, given out!",
  "run-out": "RUN OUT! Direct hit!",
  stumped: "STUMPED! The keeper whips the bails off!",
  "hit-wicket": "HIT WICKET! Knocks the stumps over!",
};

// ─── TEMPLATE VARIATION HELPERS ───────────────────────────────────

const _pick = (arr, seed) => arr[Math.abs([...(seed || "")].reduce((a, c) => a + c.charCodeAt(0), 0)) % arr.length];

const DOT_ENDINGS = [
  "dot ball, tight bowling.",
  "no run, well bowled.",
  "good defence from the batter.",
  "nothing doing, played back to the bowler.",
  "safely defended on the front foot.",
  "dot ball, building pressure.",
  "dead bat, no run.",
  "pushed back down the pitch, no run.",
];
const BOUNDARY_OPENERS = [
  "That raced away to the fence!",
  "Clean strike through the line!",
  "Elegant shot, timed perfectly!",
  "CRACK! Sweet sound off the middle!",
  "That's timed beautifully, no chance for the fielder!",
  "Superb placement, finds the gap!",
  "Thumped through the covers, FOUR!",
];
const SIX_OPENERS = [
  "BIG! Gone all the way into the stands!",
  "Clears the ropes with absolute ease!",
  "Launched into the crowd, massive hit!",
  "Maximum! That is out of here!",
  "That's a massive hit, straight into the stratosphere!",
  "Into the stands! The crowd goes wild!",
  "Flat and hard, clean over the rope!",
];
const SINGLE_OPENERS = [
  "Quick single, well judged.",
  "Pushed into the gap for a single.",
  "Rotates the strike, easy single.",
  "One run, good running between the wickets.",
  "Tapped softly, they take the single.",
  "Works it into the leg side for one.",
];
const DOUBLE_OPENERS = [
  "Two runs! Excellent running, come back for the second.",
  "Nicely placed, they scamper back for two.",
  "Good running, they push for the second and make it comfortably.",
  "Two! Punched through the gap and they return for the second.",
  "They turn for two, alert running from both batters.",
];
const TRIPLE_OPENERS = [
  "Three runs! Brilliant running, they push hard for the third.",
  "Excellent placement and even better running — three taken!",
  "THREE! They keep the scoreboard ticking with smart running.",
  "Gap found, they run hard and convert into three.",
];
const MISSED_SHOTS = [
  "beaten by the movement outside off!",
  "plays and misses, close call!",
  "through to the keeper, beaten all ends up.",
  "pushes forward but beaten on the outside edge.",
  "fends at it but the ball zips past the bat.",
  "caught in two minds, the ball sails past the edge.",
];
const PRESSURE_PHRASES = [
  "Pressure building here in the middle.",
  "Drama on the field at a crucial stage!",
  "Tension is rising, every ball matters now.",
  "The crowd senses a big moment brewing.",
  "This is a crucial phase of the match.",
  "The game hanging in the balance here.",
  "Big moment in the match, all eyes on the middle.",
];
const APPEAL_PHRASES = [
  "Huge appeal from the fielding side!",
  "The fielders go up in unison!",
  "Appeal turned down, umpire not interested.",
  "Close call! The umpire says not out.",
  "Loud shout! The keeper joins in the appeal.",
];

const labelize = (value) =>
  String(value || "")
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

const lookup = (map, value, fallback) => map[value] || labelize(value) || fallback;

// ─── STRUCTURED COMMENTARY BUILDER ───────────────────────────────

function buildStructuredCommentary(data) {
  const {
    runs = 0,
    isWide = false,
    isNoBall = false,
    isBye = false,
    isLegBye = false,
    isFreeHit = false,
    isWicket = false,
    wicketType = "",
    wicketCancelled = false,
    freeHitNext = false,
    batsmanName = "Batsman",
    bowlerName = "Bowler",
    pitchLine = "",
    pitchLength = "",
    ballMovement = "none",
    shotType = "",
    shotName = "",
    shotDirection = "",
    direction = "",
    side = "",
    fieldingZone = "",
    nearestPosition = "",
    zone = "",
    isAppeal = false,
  } = data;

  const shotTypeFinal = shotType || shotName || "shot";
  const dir = shotDirection || direction || side || fieldingZone || nearestPosition || zone || "the outfield";
  const lineText = lookup(LINE_LABELS, pitchLine, "on the stumps");
  const lengthText = lookup(LENGTH_LABELS, pitchLength, "Good length");
  const moveText =
    !ballMovement || ballMovement === "none"
      ? "straight delivery"
      : lookup(MOVEMENT_LABELS, ballMovement, ballMovement.replace(/_/g, " "));
  const shotText = shotTypeFinal && shotTypeFinal !== "shot" ? labelize(shotTypeFinal) : "shot";
  const outcomeText = wicketCancelled
    ? "no ball, wicket cancelled"
    : isWicket
      ? lookup(WICKET_WORDS, normalizeKey(wicketType), "OUT!")
      : isWide
        ? "wide ball"
        : isNoBall
          ? "no ball"
          : lookup(RUN_OUTCOME, runs, `${runs} runs`);

  // Handle extras differently — pitch details may not apply
  if (isWide) {
    const wideDesc = lineText !== "on the stumps" ? `down ${lineText}` : "down the leg side";
    const wideVivid = `Wide delivery ${wideDesc}, ${moveText}. ${batsmanName} lets it go, called wide by the umpire.`;
    return {
      short: `${bowlerName} to ${batsmanName}, ${outcomeText}`,
      vivid: freeHitNext ? `${wideVivid} Free Hit coming up!` : wideVivid,
    };
  }
  if (wicketCancelled) {
    const freeHitLine = freeHitNext ? " Free Hit coming up!" : "";
    return {
      short: `${bowlerName} to ${batsmanName}, ${outcomeText}`,
      vivid: `Drama on the field! ${batsmanName} looked gone, but it is a NO BALL. Wicket cancelled, ${batsmanName} survives. One extra added.${freeHitLine}`,
    };
  }
  if (isNoBall) {
    const freeHitLine = freeHitNext ? " Free Hit is coming next ball!" : "";
    if (runs === 0) {
      const noBallVivid = `${lengthText} ball ${lineText}, ${moveText} — ${batsmanName} swings but fails to connect. No ball called.${freeHitLine}`;
      return {
        short: `${bowlerName} to ${batsmanName}, ${outcomeText}`,
        vivid: noBallVivid,
      };
    }
    const runDesc = runs === 4 ? "FOUR!" : runs === 6 ? "SIX!" : `${runs} run${runs !== 1 ? 's' : ''}`;
    const noBallVivid = `${batsmanName} gets ${runDesc} on a no ball! ${lengthText} ball ${lineText}, ${moveText}.${freeHitLine}`;
    return {
      short: `${bowlerName} to ${batsmanName}, ${outcomeText}, ${runs} run${runs !== 1 ? 's' : ''}`,
      vivid: noBallVivid,
    };
  }

  if (isBye) {
    const runDesc = runs === 4 ? "FOUR!" : runs === 6 ? "SIX!" : `${runs} run${runs !== 1 ? 's' : ''}`;
    return {
      short: `${bowlerName} to ${batsmanName}, ${lengthText.toLowerCase()} ${lineText}, byes, ${runs} run${runs !== 1 ? 's' : ''}`,
      vivid: `${lengthText} ball ${lineText}, ${moveText} — ${batsmanName} misses the shot, ball goes past the keeper. ${runDesc} byes.`,
    };
  }
  if (isLegBye) {
    const runDesc = runs === 4 ? "FOUR!" : runs === 6 ? "SIX!" : `${runs} run${runs !== 1 ? 's' : ''}`;
    return {
      short: `${bowlerName} to ${batsmanName}, ${lengthText.toLowerCase()} ${lineText}, leg byes, ${runs} run${runs !== 1 ? 's' : ''}`,
      vivid: `${lengthText} ball ${lineText}, ${moveText} — ${batsmanName} tries to play but the ball rolls off the pads. ${runDesc} leg byes.`,
    };
  }

  const deliveryBase = `${lengthText} ball ${lineText}, ${moveText}`;
  const shotAction = `plays the ${shotText}`;
  const shotDir = `toward ${dir}`;

  // Free Hit delivery — lead with Free Hit tag
  if (isFreeHit && !isWide && !isNoBall) {
    const fhTag = "Free Hit —";
    const baseVivid = (() => {
      if (runs === 4) {
        const opener = _pick(BOUNDARY_OPENERS, `${batsmanName}-${bowlerName}-fh4`);
        return `${fhTag} ${lengthText} ball ${lineText}, ${moveText} — ${batsmanName} ${shotAction}, sends it ${shotDir}. ${opener}`;
      }
      if (runs === 6) {
        const opener = _pick(SIX_OPENERS, `${batsmanName}-${bowlerName}-fh6`);
        return `${fhTag} ${lengthText} ball ${lineText}, ${moveText} — ${batsmanName} ${shotAction}, sends it ${shotDir}. ${opener}`;
      }
      if (runs > 0) {
        return `${fhTag} ${lengthText} ball ${lineText}, ${moveText} — ${batsmanName} ${shotAction}, sends it ${shotDir}. ${outcomeText}`;
      }
      if (!shotTypeFinal || shotTypeFinal === "shot") {
        const missed = _pick(MISSED_SHOTS, `${batsmanName}-${bowlerName}-fh${pitchLength}`);
        return `${fhTag} ${lengthText} ball ${lineText}, ${moveText} — ${batsmanName} ${missed}`;
      }
      const ending = _pick(DOT_ENDINGS, `${batsmanName}-${bowlerName}-fh${pitchLength}`);
      return `${fhTag} ${lengthText} ball ${lineText}, ${moveText} — ${batsmanName} ${shotAction}, sends it ${shotDir}. ${ending}`;
    })();
    return {
      short: `Free Hit — ${bowlerName} to ${batsmanName}, ${lengthText.toLowerCase()} ${lineText}, ${outcomeText.toLowerCase()}`,
      vivid: baseVivid,
    };
  }

  // ─── MAIN TEMPLATE ────────────────────────────────────────────

  const wkType = normalizeKey(wicketType);

  let vivid;
  if (runs === 4) {
    const opener = _pick(BOUNDARY_OPENERS, `${batsmanName}-${bowlerName}-4`);
    vivid = `${deliveryBase} — ${batsmanName} ${shotAction}, sends it ${shotDir}. ${opener}`;
  } else if (runs === 6) {
    const opener = _pick(SIX_OPENERS, `${batsmanName}-${bowlerName}-6`);
    vivid = `${deliveryBase} — ${batsmanName} ${shotAction}, sends it ${shotDir}. ${opener}`;
  } else if (runs === 3) {
    const opener = _pick(TRIPLE_OPENERS, `${batsmanName}-${bowlerName}-3`);
    vivid = `${deliveryBase} — ${batsmanName} ${shotAction}, sends it ${shotDir}. ${opener}`;
  } else if (runs === 2) {
    const opener = _pick(DOUBLE_OPENERS, `${batsmanName}-${bowlerName}-2`);
    vivid = `${deliveryBase} — ${batsmanName} ${shotAction}, sends it ${shotDir}. ${opener}`;
  } else if (runs === 1) {
    const opener = _pick(SINGLE_OPENERS, `${batsmanName}-${bowlerName}-1`);
    vivid = `${deliveryBase} — ${batsmanName} ${shotAction}, sends it ${shotDir}. ${opener}`;
  } else if (runs === 0 && !isWicket) {
    if (!shotTypeFinal || shotTypeFinal === "shot") {
      const missed = _pick(MISSED_SHOTS, `${batsmanName}-${bowlerName}-${pitchLength}`);
      vivid = `${deliveryBase} — ${batsmanName} ${missed}`;
    } else {
      const ending = _pick(DOT_ENDINGS, `${batsmanName}-${bowlerName}-${pitchLength}`);
      vivid = `${deliveryBase} — ${batsmanName} ${shotAction}, sends it ${shotDir}. ${ending}`;
    }
  } else if (isWicket) {
    const pressure = _pick(PRESSURE_PHRASES, `${batsmanName}-${bowlerName}-wk`);
    if (wkType === "bowled" || wkType === "lbw") {
      vivid = `${deliveryBase} — ${outcomeText} ${pressure}`;
    } else if (wkType === "stumped") {
      vivid = `${deliveryBase} — ${batsmanName} steps out, beaten, and the keeper whips the bails off! ${outcomeText} ${pressure}`;
    } else if (wkType === "hit-wicket") {
      vivid = `${deliveryBase} — ${batsmanName} ${shotAction}, but dislodges the bails! ${outcomeText} ${pressure}`;
    } else {
      vivid = `${deliveryBase} — ${batsmanName} ${shotAction}, sends it ${shotDir}. ${outcomeText} ${pressure}`;
    }
  } else {
    vivid = `${deliveryBase} — ${batsmanName} ${shotAction}, sends it ${shotDir}. ${outcomeText}`;
  }

  if (isAppeal) {
    const appealPhrase = _pick(APPEAL_PHRASES, `${batsmanName}-${bowlerName}`);
    vivid = `${appealPhrase} ${vivid}`;
  }

  let short;
  if (isWicket && (wkType === "bowled" || wkType === "lbw")) {
    short = `${bowlerName} to ${batsmanName}, ${lengthText.toLowerCase()} ${lineText}, ${moveText}, ${outcomeText.toLowerCase()}`;
  } else if (isWicket && wkType === "stumped") {
    short = `${bowlerName} to ${batsmanName}, ${lengthText.toLowerCase()} ${lineText}, ${moveText}, ${batsmanName} steps out, ${outcomeText.toLowerCase()}`;
  } else if (isWicket && wkType === "hit-wicket") {
    short = `${bowlerName} to ${batsmanName}, ${lengthText.toLowerCase()} ${lineText}, ${moveText}, ${batsmanName} on to the stumps, ${outcomeText.toLowerCase()}`;
  } else {
    short = `${bowlerName} to ${batsmanName}, ${lengthText.toLowerCase()} ${lineText}, ${moveText}, ${batsmanName} ${shotText} to ${dir}, ${outcomeText.toLowerCase()}`;
  }

  return { short, vivid };
}

const normalizeKey = (value = "") =>
  String(value || "").trim().toLowerCase().replace(/_/g, "-").replace(/\s+/g, "-");

// ─── AI COMMENTARY SERVICE ──────────────────────────────────────

class AICommentaryService {
  constructor() {
    this.apiKey = process.env.ANTHROPIC_API_KEY;
    this.model = "claude-sonnet-4-20250514";
  }

  // Main entry: always returns structured commentary first, optionally enhances with AI
  async generateBallCommentary(data) {
    // 1. Always generate structured template commentary
    const structured = buildStructuredCommentary(data);
    let result = { ...structured };

    // 2. If AI is enabled and a key is available, enhance VIVID with AI flair
    //    (keep SHORT as is).
    if (this.apiKey && (await isAiCommentaryEnabled())) {
      try {
        const vividEnriched = await this._aiEnrichVivid(data, structured.vivid);
        if (vividEnriched) result.vivid = vividEnriched;
      } catch (err) {
        console.error("AI enrichment error:", err.message);
      }
    }

    return result;
  }

  async _aiEnrichVivid(data, baseVivid) {
    const {
      runs = 0,
      isWide = false,
      isNoBall = false,
      isWicket = false,
      wicketType = "",
      batsmanName = "Batsman",
      bowlerName = "Bowler",
      pitchLine = "",
      pitchLength = "",
      ballMovement = "none",
      shotType = "",
      shotName = "",
      shotDirection = "",
      fieldingZone = "",
      nearestPosition = "",
      zone = "",
      overNumber = 0,
      ballNumber = 1,
      currentScore = 0,
      currentWickets = 0,
      matchContext = {},
    } = data;

    const lineText = lookup(LINE_LABELS, pitchLine, "on the stumps");
    const lengthText = lookup(LENGTH_LABELS, pitchLength, "Good length");
    const moveText =
      !ballMovement || ballMovement === "none"
        ? "straight"
        : ballMovement.replace(/_/g, " ");
    const shotTypeFinal = shotType || shotName || "shot";
    const shotText = shotTypeFinal && shotTypeFinal !== "shot" ? labelize(shotTypeFinal) : "shot";
    const dir = shotDirection || fieldingZone || nearestPosition || zone || "the outfield";
    const matchSit = matchContext.target
      ? `Need ${matchContext.target - currentScore} from ${Math.max(0, ((matchContext.totalOvers || 1) - (overNumber + ballNumber / 6)) * 6 | 0)} balls`
      : `${currentScore}/${currentWickets}`;

    const prompt = `You are a CricAll cricket commentator.

BASE COMMENTARY (keep the same factual info, make it sound more natural/expressive):
"${baseVivid}"

BALL DATA:
Bowler: ${bowlerName} | Batter: ${batsmanName}
Delivery: ${lengthText.toLowerCase()} ball ${lineText}, ${moveText}
Shot: ${shotText}
Direction: ${dir}
Runs: ${runs}${isWide ? " (wide)" : ""}${isNoBall ? " (no ball)" : ""}${isWicket ? ` wicket: ${wicketType}` : ""}
Match: ${matchSit}

TASK: Rewrite the VIVID commentary line to be MORE expressive and natural while STRICTLY keeping all 4 factual elements: delivery line+length, ball movement, shot type, and direction. Do NOT remove or reorder these 4 elements from the BASE. Only improve the wording flow. Max 2 sentences.

VIVID:`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 150,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const resBody = await response.json();
    const text = resBody.content?.[0]?.text?.trim();
    if (text && !text.includes("I cannot") && text.length > 20) {
      return text.replace(/^VIVID:\s*/i, "").trim();
    }
    return null;
  }

  async generateOverSummary(data) {
    const {
      overNumber = 0, bowlerName = "Bowler", bowlingStyle = "",
      oversFigures = "0-0-0-0", runsThisOver = 0, wicketsThisOver = 0,
      extrasThisOver = "", ballsSummary = [],
      score = 0, wickets = 0, totalOvers = 0, target = null,
      remainingRuns = null, remainingBalls = null, rrr = null, crr = "0.00",
      batter1 = {}, batter2 = {}
    } = data;

    if (this.apiKey && (await isAiCommentaryEnabled())) {
      try {
        const ballsText = ballsSummary.map((b, i) =>
          `${overNumber}.${i + 1} — ${b.notation || b.runs} — ${b.commentary || "no commentary"}`
        ).join("\n");
        const chaseInfo = target ? `Need ${remainingRuns} from ${remainingBalls} balls | RRR: ${rrr}` : "";

        const prompt = `You are a professional CricAll cricket analyst.

Over ${overNumber + 1} just completed.
Bowler: ${bowlerName}${bowlingStyle ? ` | Style: ${bowlingStyle}` : ""}
Over Figures: ${oversFigures}
Runs This Over: ${runsThisOver} | Wickets: ${wicketsThisOver}
${extrasThisOver ? `Extras: ${extrasThisOver}` : ""}

Balls this over:
${ballsText}

Match Situation After Over:
${score}/${wickets} | ${totalOvers} overs bowled | CRR: ${crr}
${chaseInfo}
Current Batters: ${batter1.name || "?"} ${batter1.runs || 0}(${batter1.balls || 0}b) | ${batter2.name || "?"} ${batter2.runs || 0}(${batter2.balls || 0}b)

Write 2-3 sentences of over summary:
- Comment on the bowling quality and tactical shifts
- Highlight key wickets, big hits, or building pressure
- Note the context (closing in on target, middle-over consolidation, etc.)
CricAll analyst style. No emojis. Plain flowing text only.`;

        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": this.apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: this.model,
            max_tokens: 300,
            messages: [{ role: "user", content: prompt }],
          }),
        });

        const resBody = await response.json();
        return resBody.content?.[0]?.text?.trim() || this._overFallback(data);
      } catch (err) {
        console.error("Over Summary AI Error:", err.message);
      }
    }

    return this._overFallback(data);
  }

  _overFallback({ bowlerName, runsThisOver, wicketsThisOver, overNumber }) {
    const overNum = (overNumber || 0) + 1;
    if (wicketsThisOver > 0 && runsThisOver === 0) {
      return `Over ${overNum}: A wicket maiden from ${bowlerName || "the bowler"}! ${wicketsThisOver} wicket${wicketsThisOver > 1 ? "s" : ""} fell, no runs conceded.`;
    }
    if (wicketsThisOver > 0) {
      return `Over ${overNum}: ${runsThisOver} run${runsThisOver !== 1 ? "s" : ""} and ${wicketsThisOver} wicket${wicketsThisOver > 1 ? "s" : ""} from it. ${bowlerName || "The bowler"} struck!`;
    }
    if (runsThisOver === 0) {
      return `Over ${overNum}: A maiden over from ${bowlerName || "the bowler"}! Dot balls building pressure.`;
    }
    return `Over ${overNum}: ${runsThisOver} run${runsThisOver !== 1 ? "s" : ""} from the over. ${bowlerName || "The bowler"} kept it tight.`;
  }

  async regenerateEditedBallCommentary(data) {
    const {
      overNumber, ballNumber,
      oldType, oldRuns, oldDirection,
      newType, newRuns, newDirection,
      bowlerName, batsmanName,
      isWide = false, isNoBall = false, isWicket = false, wicketType = ""
    } = data;

    if (this.apiKey && (await isAiCommentaryEnabled())) {
      try {
        const prompt = `The ball at ${overNumber}.${ballNumber} was incorrectly recorded. Please provide corrected commentary.

CORRECTED Info:
- Previous: ${oldType} for ${oldRuns}
- Corrected: ${newType} for ${newRuns}
- Bowler: ${bowlerName} | Batter: ${batsmanName}
${isWicket ? `- WICKET: ${wicketType}` : ""}

Write TWO lines of corrected commentary for this ball.
SHORT: [broadcast summary]
VIVID: [Highly technical description of delivery length, shot intent, and specific region] (2-3 sentences)

CricAll professional style, no emojis.`;

        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": this.apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: this.model,
            max_tokens: 300,
            messages: [{ role: "user", content: prompt }],
          }),
        });

        const resBody = await response.json();
        const text = resBody.content?.[0]?.text?.trim() || "";

        let short = "";
        let vivid = "";
        const shortMatch = text.match(/SHORT:\s*(.*)/i);
        const vividMatch = text.match(/VIVID:\s*(.*)/i);

        if (shortMatch) short = shortMatch[1].trim();
        if (vividMatch) vivid = vividMatch[1].trim();

        if (!short || !vivid) {
          const lines = text.split("\n").filter((l) => l.trim().length > 0);
          short = short || lines[0]?.replace(/SHORT:?\s*/i, "").trim() || "";
          if (lines.length > 1)
            vivid = vivid || lines.slice(1).join(" ").replace(/VIVID:?\s*/i, "").trim() || "";
        }

        if (short) return { short, vivid };
      } catch (err) {
        console.error("Ball Regenerate AI Error:", err.message);
      }
    }

    const fallbackShort = `${bowlerName} to ${batsmanName}, corrected: ${newType} for ${newRuns} run${newRuns !== 1 ? "s" : ""}`;
    const fallbackVivid = `Corrected delivery: ${newType} for ${newRuns} runs.`;
    return { short: fallbackShort, vivid: fallbackVivid };
  }
}

export default new AICommentaryService();

// ─── EXPORTED STANDALONE HELPERS (merged from aiCommentaryService.js) ───

const _aiClient = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const rewriteCache = new Map();

export async function rewriteInBQStyle(originalCommentary, ballData = {}) {
  if (!originalCommentary || originalCommentary.length < 5) return originalCommentary;
  if (!_aiClient) return originalCommentary;
  if (!(await isAiCommentaryEnabled())) return originalCommentary;

  const key = originalCommentary.slice(0, 80);
  if (rewriteCache.has(key)) return rewriteCache.get(key);

  try {
    const response = await _aiClient.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 120,
      messages: [{
        role: 'user',
        content: `Rewrite this cricket ball commentary completely in your own unique style. Keep ALL facts identical (runs, player names, shot type, fielder). Change every word and phrase. Use energetic Pakistani cricket fan style. 1-2 sentences max. Just write the commentary, nothing else.

Original: "${originalCommentary}"

Rewritten:`
      }]
    });

    const rewritten = response.content[0].text.trim().replace(/^["']|["']$/g, '');
    rewriteCache.set(key, rewritten);
    return rewritten;
  } catch (e) {
    console.error('[AI Commentary] Error:', e.message);
    return originalCommentary;
  }
}

export async function generateMatchSummary(matchData) {
  if (!_aiClient) return null;
  if (!(await isAiCommentaryEnabled())) return null;

  try {
    const response = await _aiClient.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `Write a 2-sentence live match situation summary in energetic Pakistani cricket fan style.

Match: ${matchData.name || 'Unknown'}
Score: ${JSON.stringify(matchData.score || {})}
Status: ${matchData.status || 'Unknown'}

Write just the summary text:`
      }]
    });
    return response.content[0].text.trim();
  } catch (e) {
    return null;
  }
}
