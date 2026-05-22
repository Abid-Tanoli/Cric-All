import Anthropic from '@anthropic-ai/sdk';

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const rewriteCache = new Map();

export async function rewriteInBQStyle(originalCommentary, ballData = {}) {
  if (!originalCommentary || originalCommentary.length < 5) return originalCommentary;
  if (!client) return originalCommentary;

  const key = originalCommentary.slice(0, 80);
  if (rewriteCache.has(key)) return rewriteCache.get(key);

  try {
    const response = await client.messages.create({
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
  if (!client) return null;

  try {
    const response = await client.messages.create({
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
