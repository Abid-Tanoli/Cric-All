import { z } from "zod";

const objectIdPattern = /^[a-fA-F0-9]{24}$/;
const objectId = z.string().regex(objectIdPattern, "Invalid ObjectId");
const nullableObjectId = objectId.nullable().default(null);

export const updateScoreSchema = z.object({
  inningsIndex: z.number().int().min(0),
  runs: z.number().int().min(0).max(6).default(0),
  isWide: z.boolean().default(false),
  isNoBall: z.boolean().default(false),
  isBye: z.boolean().default(false),
  isLegBye: z.boolean().default(false),
  isWicket: z.boolean().default(false),
  wicketType: z.string().default(""),
  dismissedPlayerId: nullableObjectId,
  fielderId: nullableObjectId,
  batsmanOnStrikeId: objectId,
  batsmanNonStrikeId: objectId,
  bowlerId: objectId,
  commentaryText: z.string().default(""),
  customCommentary: z.boolean().default(false),
  shotPlacement: z.object({
    angle: z.number().default(0),
    distance: z.number().default(50),
    position: z.string().default(""),
    side: z.string().optional(),
    nearestPosition: z.string().optional(),
  }).nullable().default(null),
  fieldingZone: z.string().default(""),
  shotType: z.string().default(""),
  pitchZone: z.string().default(""),
  ballMovement: z.string().default("none"),
  ballOutcome: z.string().default("played"),
  pitchLine: z.string().default(""),
  pitchLength: z.string().default(""),
  pitchShotType: z.string().default(""),
  pitchX: z.number().nullable().default(null),
  pitchY: z.number().nullable().default(null),
  nextBatsmanId: nullableObjectId,
  didCross: z.boolean().optional(),
  wicketDidCross: z.boolean().optional(),
  groundZone: z.string().default(""),
  fieldedByPosition: z.string().default(""),
  shotTypeName: z.string().default(""),
  isAppeal: z.boolean().default(false),
});

export const editCommentarySchema = z.object({
  inningsIndex: z.number().int().min(0),
  overNumber: z.number().int().min(1),
  ballNumber: z.number().int().min(1),
  newCommentary: z.string().min(1, "Commentary text is required"),
});

export const handleFieldClickSchema = z.object({
  x: z.number(),
  y: z.number(),
  runs: z.number().int().min(0).optional(),
  isWicket: z.boolean().optional().default(false),
  wicketType: z.string().optional().default(""),
  overNumber: z.number().int().min(1).optional(),
  ballNumber: z.number().int().min(1).optional(),
  isAppeal: z.boolean().optional().default(false),
});

export const revertLastBallSchema = z.object({
  inningsIndex: z.number().int().min(0),
});

export const setBowlerSchema = z.object({
  inningsIndex: z.number().int().min(0),
  bowlerId: objectId,
  completeOverReplacement: z.boolean().optional().default(false),
});

export const endInningsSchema = z.object({
  inningsIndex: z.number().int().min(0),
});

export const startNextInningsSchema = z.object({}).strict();

export const reduceOversSchema = z.object({
  newTotalOvers: z.number().int().min(1).max(100),
});

export const resetInningsSchema = z.object({
  inningsIndex: z.number().int().min(0),
});

export const resolveTieSchema = z.object({
  resolution: z.enum(["declared_tie", "super_over"]),
});

export const startSuperOverInningsSchema = z.object({
  batsmenIds: z.array(objectId).min(2).max(2),
  bowlerId: objectId,
});

export const retireBatsmanSchema = z.object({
  inningsIndex: z.number().int().min(0),
  playerId: objectId,
  type: z.enum(["retired_hurt", "retired"]),
});

export const editBallSchema = z.object({
  inningsIndex: z.number().int().min(0),
  overNumber: z.number().int().min(1),
  ballNumber: z.number().int().min(1),
  runs: z.number().int().min(0).max(6).optional().default(0),
  isWide: z.boolean().optional().default(false),
  isNoBall: z.boolean().optional().default(false),
  isBye: z.boolean().optional().default(false),
  isLegBye: z.boolean().optional().default(false),
  isWicket: z.boolean().optional().default(false),
  wicketType: z.string().optional().default(""),
  commentary: z.string().optional(),
  vividCommentary: z.string().optional(),
});

export const recordDRSReviewSchema = z.object({
  teamId: objectId,
  result: z.enum(["upheld", "overturned", "umpire_call"]),
  type: z.enum(["lbw", "caught", "other"]),
  over: z.number().int().min(0),
  ball: z.number().int().min(1),
});

export const useStrategicTimeoutSchema = z.object({
  teamId: objectId,
});
