import Match from "../models/Match.js";
import User from "../models/User.js";
import Delivery from "../models/Delivery.js";
import Partnership from "../models/Partnership.js";
import MatchAnalytics from "../models/MatchAnalytics.js";
import Review from "../models/Review.js";
import MatchOfficial from "../models/MatchOfficial.js";
import { getIO, emitBallUpdate, emitMatchStatusChange, emitWicketAlert, emitMilestoneAlert, emitInningsComplete, emitDRSUpdate, emitUmpireSignal } from "../socket/socket.js";

export async function getMatchPartnerships(req, res) {
  try {
    const { id, inning } = req.params;
    const partnerships = await Partnership.find({ matchId: id, inning: parseInt(inning) }).sort({ wicketNumber: 1 });
    res.json(partnerships);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getActivePartnership(req, res) {
  try {
    const { id, inning } = req.params;
    const partnership = await Partnership.findOne({ matchId: id, inning: parseInt(inning), isActive: true });
    res.json(partnership || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getWagonWheelData(req, res) {
  try {
    const { id, inning, batsmanId } = req.params;
    const query = { matchId: id, inning: parseInt(inning) };
    if (batsmanId) query.batsmanId = batsmanId;
    
    let deliveries = await Delivery.find(query).sort({ overNumber: 1, ballNumber: 1 });
    
    // Fallback: extract from match oversHistory if Delivery collection is empty
    if (deliveries.length === 0) {
      const match = await Match.findById(id);
      if (match && match.innings) {
        const inningIdx = parseInt(inning) - 1;
        const inningData = match.innings[inningIdx];
        if (inningData && inningData.oversHistory) {
          const directionMap = {
            'cover': 30, 'mid-off': 15, 'long-off': 20, 'extra-cover': 25,
            'point': 45, 'backward-point': 55, 'short-cover': 35,
            'mid-wicket': -20, 'square-leg': -30, 'fine-leg': -45,
            'long-on': -15, 'deep-mid-wicket': -25,
            'third-man': 60, 'deep-third-man': 65,
            'deep-square-leg': -55, 'short-fine-leg': -50,
            'straight-drive': 5, 'straight': 0, 'mid-on': -10,
            'wide-mid-on': -5, 'wide-mid-off': 10,
            'cow-corner': -35, 'deep-backward-point': 70,
            'slip': 75, 'gully': 65, 'leg-slip': -65,
          };
          const distanceMap = {
            'boundary': 'boundary', 'four': 'boundary', 'six': 'six',
            'outfield': 'outfield', 'infield': 'infield',
          };

          inningData.oversHistory.forEach((over) => {
            (over.balls || []).forEach((ball) => {
              if (batsmanId) {
                const ballBatsmanId = ball.batsmanOnStrike?._id?.toString() || ball.batsmanOnStrike?.toString() || '';
                if (ballBatsmanId !== batsmanId) return;
              }
              const position = (
                ball.shotPlacement?.position ||
                ball.shotDirection ||
                ball.fieldingZone ||
                ball.position ||
                ""
              );
              const pos = String(position).toLowerCase().replace(/[\s_]+/g, "-");
              const rawDirection = ball.shotPlacement?.angle ?? ball.direction ?? directionMap[pos];
              if (rawDirection == null || Number.isNaN(Number(rawDirection))) return;

              const rawDistance = ball.shotPlacement?.distance ?? ball.distance;
              const dist = typeof rawDistance === "number"
                ? rawDistance
                : distanceMap[pos] ?? distanceMap[String(rawDistance || "").toLowerCase()] ?? (ball.runs >= 4 ? 'boundary' : ball.runs >= 1 ? 'outfield' : 'infield');
              deliveries.push({
                runsOffBat: ball.runs || 0,
                extras: 0,
                shotDirection: Number(rawDirection),
                shotDistance: dist,
                overNumber: over.overNumber,
                ballNumber: ball.ballNumber || 1,
                isFour: ball.runs === 4,
                isSix: ball.runs === 6,
                shotType: ball.shotType || null,
              });
            });
          });
        }
      }
    }
    
    const shots = deliveries.map(d => ({
      runs: (d.runsOffBat ?? d.runs ?? 0) + (d.extras ?? 0),
      direction: d.shotDirection ?? d.direction ?? 0,
      distance: d.shotDistance ?? d.distance ?? 'infield',
      over: d.overNumber,
      ball: d.ballNumber,
      isFour: d.isFour ?? false,
      isSix: d.isSix ?? false,
      shotType: d.shotType
    }));
    
    res.json(shots);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getMatchAnalytics(req, res) {
  try {
    const { id } = req.params;
    let analytics = await MatchAnalytics.findOne({ matchId: id });
    
    if (!analytics) {
      analytics = new MatchAnalytics({ matchId: id });
      await analytics.save();
    }
    
    const match = await Match.findById(id);
    if (match) {
      const inning1 = match.innings[0];
      const inning2 = match.innings[1];
      
      analytics.inning1CurrentScore = inning1?.runs || 0;
      analytics.inning1Wickets = inning1?.wickets || 0;
      analytics.inning1Overs = inning1?.overs || 0;
      analytics.inning1Balls = inning1?.balls || 0;
      
      if (inning2) {
        analytics.inning2CurrentScore = inning2.runs || 0;
        analytics.inning2Wickets = inning2.wickets || 0;
        analytics.inning2Overs = inning2.overs || 0;
        analytics.inning2Balls = inning2.balls || 0;
        analytics.inning2Target = inning2.target || 0;
      }
    }
    
    res.json(analytics);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getMatchBoundaries(req, res) {
  try {
    const { id } = req.params;
    const analytics = await MatchAnalytics.findOne({ matchId: id });
    
    const match = await Match.findById(id);
    const inning1 = match?.innings[0];
    const inning2 = match?.innings[1];
    
    res.json({
      inning1: {
        fours: analytics?.totalFoursInning1 || 0,
        sixes: analytics?.totalSixesInning1 || 0,
        totalBoundaries: analytics?.totalBoundariesInning1 || 0,
        boundaryRuns: analytics?.boundaryRunsInning1 || 0,
        totalRuns: inning1?.runs || 0,
        dotBallPercent: analytics?.dotBallPercentInning1 || 0
      },
      inning2: {
        fours: analytics?.totalFoursInning2 || 0,
        sixes: analytics?.totalSixesInning2 || 0,
        totalBoundaries: analytics?.totalBoundariesInning2 || 0,
        boundaryRuns: analytics?.boundaryRunsInning2 || 0,
        totalRuns: inning2?.runs || 0,
        dotBallPercent: analytics?.dotBallPercentInning2 || 0
      },
      total: {
        fours: (analytics?.totalFoursInning1 || 0) + (analytics?.totalFoursInning2 || 0),
        sixes: (analytics?.totalSixesInning1 || 0) + (analytics?.totalSixesInning2 || 0),
        totalBoundaries: (analytics?.totalBoundariesInning1 || 0) + (analytics?.totalBoundariesInning2 || 0),
        boundaryRuns: (analytics?.boundaryRunsInning1 || 0) + (analytics?.boundaryRunsInning2 || 0)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getMatchReviews(req, res) {
  try {
    const { id } = req.params;
    const reviews = await Review.find({ matchId: id }).sort({ timestamp: -1 });
    
    const match = await Match.findById(id);
    const drsReviews = match?.drsReviews || [];
    
    const battingTeamReviews = drsReviews.filter(r => 
      match.teams[0] && String(r.team) === String(match.teams[0]._id)
    ).length;
    const bowlingTeamReviews = drsReviews.filter(r => 
      match.teams[1] && String(r.team) === String(match.teams[1]._id)
    ).length;
    
    res.json({
      reviews: reviews.length > 0 ? reviews : drsReviews,
      reviewsRemaining: {
        batting: Math.max(0, 2 - battingTeamReviews),
        bowling: Math.max(0, 2 - bowlingTeamReviews)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getMatchCommentary(req, res) {
  try {
    const { id } = req.params;
    const { inning, page = 1, limit = 50 } = req.query;
    
    const query = { matchId: id };
    if (inning) query.inning = parseInt(inning);
    
    const deliveries = await Delivery.find(query)
      .sort({ overNumber: -1, ballNumber: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    
    const total = await Delivery.countDocuments(query);
    
    res.json({
      commentary: deliveries,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function assignMatchOfficial(req, res) {
  try {
    const { matchId } = req.params;
    const { userId, role } = req.body;
    
    const existing = await MatchOfficial.findOne({ matchId, role });
    if (existing) {
      existing.userId = userId;
      await existing.save();
      return res.json(existing);
    }
    
    const official = new MatchOfficial({ matchId, userId, role });
    await official.save();
    
    const match = await Match.findById(matchId);
    if (match) {
      // P2: a scorer appointment is what gates the scoring screen, so it is
      // written to `Match.assignedScorers` (the same field the /scorers endpoint
      // owns). It must NOT be mirrored into `match.umpires`: the old code pushed
      // the raw userId string as an umpire name, so appointing a scorer left a
      // ghost "umpire" behind.
      if (role === "scorer") {
        match.assignedScorers = [userId];
        await match.save({ validateModifiedOnly: true });
      } else if (role === "umpire_on_field_1" || role === "umpire_on_field_2" || role === "third_umpire") {
        // Only real umpire appointments mirror into match.umpires, and the
        // stored value is a human name (or the email), never a bare id.
        const user = await User.findById(userId).select("name email");
        const displayName = user?.name || user?.email || "";
        const umpireRole = role === "third_umpire" ? "third" : "field";
        if (!match.umpires) match.umpires = [];
        const existingUmp = match.umpires.find(u => u.role === umpireRole);
        if (existingUmp) {
          existingUmp.name = displayName;
        } else {
          match.umpires.push({ name: displayName, role: umpireRole });
        }
        await match.save({ validateModifiedOnly: true });
      }
    }

    res.json(official);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getMatchGraphData(req, res) {
  try {
    const { id } = req.params;
    const match = await Match.findById(id)
      .populate("innings.oversHistory.bowler", "name")
      .populate("innings.batting.player", "name")
      .populate("innings.bowling.player", "name");

    if (!match) return res.status(404).json({ error: "Match not found" });

    const graphData = { manhattan: [], worm: [], runRate: [], innings: [] };

    (match.innings || []).forEach((inn, idx) => {
      const manhattan = [];
      const worm = [];
      const runRate = [];
      let cumRuns = 0;

      (inn.oversHistory || []).forEach((over) => {
        const overNum = over.overNumber + 1;
        const runs = over.runsScored || 0;
        const wkts = over.wickets || 0;
        cumRuns += runs;

        manhattan.push({ over: overNum, runs, wickets: wkts });
        worm.push({ over: overNum, cumulativeRuns: cumRuns });

        if (idx === 1 && inn.target) {
          const rrr = inn.target - cumRuns > 0
            ? ((inn.target - cumRuns) / Math.max((match.totalOvers || 20) - overNum, 0.1))
            : 0;
          runRate.push({ over: overNum, crr: overNum > 0 ? (cumRuns / overNum) : 0, rrr });
        } else {
          runRate.push({ over: overNum, crr: overNum > 0 ? (cumRuns / overNum) : 0, rrr: 0 });
        }
      });

      graphData.innings.push({
        inningNumber: idx + 1,
        totalRuns: inn.runs || 0,
        totalWickets: inn.wickets || 0,
        overs: inn.overs || 0,
        manhattan,
        worm,
        runRate,
        batting: (inn.batting || []).map(b => ({
          player: b.player?.name || 'Unknown',
          runs: b.runs || 0,
          balls: b.balls || 0,
          fours: b.fours || 0,
          sixes: b.sixes || 0,
          strikeRate: b.strikeRate || 0,
          dotBalls: b.dotBalls || 0,
          isOut: b.isOut || false,
          dismissalType: b.dismissalType || null,
          dismissedBy: b.dismissedBy?.name || null,
          fielder: b.fielder?.name || null,
        })),
        bowling: (inn.bowling || []).map(b => ({
          player: b.player?.name || 'Unknown',
          overs: b.overs || 0,
          maidens: b.maidens || 0,
          runs: b.runs || 0,
          wickets: b.wickets || 0,
          economy: b.economy || 0,
          dotBalls: b.dotBalls || 0,
          wides: b.wides || 0,
          noBalls: b.noBalls || 0,
        })),
        fallOfWickets: (inn.fallOfWickets || []).map(f => ({
          wicket: f.wicket,
          runs: f.runs,
          player: f.player?.name || (typeof f.player === 'object' ? f.player?.name : 'Unknown'),
          overs: f.overs || 0,
        })),
        partnerships: (inn.partnerships || []).map(p => ({
          runs: p.runs || 0,
          balls: p.balls || 0,
          batsman1: p.batsman1?.name || (typeof p.batsman1 === 'object' ? p.batsman1?.name : 'Unknown'),
          batsman2: p.batsman2?.name || (typeof p.batsman2 === 'object' ? p.batsman2?.name : 'Unknown'),
          wicket: p.wicket || null,
        })),
      });
    });

    // Win probability history from match
    graphData.winProbability = (match.winProbabilityHistory || []).map(w => ({
      over: w.over,
      ball: w.ball,
      team1: w.team1,
      team2: w.team2,
    }));

    res.json(graphData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getMatchOfficials(req, res) {
  try {
    const { id } = req.params;
    const officials = await MatchOfficial.find({ matchId: id }).populate('userId', 'name email');
    res.json(officials);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateMatchOfficial(req, res) {
  try {
    const { matchId, userId } = req.params;
    const { role } = req.body;
    
    const official = await MatchOfficial.findOneAndUpdate(
      { matchId, userId },
      { role },
      { new: true }
    );
    
    res.json(official);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function triggerUmpireSignal(req, res) {
  try {
    const { matchId } = req.params;
    const { signal } = req.body;
    
    emitUmpireSignal(matchId, signal);
    res.json({ success: true, signal });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateMatchStatusOfficial(req, res) {
  try {
    const { matchId } = req.params;
    const { status, message } = req.body;
    
    const match = await Match.findById(matchId);
    if (!match) return res.status(404).json({ error: "Match not found" });
    
    match.status = status;
    await match.save();
    
    emitMatchStatusChange(matchId, { status, message });
    
    res.json({ success: true, match });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
