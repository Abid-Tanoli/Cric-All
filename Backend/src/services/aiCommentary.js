// AI Commentary Generation Service - BQ-PLAY professional style
// Using claude-sonnet-4-20250514 as specified by user
// Parts 4, 5, 6: Per-ball, Over Summary, Ball Edit prompts

import fetch from "node-fetch";

const LINE_LABELS = {
  wide_outside_off: "wide outside off",
  outside_off: "outside off",
  off_stump: "on an off-stump line",
  middle_stump: "on middle stump",
  leg_stump: "on leg stump",
  outside_leg: "outside leg",
  wide_outside_leg: "wide outside leg"
};

const LENGTH_LABELS = {
  full_toss: "full toss",
  yorker: "yorker length",
  full: "full length",
  good_length: "good length",
  hard_length: "hard length",
  bouncer: "short bouncer length"
};

const SHOT_LABELS = {
  defended: "defended",
  driven: "driven",
  cut: "cut",
  pull: "pulled",
  flick_glance: "flicked or glanced",
  sweep: "swept",
  reverse_sweep: "reverse swept",
  lofted_slog: "lofted",
  left_padded_away: "left alone or padded away",
  missed_beaten: "beaten",
  edged: "edged",
  no_shot_offered: "no shot offered"
};

const labelFrom = (map, value, fallback = "") => map[value] || value?.replace(/_/g, " ") || fallback;

const zoneCommentary = {
  cover: {
    0: ["defended solidly back toward cover, no run", "pushed to cover, good fielding prevents the single"],
    1: ["nudged to cover for a quick single", "worked to cover, they steal a run"],
    2: ["driven to cover, good running gets them two"],
    4: ["driven hard through the covers - FOUR!", "cracking cover drive, races to the boundary!"],
    6: ["launched over cover - SIX! Incredible shot!"]
  },
  "extra-cover": {
    0: ["pushed toward extra cover, fielder is sharp"],
    1: ["clipped to extra cover, quick single taken"],
    4: ["driven through extra cover - FOUR! Textbook shot!"]
  },
  "deep-cover": {
    4: ["driven wide of mid-off, races to the deep cover boundary - FOUR!"],
    6: ["lofted over deep cover - SIX!"]
  },
  point: {
    0: ["cut hard but straight to point, no run"],
    1: ["dabbed to point for a single"],
    4: ["cut hard through point - FOUR!", "square cut, whistles through point for four!"]
  },
  "backward-point": {
    0: ["punched to backward point, well fielded"],
    1: ["glanced to backward point, single taken"],
    4: ["late cut to backward point - FOUR!"]
  },
  "deep-point": {
    4: ["cut hard, beats the in-field, races to the boundary at deep point - FOUR!"],
    6: ["slog over deep point - SIX!"]
  },
  gully: {
    0: ["flashed hard but straight to gully - heart in mouth moment!"],
    1: ["thick edge to gully, single taken"],
    4: ["through the gully gap - FOUR!"]
  },
  "third-man": {
    0: ["thick edge but straight to third man, no run"],
    1: ["edged to third man, single taken"],
    4: ["feather edge, races away to third man - FOUR!"]
  },
  "deep-third-man": {
    4: ["edge flies over slip, races to the deep third man boundary - FOUR!"],
    6: ["scooped over third man - SIX! Audacious shot!"]
  },
  "first-slip": {
    0: ["beat the outside edge - past the bat, keeper takes it cleanly"]
  },
  "second-slip": {
    0: ["induced edge but falls short of second slip"]
  },
  "mid-wicket": {
    0: ["tucked to mid-wicket, sharp fielding prevents the run"],
    1: ["worked to mid-wicket for a single"],
    2: ["flicked to mid-wicket, they scamper two"],
    4: ["whipped through mid-wicket - FOUR! Lovely wrist work!"],
    6: ["launched over mid-wicket - SIX!"]
  },
  "deep-mid-wicket": {
    4: ["powerful flick, over the in-field to deep mid-wicket - FOUR!"],
    6: ["deposited over deep mid-wicket - SIX! Pure power!"]
  },
  "square-leg": {
    0: ["tucked to square leg, well fielded"],
    1: ["glanced to square leg, single taken"],
    4: ["swept to square leg - FOUR!"]
  },
  "backward-square-leg": {
    1: ["glanced to backward square leg, they run"],
    4: ["fine glance, races to backward square leg - FOUR!"]
  },
  "deep-square-leg": {
    4: ["swept hard, beats the in-field at deep square leg - FOUR!"],
    6: ["slog sweep over deep square leg - SIX!"]
  },
  "fine-leg": {
    1: ["glanced down to fine leg, easy single"],
    4: ["fine glance, races down to fine leg - FOUR!"]
  },
  "deep-fine-leg": {
    4: ["flicked fine, races to the boundary - FOUR!"],
    6: ["scooped over fine leg - SIX! Remarkable!"]
  },
  "long-leg": {
    1: ["pulled to long leg, single taken"],
    4: ["pull shot, reaches the long leg boundary - FOUR!"],
    6: ["pull over long leg - SIX!"]
  },
  "mid-on": {
    0: ["driven back to mid-on, no run"],
    1: ["clipped to mid-on, quick single"],
    4: ["driven through mid-on - FOUR!"]
  },
  "long-on": {
    1: ["driven to long-on, single taken"],
    4: ["driven down the ground, beats long-on - FOUR!"],
    6: ["lofted down the ground - SIX! Right over the bowler's head!"]
  },
  "mid-off": {
    0: ["driven straight to mid-off, no run"],
    1: ["pushed to mid-off, quick single taken"],
    4: ["driven hard through mid-off - FOUR!"]
  },
  "long-off": {
    1: ["driven to long-off, single"],
    4: ["driven down the ground, beats long-off - FOUR!"],
    6: ["launched over long-off - SIX! Into the stands!"]
  },
  straight: {
    4: ["driven straight back past the bowler - FOUR!"],
    6: ["straight hit, over the bowler's head - SIX!"]
  },
  "wicket-keeper": {
    0: ["good delivery, through to the keeper"]
  }
};

const outcomeCommentary = {
  beat: [
    "superb delivery, beats the outside edge - absolutely nowhere near it!",
    "nips back off the seam, beats the inside edge - that could have been trouble!",
    "lovely away-swinger, beats the outside edge completely, keeper takes it cleanly"
  ],
  missed: [
    "wild swing and a miss - completely missed it!",
    "attempted big shot but gets nothing on it, bowler roars in celebration",
    "top edge, skies it - but falls safely"
  ],
  left: [
    "left alone outside off stump - good discipline from the batsman",
    "lets it go, good judgement - that was going well past off stump",
    "leaves it alone - smart cricket"
  ],
  edged: {
    4: ["thick outside edge, flies through the gap - FOUR! Lucky boundary!"],
    0: ["outside edge - but it falls safely, no slip in place"]
  }
};

const pitchZonePrefix = {
  "full-toss": "full toss -",
  yorker: "perfect yorker, right in the blockhole -",
  full: "full delivery -",
  "good-length": "good length delivery -",
  short: "short-pitched delivery -",
  bouncer: "short-pitched bouncer -",
  "half-volley": "overpitched half-volley -"
};

const movementCommentary = {
  inswing: "swings back in late -",
  outswing: "shapes away off the pitch -",
  "off-cutter": "cuts back off the seam -",
  "leg-cutter": "cuts away sharply -",
  "seam-movement": "moves off the seam -",
  googly: "the googly, comes out of the back of the hand -",
  "leg-spin": "drifting leg-spin -",
  "off-spin": "spinning off-break -",
  doosra: "the doosra - goes the other way!",
  flipper: "the flipper, skids through -"
};

const normalizeKey = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/\s+/g, "-");

const normalizePitchZone = (pitchZone, pitchLength) => {
  const normalized = normalizeKey(pitchZone || pitchLength);
  const aliases = {
    full_toss: "full-toss",
    good_length: "good-length",
    hard_length: "short",
    hard: "short"
  };
  return aliases[normalized] || normalized;
};

const pickRandom = (items = []) => items[Math.floor(Math.random() * items.length)] || "";

const runText = ({ runs = 0, isWide = false, isNoBall = false, isWicket = false }) => {
  if (isWicket) return "OUT!";
  if (isWide) return "wide";
  if (isNoBall) return "no ball";
  if (runs === 0) return "no run";
  if (runs === 1) return "1 run";
  if (runs === 4) return "FOUR";
  if (runs === 6) return "SIX";
  return `${runs} runs`;
};

class AICommentaryService {
  constructor() {
    this.apiKey = process.env.ANTHROPIC_API_KEY;
    this.model = "claude-sonnet-4-20250514";
  }

  // ─── PART 4: Per-Ball Commentary ─────────────────────────────────────────
  async generateBallCommentary(data) {
    let result = { short: "", vivid: "" };

    const {
      runs = 0, isWide = false, isNoBall = false, isBye = false, isLegBye = false,
      isWicket = false, wicketType = "",
      batsmanName = "Batsman", bowlerName = "Bowler",
      zone = "", direction = "", shotName = "", side = "", nearestPosition = "",
      fieldingZone = "", pitchZone = "", ballMovement = "none", ballOutcome = "played",
      pitchLine = "", pitchLength = "", pitchShotType = "",
      distanceCategory = "",
      overNumber = 0, ballNumber = 1,
      currentScore = 0, currentWickets = 0,
      matchContext = {}
    } = data;

    const template = this._zoneAwareCommentary({
      fieldingZone: fieldingZone || direction || nearestPosition || zone,
      runs,
      isWide,
      isNoBall,
      isWicket,
      wicketType,
      pitchZone,
      pitchLength,
      ballMovement,
      ballOutcome,
      bowlerName,
      batsmanName
    });

    const deliveryType = isWide ? "wide" : isNoBall ? "no_ball" : isBye ? "bye" : isLegBye ? "leg_bye" : "normal";
    const lineText = labelFrom(LINE_LABELS, pitchLine, "around the stumps");
    const lengthText = labelFrom(LENGTH_LABELS, pitchLength, "a testing length");
    const shotText = labelFrom(SHOT_LABELS, pitchShotType || shotName, shotName || "played");
    const pitchDetail = `${lengthText}, ${lineText}`;
    const boundaryNote = runs === 4
      ? `FOUR — ground shot bounced to boundary toward ${direction || nearestPosition || zone}`
      : runs === 6
        ? `SIX — direct over ${nearestPosition || direction || zone}, cleared boundary in air`
        : "";

    const matchSit = matchContext.target
      ? `Need ${matchContext.target - currentScore} from ${Math.max(0, (matchContext.totalOvers - (overNumber + ballNumber / 6)) * 6 | 0)} balls | RRR: ${matchContext.requiredRunRate}`
      : `${currentScore}/${currentWickets} | CRR: ${matchContext.totalOvers > 0 ? (currentScore / ((overNumber + ballNumber / 6) || 1)).toFixed(2) : '0.00'}`;

    if (this.apiKey) {
      try {
        const prompt = `You are a professional BQ-PLAY cricket commentator.
        
Ball Info:
- Ball: ${overNumber}.${ballNumber}
- Delivery Type: ${deliveryType}
- Bowler: ${bowlerName}
- Batter: ${batsmanName}
- Pitch Map: ${pitchDetail}
- Runs This Ball: ${runs}${isWide ? ` (Wide +${runs})` : ""}${isNoBall ? " (No Ball)" : ""}
- Shot: ${shotText}
- Shot Direction: ${direction || zone || "unknown area"}${side ? ` (${side})` : ""}${nearestPosition ? ` near ${nearestPosition}` : ""}
- Distance: ${distanceCategory || "standard"}
${boundaryNote ? `- Boundary Detail: ${boundaryNote}` : ""}
${isWicket ? `- WICKET: ${wicketType}` : ""}
- Match Situation: ${matchSit}

Task: Generate two specific lines of commentary.
1. SHORT: A punchy, traditional scorecard-style summary. Format: '[Bowler] to [Batter], [Result]'.
2. VIVID: A rich, technical paragraph (2-3 sentences). Mention the exact pitch length/line when useful, the shot type, and the fielding area. Avoid repetitive structures.

FORMAT EXACTLY:
SHORT: [broadcast summary]
VIVID: [detailed technical description]

Variation Note: Use diverse vocabulary. Ensure the tone fits the match tempo. Never use the phrase 'responded by dismissing himself'.`;

        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": this.apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json"
          },
          body: JSON.stringify({
            model: this.model,
            max_tokens: 400,
            messages: [{ role: "user", content: prompt }]
          })
        });

        const resBody = await response.json();
        const text = resBody.content?.[0]?.text || "";

        // Robust multi-strategy extraction
        let short = text.match(/SHORT:\s*(.*)/i)?.[1]?.trim();
        let vivid = text.match(/VIVID:\s*([\s\S]*?)$/i)?.[1]?.trim();

        // Strategy 2: Break by lines if labels are missing
        if (!short || !vivid) {
          const lines = text.split('\n').filter(l => l.trim().length > 0);
          if (lines.length >= 2) {
            short = short || lines[0].replace(/SHORT:?\s*/i, '').trim();
            vivid = vivid || lines.slice(1).join(' ').replace(/VIVID:?\s*/i, '').trim();
          } else if (lines.length === 1) {
            short = short || lines[0].replace(/SHORT:?\s*/i, '').trim();
          }
        }

        result.short = short || template.short || "";
        result.vivid = vivid || template.vivid || "";
      } catch (err) {
        console.error("AI Commentary Error:", err.message);
      }
    }

    // fallback logic
    if (!result.short) {
      result.short = template.short || `${bowlerName} to ${batsmanName}, ${runText({ runs, isWide, isNoBall, isWicket })}`;
    }

    if (!result.vivid) {
      result.vivid = template.vivid || `${bowlerName} hit ${pitchDetail}. ${batsmanName} played ${shotText}${direction || nearestPosition || zone ? ` toward ${direction || nearestPosition || zone}` : ""}.`;
    }

    return result;
  }

  _zoneAwareCommentary(data) {
    const {
      fieldingZone = "",
      runs = 0,
      isWide = false,
      isNoBall = false,
      isWicket = false,
      wicketType = "",
      pitchZone = "",
      pitchLength = "",
      ballMovement = "none",
      ballOutcome = "played",
      bowlerName = "Bowler",
      batsmanName = "Batsman"
    } = data;

    const normalizedZone = normalizeKey(fieldingZone);
    const normalizedPitch = normalizePitchZone(pitchZone, pitchLength);
    const normalizedMovement = normalizeKey(ballMovement);
    const normalizedOutcome = normalizeKey(ballOutcome);
    const parts = [];

    if (normalizedPitch && pitchZonePrefix[normalizedPitch]) parts.push(pitchZonePrefix[normalizedPitch]);
    if (normalizedMovement && normalizedMovement !== "none" && movementCommentary[normalizedMovement]) {
      parts.push(movementCommentary[normalizedMovement]);
    }

    if (normalizedOutcome === "beat") {
      const line = pickRandom(outcomeCommentary.beat);
      return { short: `${bowlerName} to ${batsmanName}, ${line}`, vivid: `${parts.join(" ")} ${line}`.trim() };
    }

    if (normalizedOutcome === "left") {
      const line = pickRandom(outcomeCommentary.left);
      return { short: `${bowlerName} to ${batsmanName}, ${line}`, vivid: `${parts.join(" ")} ${line}`.trim() };
    }

    if (normalizedOutcome === "missed") {
      const line = pickRandom(outcomeCommentary.missed);
      return { short: `${bowlerName} to ${batsmanName}, ${line}`, vivid: `${parts.join(" ")} ${line}`.trim() };
    }

    if (normalizedOutcome === "edged") {
      const edgeLines = outcomeCommentary.edged[runs] || outcomeCommentary.edged[0];
      const line = pickRandom(edgeLines);
      return { short: `${bowlerName} to ${batsmanName}, ${parts.join(" ")} ${line}`.replace(/\s+/g, " ").trim(), vivid: line };
    }

    if (isWicket) {
      const wicketLines = {
        bowled: "BOWLED HIM! The stumps are shattered! What a delivery!",
        caught: `CAUGHT! ${batsmanName} holes out - big wicket!`,
        lbw: "LBW! Struck on the pad, plumb in front - given!",
        "run-out": `RUN OUT! Brilliant fielding, direct hit - ${batsmanName} is gone!`,
        stumped: `STUMPED! ${batsmanName} is well out of the crease - the keeper whips off the bails!`,
        "hit-wicket": `HIT WICKET! ${batsmanName} loses his balance and hits the stumps - unlucky!`
      };
      const line = wicketLines[normalizeKey(wicketType)] || "OUT!";
      return { short: `${bowlerName} to ${batsmanName}, ${line}`, vivid: `${parts.join(" ")} ${line}`.trim() };
    }

    const zoneTemplates = zoneCommentary[normalizedZone];
    if (zoneTemplates && zoneTemplates[runs]) {
      const line = pickRandom(zoneTemplates[runs]);
      return {
        short: `${bowlerName} to ${batsmanName}, ${parts.join(" ")} ${line}`.replace(/\s+/g, " ").trim(),
        vivid: line
      };
    }

    const fallback = {
      0: "dot ball, well defended",
      1: "worked away for a single",
      2: "good running, they get two",
      3: "excellent running, three runs",
      4: "FOUR! Races away to the boundary!",
      6: "SIX! High and handsome into the stands!"
    };
    const line = fallback[runs] || `${runs} runs`;
    return {
      short: `${bowlerName} to ${batsmanName}, ${parts.join(" ")} ${isWide || isNoBall ? runText({ runs, isWide, isNoBall }) : line}`.replace(/\s+/g, " ").trim(),
      vivid: line
    };
  }

  // ─── PART 5: Over Summary AI Prompt ──────────────────────────────────────
  async generateOverSummary(data) {
    const {
      overNumber = 0, bowlerName = "Bowler", bowlingStyle = "",
      oversFigures = "0-0-0-0", runsThisOver = 0, wicketsThisOver = 0,
      extrasThisOver = "", ballsSummary = [],
      score = 0, wickets = 0, totalOvers = 0, target = null,
      remainingRuns = null, remainingBalls = null, rrr = null, crr = "0.00",
      batter1 = {}, batter2 = {}
    } = data;

    const ballsText = ballsSummary.map((b, i) =>
      `${overNumber}.${i + 1} — ${b.notation || b.runs} — ${b.commentary || "no commentary"}`
    ).join("\n");

    const chaseInfo = target
      ? `Need ${remainingRuns} from ${remainingBalls} balls | RRR: ${rrr}`
      : "";

    if (this.apiKey) {
      try {
        const prompt = `You are a professional BQ-PLAY cricket analyst.

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
BQ-PLAY analyst style. No emojis. Plain flowing text only.`;

        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": this.apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json"
          },
          body: JSON.stringify({
            model: this.model,
            max_tokens: 300,
            messages: [{ role: "user", content: prompt }]
          })
        });

        const resBody = await response.json();
        return resBody.content?.[0]?.text?.trim() || this._overFallback(data);
      } catch (err) {
        console.error("Over Summary AI Error:", err.message);
      }
    }

    return this._overFallback(data);
  }

  _overFallback({ bowlerName, runsThisOver, wicketsThisOver }) {
    return `${runsThisOver} run${runsThisOver !== 1 ? 's' : ''} from the over. A productive set of deliveries as the game develops.`;
  }

  // ─── PART 6: Ball Edit/Regenerate Commentary ──────────────────────────────
  async regenerateEditedBallCommentary(data) {
    const {
      overNumber, ballNumber,
      oldType, oldRuns, oldDirection,
      newType, newRuns, newDirection,
      bowlerName, batsmanName,
      isWide = false, isNoBall = false, isWicket = false, wicketType = ""
    } = data;

    if (this.apiKey) {
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

BQ-PLAY professional style, no emojis.`;

        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": this.apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json"
          },
          body: JSON.stringify({
            model: this.model,
            max_tokens: 300,
            messages: [{ role: "user", content: prompt }]
          })
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
          const lines = text.split('\n').filter(l => l.trim().length > 0);
          short = short || lines[0]?.replace(/SHORT:?\s*/i, '').trim() || "";
          if (lines.length > 1) vivid = vivid || lines.slice(1).join(' ').replace(/VIVID:?\s*/i, '').trim() || "";
        }

        if (short) return { short, vivid };
      } catch (err) {
        console.error("Ball Regenerate AI Error:", err.message);
      }
    }

    const fallbackShort = `${bowlerName} to ${batsmanName}, corrected: ${newType} for ${newRuns} run${newRuns !== 1 ? "s" : ""}`;
    const fallbackVivid = `The ball was delivery ${newType} and played by ${batsmanName} for ${newRuns} runs. Corrected from the previous entry.`;
    return { short: fallbackShort, vivid: fallbackVivid };
  }
}

export default new AICommentaryService();
