import Player from "../models/Player.js";
import Team from "../models/Team.js";
import Match from "../models/Match.js";
import { emitToAll } from "../socket/socket.js";
import { deleteStoredFile, deleteStoredFiles } from "../utils/photoStore.js";
import { recordAudit } from "../utils/audit.js";
import * as playerService from "../services/playerService.js";
import { applyPlayerFieldPolicy, resolvePlayerWriteAccess } from "../middleware/playerAccess.js";
import {
  PLAYER_ROSTER_SELECT,
  playerSelectFor,
  playerTeamSelectFor,
  resolveViewerContext,
  sanitizePlayerPublic,
  sanitizePlayersPublic,
  hiddenTeamIds,
  reservedNamesMongoClause,
} from "../utils/publicProjection.js";

const isTransientDbError = (error) => (
  error?.name === "MongooseError" ||
  error?.name === "MongoServerSelectionError" ||
  error?.name === "MongoNetworkTimeoutError" ||
  /timed out|buffering|not connected/i.test(error?.message || "")
);

// Admin forms submit team as "" for a free agent ("Agent (No Team)") and Team
// is an ObjectId, so an empty string would throw a Mongoose CastError and fail
// the whole create/update with a 500. Strip empty optional ObjectId fields.
export const normalizeEmptyOptionalIds = (body) => {
  if (!body || typeof body !== "object") return body;
  if (body.team == null || body.team === "") delete body.team;
  return body;
};

export const getPlayers = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = "", team = "", campus = "", category, subCategory, ageGroup, organization, city } = req.query;
    const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 100);
    const safePage = Math.max(Number(page) || 1, 1);
    const query = {};

    if (search) {
      // Escape the term: an unescaped user-supplied regex is a ReDoS vector
      // and lets a caller inject alternations that match everything.
      const term = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (term) {
        query.$or = [
          { name: { $regex: term, $options: "i" } },
          { role: { $regex: term, $options: "i" } },
          { organization: { $regex: term, $options: "i" } }
        ];
      }
    }
    if (team) query.team = team;
    // The Admin app sends `campus`; the old filter read it but wrote the regex
    // unescaped, and `subCategory`/`organization`/`city` had the same problem.
    const like = (value) => ({ $regex: String(value).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" });
    if (campus) query.campus = like(campus);
    if (category) query.category = category;
    if (subCategory) query.subCategory = like(subCategory);
    if (ageGroup) query.ageGroup = ageGroup;
    if (organization) query.organization = like(organization);
    if (city) query["address.city"] = like(city);

    const skip = (safePage - 1) * safeLimit;
    // Resolve the viewer before querying: the projection depends on whether
    // anyone is identified at all.
    const viewer = await resolveViewerContext(req);

    // Fix B: the public player directory does not list fixtures, nor the players
    // of a team the owner has hidden. A `?team=` filter still works — a hidden
    // team's roster is simply empty for a public caller, which is the same
    // answer `GET /teams/:id/players` gives. Platform admins (the Admin app's
    // player manager) are exempt.
    if (!viewer.isPlatformAdmin) {
      const excluded = await hiddenTeamIds();
      const andClauses = [reservedNamesMongoClause("name")];
      if (excluded.length) andClauses.push({ team: { $nin: excluded } });
      query.$and = [...(query.$and || []), ...andClauses];
    }

    const [totalPlayers, players] = await Promise.all([
      Player.countDocuments(query).maxTimeMS(5000),
      // Round 5: load only what the caller is entitled to, instead of loading
      // everything and stripping afterwards. `.lean()` on a bare `find()` used
      // to ship birthInfo/address/gallery/videos/createdBy to anonymous callers.
      Player.find(query)
        .select(playerSelectFor(viewer))
        .populate("team", playerTeamSelectFor(viewer))
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(safeLimit)
        .maxTimeMS(5000)
        .lean(),
    ]);

    res.json({
      players: sanitizePlayersPublic(players, { viewer }),
      totalPlayers,
      totalPages: Math.ceil(totalPlayers / safeLimit),
      currentPage: safePage,
    });
  } catch (error) {
    if (isTransientDbError(error)) {
      return res.json({ players: [], totalPlayers: 0, totalPages: 0, currentPage: Number(req.query.page || 1) });
    }
    res.status(500).json({ message: "Failed to fetch players", error: error.message });
  }
};

export const getPlayer = async (req, res) => {
  try {
    const viewer = await resolveViewerContext(req);
    const player = await Player.findById(req.params.id)
      .select(playerSelectFor(viewer))
      .populate("team", playerTeamSelectFor(viewer));
    if (!player) return res.status(404).json({ message: "Player not found" });

    // Round 5: the whole body-shaping that used to live here was a partial,
    // hand-rolled blacklist — it deleted `email`/`phone`/`contact`, none of
    // which exist on the Player schema (a dead branch), left `address.country`
    // behind, and never touched `birthInfo`, `gallery` or `videos`.
    // `sanitizePlayerPublic` is a whitelist that honours the privacy flags and
    // still shows the creator and the owning organization's managers the full
    // document.
    res.json(sanitizePlayerPublic(player, { viewer }));
  } catch (err) {
    res.status(500).json({ message: "Error fetching player" });
  }
};

/**
 * GET /api/players/free-agents
 *
 * Round 5: this used to be an inline route handler that returned
 * `playerService.getFreeAgents()` verbatim, so it was the one public player read
 * that never went through a projection - the narrowed `.select()` stopped the
 * worst of it, but `address` and `socialLinks` still ignored the privacy flags.
 * It lives here now so the behaviour is covered by the same tests as every other
 * public read.
 */
export const listFreeAgents = async (req, res) => {
  try {
    const viewer = await resolveViewerContext(req);
    const { search } = req.query;
    // Fix B: a fixture player is never offered as a free agent to the public.
    const result = await playerService.getFreeAgents(search, {
      excludeReservedTestNames: !viewer.isPlatformAdmin,
    });
    res.status(200).json({ ...result, items: sanitizePlayersPublic(result.items, { viewer }) });
  } catch (err) {
    res.status(500).json({ message: "Error fetching free agents" });
  }
};

export const getPlayerMatches = async (req, res) => {
  try {
    const playerId = req.params.id;
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const exists = await Player.exists({ _id: playerId });

    if (!exists) {
      return res.status(404).json({ message: "Player not found" });
    }

    const matches = await Match.find({
      $or: [
        { "playingXI.players": playerId },
        { "squad15.players": playerId },
        { "innings.batting.player": playerId },
        { "innings.bowling.player": playerId },
        { "innings.oversHistory.balls.batsmanOnStrike": playerId },
        { "innings.oversHistory.balls.batsmanNonStrike": playerId },
        { "innings.oversHistory.balls.bowler": playerId },
        { "innings.oversHistory.balls.dismissedPlayer": playerId },
        { "innings.oversHistory.balls.fielder": playerId },
      ],
    })
      .select("title venue matchType tournament teams innings currentInnings status result startAt createdAt updatedAt")
      .populate("teams", "name shortName logo")
      .populate("tournament", "name shortName slug")
      .populate("innings.team", "name shortName logo")
      .populate("result.winner", "name shortName logo")
      .sort({ startAt: -1, updatedAt: -1 })
      .limit(limit)
      .lean();

    res.json({ matches });
  } catch (err) {
    res.status(500).json({ message: "Error fetching player matches" });
  }
};

export const createPlayer = async (req, res) => {
  try {
    normalizeEmptyOptionalIds(req.body);
    // createdBy is the whole basis of "you can edit this later". It is set from
    // the session, never from the body, so a caller cannot claim authorship of
    // somebody else's profile.
    const player = await Player.create({ ...req.body, createdBy: req.user._id });
    const populated = await Player.findById(player._id).populate("team", "name");

    // If a team was assigned, add this player to the team's players array
    if (player.team) {
      await Team.findByIdAndUpdate(
        player.team,
        { $addToSet: { players: player._id } }
      );
    }

    await recordAudit({
      req,
      action: "player.created",
      targetType: "player",
      targetId: populated._id,
      targetLabel: populated.name,
    });

    emitToAll("players:updated");
    res.status(201).json(populated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error creating player" });
  }
};

/** Profiles this account created â€” the self-service list on the User site. */
export const getMyPlayers = async (req, res) => {
  try {
    const players = await Player.find({ createdBy: req.user._id })
      .populate("team", "name shortName logo")
      .sort({ createdAt: -1 })
      .lean();
    res.status(200).json({ items: players, total: players.length });
  } catch (err) {
    res.status(500).json({ message: "Failed to load your players" });
  }
};

export const updatePlayer = async (req, res) => {
  try {
    const existing = await Player.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: "Player not found" });

    const access = await resolvePlayerWriteAccess(req, existing);
    if (!access.allowed) {
      return res.status(403).json({
        message: access.reason,
        code: "PLAYER_WRITE_FORBIDDEN",
      });
    }

    normalizeEmptyOptionalIds(req.body);
    const { payload, stripped } = applyPlayerFieldPolicy(req.body, access);
    const oldTeamId = existing.team?.toString();
    const newTeamId = payload.team?.toString();
    const oldImageUrl = existing.imageUrl;

    const player = await Player.findByIdAndUpdate(
      req.params.id,
      payload,
      { new: true }
    ).populate("team", "name");

    // Remove the previous portrait once it is replaced or cleared.
    if (oldImageUrl && payload.imageUrl !== undefined && oldImageUrl !== payload.imageUrl) {
      await deleteStoredFile(oldImageUrl).catch(() => {});
    }

    // If team changed, update the teams' players arrays
    if (oldTeamId !== newTeamId) {
      // Remove from old team
      if (oldTeamId) {
        await Team.findByIdAndUpdate(
          oldTeamId,
          { $pull: { players: player._id } }
        );
      }
      // Add to new team
      if (newTeamId) {
        await Team.findByIdAndUpdate(
          newTeamId,
          { $addToSet: { players: player._id } }
        );
      }
    }

    await recordAudit({
      req,
      organization: access.organization,
      action: "player.updated",
      targetType: "player",
      targetId: player._id,
      targetLabel: player.name,
      metadata: { via: access.via, fields: Object.keys(payload), stripped },
    });

    emitToAll("players:updated");
    res.json(stripped.length ? { ...player.toObject(), ignoredFields: stripped } : player);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error updating player" });
  }
};

export const deletePlayer = async (req, res) => {
  try {
    const player = await Player.findById(req.params.id);
    if (!player) return res.status(404).json({ message: "Player not found" });

    const access = await resolvePlayerWriteAccess(req, player);
    if (!access.allowed) {
      return res.status(403).json({
        message: access.reason,
        code: "PLAYER_WRITE_FORBIDDEN",
      });
    }

    if (player.team) {
      await Team.findByIdAndUpdate(
        player.team,
        { $pull: { players: player._id } }
      );
    }
    await Player.findByIdAndDelete(req.params.id);
    if (player.imageUrl) {
      await deleteStoredFile(player.imageUrl).catch(() => {});
    }

    await recordAudit({
      req,
      organization: access.organization,
      action: "player.deleted",
      targetType: "player",
      targetId: player._id,
      targetLabel: player.name,
      metadata: { via: access.via },
    });

    emitToAll("players:updated");
    res.json({ message: "Deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error deleting player" });
  }
};

export const bulkDeletePlayers = async (req, res) => {
  try {
    const { playerIds } = req.body;

    if (!playerIds || !Array.isArray(playerIds) || playerIds.length === 0) {
      return res.status(400).json({ message: "Player IDs array is required" });
    }

    // Get all players to be deleted to find their teams
    const players = await Player.find({ _id: { $in: playerIds } });

    // Get unique team IDs
    const teamIds = [...new Set(
      players
        .filter(p => p.team)
        .map(p => p.team.toString())
    )];

    // Remove players from their teams
    for (const teamId of teamIds) {
      await Team.findByIdAndUpdate(
        teamId,
        { $pull: { players: { $in: playerIds } } }
      );
    }

    // Delete all players
    const result = await Player.deleteMany({ _id: { $in: playerIds } });
    const removedImageUrls = players.map((p) => p.imageUrl).filter(Boolean);
    if (removedImageUrls.length) {
      await deleteStoredFiles(removedImageUrls).catch(() => {});
    }

    emitToAll("players:updated");
    res.json({
      message: "Players deleted successfully",
      deletedCount: result.deletedCount
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error deleting players" });
  }
};

// Round 5: this used to be `Player.find()` with no filter, no `.select()` and no
// `.limit()`, then `res.json` of every document with `...p._doc` spread in. On
// the local database that was a single response carrying all 1,324 players
// including date of birth and address. It is now paginated and projected.
export const getPlayerRanking = async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const viewer = await resolveViewerContext(req);
    const filter = {};

    // Fix B: same rule as the directory — fixtures and the players of hidden
    // teams are not ranked in public.
    if (!viewer.isPlatformAdmin) {
      const excluded = await hiddenTeamIds();
      filter.$and = [reservedNamesMongoClause("name")];
      if (excluded.length) filter.$and.push({ team: { $nin: excluded } });
    }

    const [total, players] = await Promise.all([
      Player.countDocuments(filter).maxTimeMS(5000),
      Player.find(filter)
        .select(playerSelectFor(viewer))
        .populate("team", playerTeamSelectFor(viewer))
        .sort({ "stats.runs": -1, "stats.wickets": -1, updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .maxTimeMS(5000)
        .lean(),
    ]);

    const ranked = sanitizePlayersPublic(players, { viewer }).map((p) => ({
      ...p,
      rankingPoints: (p.stats?.runs || 0) * 1 + (p.stats?.wickets || 0) * 25,
    }));

    res.json({
      items: ranked,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
    });
  } catch (err) {
    res.status(500).json({ message: "Error fetching player ranking" });
  }
};

export const getHeadToHead = async (req, res) => {
  try {
    const { batsmanId, bowlerId } = req.params;

    const [batsman, bowler] = await Promise.all([
      Player.findById(batsmanId).select("name playingRole"),
      Player.findById(bowlerId).select("name playingRole"),
    ]);

    if (!batsman || !bowler) {
      return res.status(404).json({ message: "Player not found" });
    }

    const matches = await Match.find({
      $and: [
        { "innings.oversHistory.balls.batsmanOnStrike": batsmanId },
        { "innings.oversHistory.balls.bowler": bowlerId },
      ],
    })
      .select("title startAt innings.oversHistory.balls")
      .lean();

    let ballsFaced = 0, runsScored = 0, fours = 0, sixes = 0, dismissals = 0;
    let dismissalTypes = [];

    for (const match of matches) {
      for (const inn of match.innings || []) {
        for (const over of inn.oversHistory || []) {
          for (const ball of over.balls || []) {
            const striker = ball.batsmanOnStrike?.toString();
            const bowler = ball.bowler?.toString();
            if (striker === batsmanId && bowler === bowlerId) {
              ballsFaced++;
              runsScored += ball.runs || 0;
              if (ball.runs === 4) fours++;
              if (ball.runs === 6) sixes++;
              if (ball.isWicket && !ball.wicketCancelled) {
                dismissals++;
                if (ball.wicketType && !["run out", "obstructing the field", "retired hurt"].includes(ball.wicketType)) {
                  dismissalTypes.push(ball.wicketType);
                }
              }
            }
          }
        }
      }
    }

    res.json({
      batsman: { _id: batsman._id, name: batsman.name, playingRole: batsman.playingRole },
      bowler: { _id: bowler._id, name: bowler.name, playingRole: bowler.playingRole },
      ballsFaced,
      runsScored,
      fours,
      sixes,
      dismissals,
      dismissalTypes: [...new Set(dismissalTypes)],
      strikeRate: ballsFaced > 0 ? ((runsScored / ballsFaced) * 100).toFixed(1) : "0.0",
      average: dismissals > 0 ? (runsScored / dismissals).toFixed(2) : "â€”",
      matchesPlayed: matches.length,
    });
  } catch (err) {
    res.status(500).json({ message: "Error fetching head-to-head data", error: err.message });
  }
};
