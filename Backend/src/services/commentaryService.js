import Ball from "../models/Ball.js";
import { getIO } from "../socket/socket.js";
import { isAiCommentaryEnabled } from "./aiCommentary.js";
import fetch from "node-fetch";

export function buildCommentaryPrompt(data) {
  return `
You are a professional cricket commentator. Generate ONE line of exciting ball-by-ball commentary.

Ball Info:
- Bowler: ${data.bowlerName}
- Batsman: ${data.batsmanName}
- Runs scored: ${data.runs}
- Wicket: ${data.isWicket}
- Pitch Line: ${data.pitchLine}
- Pitch Length: ${data.pitchLength}
- Shot Played: ${data.shotType}
- Ball went to: ${data.groundZone}
- Fielded by: ${data.fieldedByName || "none"} at ${data.fieldedByPosition || "unknown"}
- Score: ${data.teamRunsSoFar}/${data.wicketsSoFar} (Over ${data.currentOver})

Commentary Rules:
1. FIRST LINE: "${data.bowlerName} to ${data.batsmanName}, [runs so far in innings] runs scored so far"
2. SECOND LINE: Start with pitch length and line (e.g. "Good length delivery outside off stump"), then describe the shot ("${data.shotType}"), then where it went, then fielder if applicable
3. Add expression based on outcome:
   - Six: "BOOM! That's gone into the crowd! Maximum!"
   - Four: "FOUR! Beautifully timed!"
   - Wicket: "OUT! What a delivery!"
   - Good fielding: "Brilliant stop in the field!"
   - Dot ball: "Tight bowling, nothing to hit there."
4. Keep it under 3 sentences total
5. Sound like a real TV commentator
`;
}

function generateFallbackCommentary(data) {
  const { bowlerName, batsmanName, runs, isWicket, pitchLength, pitchLine, shotType, groundZone, fieldedByName, fieldedByPosition } = data;
  const lines = [];
  lines.push(`${bowlerName} to ${batsmanName}.`);

  if (pitchLength && pitchLine) {
    lines.push(`${pitchLength} delivery ${pitchLine.replace("-", " ")}.`);
  }

  if (shotType) {
    lines.push(`Plays the ${shotType}`);
    if (groundZone) lines.push(`towards ${groundZone.replace("-", " ")}`);
    lines.push(".");
  }

  if (isWicket) {
    lines.push("OUT! What a delivery!");
  } else if (runs === 6) {
    lines.push("BOOM! That's gone into the crowd! Maximum!");
  } else if (runs === 4) {
    lines.push("FOUR! Beautifully timed!");
  } else if (fieldedByName) {
    lines.push(`${fieldedByName} at ${fieldedByPosition} with the fielding.`);
  } else if (runs === 0) {
    lines.push("Tight bowling, nothing to hit there.");
  }

  return lines.join(" ");
}

async function callAI(prompt) {
  // The same platform kill switch gates this admin on-demand path: when AI
  // commentary is off no provider (claude/openai) is called at all.
  if (!(await isAiCommentaryEnabled())) return null;

  const provider = process.env.AI_PROVIDER || "none";

  if (provider === "claude" && process.env.ANTHROPIC_API_KEY) {
    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const msg = await anthropic.messages.create({
        model: process.env.AI_MODEL || "claude-sonnet-4-20250514",
        max_tokens: 150,
        messages: [{ role: "user", content: prompt }],
      });
      return msg.content[0].text;
    } catch (e) {
      console.warn("Claude API error, using fallback:", e.message);
      return null;
    }
  }

  if (provider === "openai" && process.env.OPENAI_API_KEY) {
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: process.env.AI_MODEL || "gpt-4",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 150,
        }),
      });
      if (!response.ok) {
        throw new Error(`OpenAI API returned ${response.status}`);
      }
      const resp = await response.json();
      return resp.choices[0].message.content;
    } catch (e) {
      console.warn("OpenAI API error, using fallback:", e.message);
      return null;
    }
  }

  return null;
}

export async function generateCommentaryForBall(ballData) {
  const prompt = buildCommentaryPrompt(ballData);
  const aiResult = await callAI(prompt);
  return aiResult || generateFallbackCommentary(ballData);
}

export async function saveAndEmitCommentary(ballId, commentary, ballData) {
  if (!ballId) return;

  try {
    await Ball.findByIdAndUpdate(ballId, {
      commentary,
      commentaryGeneratedAt: new Date(),
    });
  } catch (e) {
    console.warn("Failed to save commentary to ball:", e.message);
  }

  try {
    const io = getIO();
    if (io) {
      io.to(`match-${ballData.matchId}`).emit("commentary", {
        ballId,
        commentary,
        bowler: ballData.bowlerName,
        batsman: ballData.batsmanName,
        runs: ballData.runs,
        isWicket: ballData.isWicket,
        over: ballData.overNumber ?? ballData.currentOver,
        ballNumber: ballData.ballNumber,
        displayBallNumber: ballData.displayBallNumber,
        matchId: ballData.matchId,
        fieldedByName: ballData.fieldedByName || "",
        fieldedByPosition: ballData.fieldedByPosition || "",
      });
    }
  } catch (e) {
    console.warn("Failed to emit commentary:", e.message);
  }
}
