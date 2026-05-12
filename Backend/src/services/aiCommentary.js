// AI Commentary Generation Service — ESPNcricinfo Style
// Using claude-sonnet-4-20250514 as specified by user
// Parts 4, 5, 6: Per-ball, Over Summary, Ball Edit prompts

import fetch from "node-fetch";

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
      distanceCategory = "",
      overNumber = 0, ballNumber = 1,
      currentScore = 0, currentWickets = 0,
      matchContext = {}
    } = data;

    const deliveryType = isWide ? "wide" : isNoBall ? "no_ball" : isBye ? "bye" : isLegBye ? "leg_bye" : "normal";
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
- Runs This Ball: ${runs}${isWide ? ` (Wide +${runs})` : ""}${isNoBall ? " (No Ball)" : ""}
- Shot Direction: ${direction || zone || "unknown area"}${side ? ` (${side})` : ""}${nearestPosition ? ` near ${nearestPosition}` : ""}
- Distance: ${distanceCategory || "standard"}
${boundaryNote ? `- Boundary Detail: ${boundaryNote}` : ""}
${isWicket ? `- WICKET: ${wicketType}` : ""}
- Match Situation: ${matchSit}

Task: Generate two specific lines of commentary.
1. SHORT: A punchy, traditional scorecard-style summary. Format: '[Bowler] to [Batter], [Result]'.
2. VIVID: A rich, technical paragraph (2-3 sentences). Use evocative verbs, describe the movement of the ball, the sound off the willow, and the fielders' scramble. Avoid repetitive structures.

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
          "defended solidly back to the bowler, no run",
          "pushed into the off-side, finds the fielder",
          "beaten by the movement, through to the keeper",
          "left alone as it angled across the off stump",
          "tucked away to mid-wicket but no gap found"
        ],
        runs: [
          "nudged into the gap for a quick single",
          "punched off the back foot through the covers for a couple",
          "flicked away to the leg side, easy runs taken",
          "driven straight down the ground to keep the score moving"
        ],
        four: [
          "lashed through the covers, a magnificent boundary",
          "timed to perfection, the ball races away to the ropes",
          "a delightful drive that beats the diving fielder for four",
          "pulled powerfully into the gap, no chance for the deep fielder"
        ],
        six: [
          "lofted high and handsome over the ropes for a massive hit",
          "cleared the boundary with ease, a spectacular strike",
          "picked up from outside off and deposited into the stands",
          "a towering hit that sails over the long-on boundary"
        ],
        wicket: [
          "stunned as the stumps are rattled, a perfect delivery",
          "finds the fielder with a mistimed shot, the catch is taken",
          "trapped in front, the umpire's finger goes up immediately",
          "an edge that carries safely to the keeper, big wicket!"
        ]
      };

      const lengths = ["full and searching", "short and aggressive", "good length", "yorker length", "overpitched"];
      const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

      let category = "runs";
      if (isWicket) category = "wicket";
      else if (runs === 0) category = "dot";
      else if (runs === 4) category = "four";
      else if (runs === 6) category = "six";

      const action = rand(actions[category]);
      const region = (direction || nearestPosition || zone) ? ` toward ${direction || nearestPosition || zone}` : "";
      const length = rand(lengths);

      result.vivid = `The bowler delivered a ${length} ball, and ${batsmanName} ${action}${region}.`;
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
