// AI Commentary Generation Service — ESPNcricinfo Style
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
      pitchLine = "", pitchLength = "", pitchShotType = "",
      distanceCategory = "",
      overNumber = 0, ballNumber = 1,
      currentScore = 0, currentWickets = 0,
      matchContext = {}
    } = data;

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
        const prompt = `You are a professional cricket commentator in the style of ESPNcricinfo.
        
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

        result.short = short || "";
        result.vivid = vivid || "";
      } catch (err) {
        console.error("AI Commentary Error:", err.message);
      }
    }

    // fallback logic
    if (!result.short) {
      const getRunLabel = () => {
        if (isWicket) return "out!";
        if (isWide) return "wide";
        if (isNoBall) return "no ball";
        if (runs === 0) return "no run";
        if (runs === 1) return "1 run";
        if (runs === 4) return "4 runs (FOUR)";
        if (runs === 6) return "6 runs (SIX)";
        return `${runs} runs`;
      };
      result.short = `${bowlerName} to ${batsmanName}, ${getRunLabel()}`;
    }

    if (!result.vivid) {
      const actions = {
        dot: [
          `kept it out with a compact ${shotText}`,
          `could only check the ${shotText} straight to the ring`,
          `was beaten as the ball held its line`,
          `left it alone with the keeper gathering cleanly`,
          `turned it to the leg side but found no gap`
        ],
        runs: [
          `worked it into the gap with a controlled ${shotText}`,
          `used soft hands and ran hard`,
          `picked the line early and rotated the strike`,
          `met it under the eyes and placed it neatly`
        ],
        four: [
          `opened the face and sent the ${shotText} skimming away`,
          `timed it sweetly and beat the infield`,
          `got into position early and found the rope`,
          `struck through the line with clean balance`
        ],
        six: [
          `swung through the line and cleared the boundary`,
          `picked the length early and launched it high`,
          `held the shape and sent it over the rope`,
          `connected cleanly, the ball sailing beyond the fielder`
        ],
        wicket: [
          `was beaten by the ${pitchDetail} delivery and paid the price`,
          `misread the ${lengthText} ball and the wicket followed`,
          `could not control the ${shotText}, and the bowler has the breakthrough`,
          `was forced into a mistake by the ${lineText} angle`
        ]
      };

      const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

      let category = "runs";
      if (isWicket) category = "wicket";
      else if (runs === 0) category = "dot";
      else if (runs === 4) category = "four";
      else if (runs === 6) category = "six";

      const action = rand(actions[category]);
      const region = (direction || nearestPosition || zone) ? ` toward ${direction || nearestPosition || zone}` : "";

      result.vivid = `${bowlerName} hit ${pitchDetail}. ${batsmanName} ${action}${region}.`;
    }

    return result;
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
        const prompt = `You are an ESPNcricinfo pundit analyst.

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
ESPNcricinfo pundit style. No emojis. Plain flowing text only.`;

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

ESPNcricinfo style, no emojis.`;

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
