const EPSILON = 1e-6;

export function normalizeOversText(value) {
  if (value === "" || value == null) return "";
  if (typeof value !== "number" && typeof value !== "string") return String(value);

  const text = String(value).trim();
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return String(value);
  const numeric = Number(text);
  if (!Number.isFinite(numeric) || numeric < 0) return String(value);

  const tenths = Math.round(numeric * 10);
  if (Math.abs(numeric - tenths / 10) > EPSILON) return String(value);

  const overs = Math.floor(tenths / 10);
  const ballsInOver = tenths % 10;
  if (ballsInOver > 5 || overs > 999) return String(value);
  return `${overs}.${ballsInOver}`;
}

export function formatOversFromBalls(balls) {
  const ballCount = Number(balls);
  if (!Number.isSafeInteger(ballCount) || ballCount < 0) return "";
  return `${Math.floor(ballCount / 6)}.${ballCount % 6}`;
}
