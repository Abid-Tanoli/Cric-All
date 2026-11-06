const OVERS_EPSILON = 1e-6;
const MAX_WHOLE_OVERS = 999;

const invalidOvers = (reason) => ({
  valid: false,
  overs: 0,
  ballsInOver: 0,
  balls: 0,
  value: null,
  reason,
});

export function normalizeOvers(value) {
  if (value === "" || value == null) {
    return { valid: true, overs: 0, ballsInOver: 0, balls: 0, value: 0, reason: "" };
  }

  let numeric;
  if (typeof value === "number") {
    numeric = value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return { valid: true, overs: 0, ballsInOver: 0, balls: 0, value: 0, reason: "" };
    }
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) {
      return invalidOvers(`Overs "${value}" must look like 12 or 19.4`);
    }
    numeric = Number(trimmed);
  } else {
    return invalidOvers(`Overs "${String(value)}" must look like 12 or 19.4`);
  }

  if (!Number.isFinite(numeric) || numeric < 0) {
    return invalidOvers(`Overs "${String(value)}" must look like 12 or 19.4`);
  }

  const tenths = Math.round(numeric * 10);
  if (!Number.isFinite(tenths) || Math.abs(numeric - tenths / 10) > OVERS_EPSILON) {
    return invalidOvers(`Overs "${String(value)}" must look like 12 or 19.4`);
  }

  const overs = Math.floor(tenths / 10);
  const ballsInOver = tenths % 10;
  if (ballsInOver > 5) {
    return invalidOvers(`Overs "${String(value)}" has more than 5 balls in the final over`);
  }
  if (overs > MAX_WHOLE_OVERS) {
    return invalidOvers(`Overs "${String(value)}" must look like 12 or 19.4`);
  }

  return {
    valid: true,
    overs,
    ballsInOver,
    balls: overs * 6 + ballsInOver,
    value: tenths / 10,
    reason: "",
  };
}

export function parseOvers(value) {
  return normalizeOvers(value);
}

/**
 * Format a stored over figure, preferring an integer legal-ball count when one
 * is supplied. Invalid text is preserved so callers can reject it explicitly.
 */
export function formatOvers(overs, balls) {
  if (balls !== undefined && balls !== null && balls !== "") {
    const ballCount = typeof balls === "number"
      ? balls
      : typeof balls === "string" && /^\d+$/.test(balls)
        ? Number(balls)
        : NaN;
    if (Number.isSafeInteger(ballCount) && ballCount >= 0) {
      return `${Math.floor(ballCount / 6)}.${ballCount % 6}`;
    }
    return String(overs ?? "");
  }

  const normalized = normalizeOvers(overs);
  if (!normalized.valid) return String(overs ?? "");
  return `${normalized.overs}.${normalized.ballsInOver}`;
}

export const formatOversLabel = (balls = 0) => formatOvers(undefined, balls) || "0.0";

export const toOverFigure = (parsed) =>
  parsed?.valid ? Number(`${parsed.overs}.${parsed.ballsInOver}`) : 0;

export default { normalizeOvers, parseOvers, formatOvers, formatOversLabel, toOverFigure };
