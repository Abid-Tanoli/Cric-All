const FORMATS = {
  T20: { maxOvers: 20, maxWickets: 10, superOver: true },
  ODI: { maxOvers: 50, maxWickets: 10, superOver: true },
  TEST: { maxOvers: null, maxWickets: 10, superOver: false }
};

const MATCH_STATES = [
  'scheduled', 'toss', 'firstInnings', 'inningsBreak',
  'secondInnings', 'rainDelay', 'dlsActive', 'superOver',
  'completed', 'abandoned'
];

const DRS_CATEGORIES = ['lbw', 'caughtBehind', 'batPad', 'edgeDetection'];
const DRS_REVIEWS_PER_INNINGS = 2;

const POWERPLAY_RULES = {
  T20: [{ start: 0, end: 6, fieldersOutside: 2 }, { start: 6, end: 20, fieldersOutside: 5 }],
  ODI: [{ start: 0, end: 10, fieldersOutside: 2 }, { start: 10, end: 40, fieldersOutside: 4 }, { start: 40, end: 50, fieldersOutside: 5 }]
};

class ScoringEngine {
  constructor(match) {
    if (!match) throw new Error("Match data is required");
    this.match = match;
    this.format = FORMATS[match.matchType] || FORMATS.T20;
    this.events = [];
    this._initMatchState();
  }

  _initMatchState() {
    if (!this.match.matchState) this.match.matchState = 'scheduled';
    if (!this.match.drs) this.match.drs = {};
    if (!this.match.powerplay) this.match.powerplay = { active: false, phase: 0 };
    this.match.innings.forEach((inn, i) => {
      if (!inn.penaltyRuns) inn.penaltyRuns = 0;
      if (!inn.substitutes) inn.substitutes = { fielding: [], concussion: null, impactPlayer: null };
      if (!inn.drs) inn.drs = {
        team1: { total: DRS_REVIEWS_PER_INNINGS, used: 0, successful: 0, unsuccessful: 0, retained: 0 },
        team2: { total: DRS_REVIEWS_PER_INNINGS, used: 0, successful: 0, unsuccessful: 0, retained: 0 }
      };
    });
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // PROCESS DELIVERY
  // ══════════════════════════════════════════════════════════════════════════════

  processDelivery(delivery) {
    this.events = [];
    const { inningsIndex = this.match.currentInnings || 0 } = delivery;

    if (delivery.resetMatch) return this._resetMatch();
    if (delivery.revertBall) return this._revertLastBall(inningsIndex);
    if (delivery.penaltyRuns) return this._awardPenaltyRuns(inningsIndex, delivery.penaltyRuns, delivery.penaltyReason);

    const innings = this.match.innings[inningsIndex];
    if (!innings) throw new Error(`Innings ${inningsIndex} not found`);

    this.match.matchState = inningsIndex === 0 ? 'firstInnings' : 'secondInnings';

    const isFreeHit = innings.isFreeHit || false;
    const ballType = this._classifyBall(delivery);
    const isValidDismissal = this._isValidDismissal(delivery, ballType, isFreeHit);

    const over = this._getCurrentOver(innings, delivery.bowler);
    const ballNum = over.balls.length + 1;

    const ballRecord = this._buildBallRecord(delivery, ballType, isValidDismissal, isFreeHit, ballNum);

    this._applyRuns(innings, ballRecord, ballType, delivery);
    this._applyExtras(innings, ballRecord, ballType);
    innings.runs = (innings.runs || 0) + (ballRecord.batsmanRuns || 0) + (ballRecord.extraRuns || 0) + (ballRecord.penaltyRuns || 0);
    this._applyWicket(innings, ballRecord, ballType, isValidDismissal);
    this._updateBattingStats(innings, ballRecord);
    this._updateBowlingStats(innings, ballRecord, ballType);
    this._updateFieldingStats(innings, ballRecord);

    if (!ballRecord.isWide && !ballRecord.isNoBall) {
      innings.balls += 1;
    }

    over.balls.push(ballRecord);
    this._updateOverStats(over);

    const legalBallsInOver = over.balls.filter(b => !b.isWide && !b.isNoBall).length;
    const overComplete = !ballRecord.isWide && !ballRecord.isNoBall && legalBallsInOver >= 6;
    if (overComplete) this._completeOver(innings, over);

    innings.isFreeHit = ballRecord.isNoBall;
    if (ballType === 'noBall') innings.freeHitActive = true;

    this._updateStrikeRotation(innings, ballRecord);
    this._updatePartnership(innings, ballRecord);
    this._updatePowerplay(innings);
    this._updateRunRate(innings);
    this._checkTarget(innings, inningsIndex);

    const inningsComplete = this._checkInningsComplete(innings, inningsIndex);
    if (inningsComplete) this._endInnings(innings, inningsIndex);

    const eventType = this._getBallEventType(ballRecord, ballType);
    this.events.push({ type: 'ballEvent', event: eventType, ball: ballRecord });

    return {
      ball: ballRecord,
      innings,
      match: this.match,
      overComplete,
      inningsComplete,
      events: this.events,
      freeHitNext: innings.isFreeHit,
      powerplay: this.match.powerplay,
      ballEvent: eventType
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // BALL CLASSIFICATION
  // ══════════════════════════════════════════════════════════════════════════════

  _classifyBall(d) {
    if (d.isWide) return 'wide';
    if (d.isNoBall) return 'noBall';
    if (d.isBye) return 'bye';
    if (d.isLegBye) return 'legBye';
    return 'legal';
  }

  _getBallEventType(br, ballType) {
    if (br.isWicket) return br.wicketType === 'runOut' ? 'runOut' : br.wicketType === 'stumped' ? 'stumping' : 'wicket';
    if (ballType === 'wide') return 'wide';
    if (ballType === 'noBall') return 'noBall';
    if (ballType === 'bye') return 'bye';
    if (ballType === 'legBye') return 'legBye';
    if (br.isSix) return 'six';
    if (br.isFour) return 'four';
    if (br.batsmanRuns === 1) return 'single';
    if (br.batsmanRuns === 2) return 'double';
    if (br.batsmanRuns === 3) return 'triple';
    if (br.batsmanRuns === 0) return 'dot';
    return 'runs';
  }

  _isValidDismissal(d, ballType, isFreeHit) {
    if (!d.isWicket) return false;
    const wt = d.wicketType;

    if (ballType === 'noBall') {
      if (['runOut', 'obstructingField', 'hitTwice'].includes(wt)) return true;
      this.events.push({ type: 'invalidDismissal', reason: 'No Ball - only run out/obstructing/hit twice allowed' });
      return false;
    }
    if (ballType === 'wide') {
      if (['runOut', 'stumped'].includes(wt)) return true;
      this.events.push({ type: 'invalidDismissal', reason: 'Wide - only run out/stumped allowed' });
      return false;
    }
    if (isFreeHit && ballType === 'legal') {
      if (['runOut', 'obstructingField', 'hitTwice'].includes(wt)) return true;
      this.events.push({ type: 'invalidDismissal', reason: 'Free Hit - only run out/obstructing/hit twice allowed' });
      return false;
    }
    const validTypes = ['bowled', 'caught', 'lbw', 'runOut', 'stumped', 'hitWicket', 'retiredOut', 'obstructingField', 'hitTwice'];
    return validTypes.includes(wt);
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // CURRENT OVER
  // ══════════════════════════════════════════════════════════════════════════════

  _getCurrentOver(innings, bowlerId) {
    let over = innings.oversHistory?.[innings.oversHistory.length - 1];
    if (!over || over.balls.filter(b => !b.isWide && !b.isNoBall).length >= 6) {
      over = {
        overNumber: innings.oversHistory?.length || 0,
        balls: [], runsScored: 0, wickets: 0,
        bowler: bowlerId || null, isComplete: false
      };
      if (!innings.oversHistory) innings.oversHistory = [];
      innings.oversHistory.push(over);
    }
    return over;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // BALL RECORD
  // ══════════════════════════════════════════════════════════════════════════════

  _buildBallRecord(d, ballType, isValidDismissal, isFreeHit, ballNum) {
    return {
      ballNumber: ballNum,
      batsmanOnStrike: d.batsmanOnStrike,
      batsmanNonStrike: d.batsmanNonStrike,
      bowler: d.bowler,
      runs: ballType === 'legal' ? (d.runs || 0) : (ballType === 'noBall' ? (d.runs || 0) : 0),
      batsmanRuns: 0, extraRuns: 0, penaltyRuns: 0,
      isWide: d.isWide || false, isNoBall: d.isNoBall || false,
      isBye: d.isBye || false, isLegBye: d.isLegBye || false,
      isWicket: d.isWicket && isValidDismissal, isFreeHit,
      wicketType: isValidDismissal ? d.wicketType : null,
      dismissedPlayer: isValidDismissal ? d.dismissedPlayer : null,
      fielder: d.fielder || null,
      isAssistedRunOut: d.isAssistedRunOut || false,
      isDirectHitRunOut: d.isDirectHitRunOut || false,
      commentary: d.commentary || '', vividCommentary: d.vividCommentary || '',
      isFour: false, isSix: false, isDot: false,
      timestamp: new Date()
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // RUNS
  // ══════════════════════════════════════════════════════════════════════════════

  _applyRuns(innings, br, ballType, d) {
    const runs = d.runs || 0;
    if (ballType === 'wide') {
      br.extraRuns = 1 + runs; br.runs = 0; br.batsmanRuns = 0;
      return;
    }
    if (ballType === 'noBall') {
      br.extraRuns = 1; br.runs = runs; br.batsmanRuns = runs;
      innings.extras.noBalls = (innings.extras.noBalls || 0) + 1;
      this.events.push({ type: 'noBall', extra: 1, batsmanRuns: runs });
      this._checkBoundary(br, runs);
      return;
    }
    if (ballType === 'bye') {
      br.extraRuns = runs; br.runs = 0; br.batsmanRuns = 0;
      innings.extras.byes = (innings.extras.byes || 0) + runs;
      this.events.push({ type: 'bye', runs });
      return;
    }
    if (ballType === 'legBye') {
      br.extraRuns = runs; br.runs = 0; br.batsmanRuns = 0;
      br.isLegBye = true;
      innings.extras.legByes = (innings.extras.legByes || 0) + runs;
      this.events.push({ type: 'legBye', runs });
      return;
    }
    br.runs = runs; br.batsmanRuns = runs;
    if (runs === 0) br.isDot = true;
    this._checkBoundary(br, runs);
  }

  _checkBoundary(br, runs) {
    if (runs === 4) br.isFour = true;
    if (runs === 6) br.isSix = true;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // EXTRAS
  // ══════════════════════════════════════════════════════════════════════════════

  _applyExtras(innings, br, ballType) {
    if (!innings.extras) innings.extras = {};
    innings.extras.wides = innings.extras.wides || 0;
    innings.extras.noBalls = innings.extras.noBalls || 0;
    innings.extras.byes = innings.extras.byes || 0;
    innings.extras.legByes = innings.extras.legByes || 0;
    innings.extras.penalty = innings.extras.penalty || 0;

    if (ballType === 'wide') innings.extras.wides += br.extraRuns || 0;

    innings.extras.total = (innings.extras.wides || 0) + (innings.extras.noBalls || 0)
      + (innings.extras.byes || 0) + (innings.extras.legByes || 0) + (innings.extras.penalty || 0);
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // WICKET
  // ══════════════════════════════════════════════════════════════════════════════

  _applyWicket(innings, br, ballType, isValid) {
    if (!br.isWicket) return;
    innings.wickets += 1;
    this.events.push({
      type: 'wicket', wicketType: br.wicketType, dismissedPlayer: br.dismissedPlayer,
      fielder: br.fielder, batsmanRuns: br.batsmanRuns
    });
    if (!innings.fallOfWickets) innings.fallOfWickets = [];
    innings.fallOfWickets.push({
      wicket: innings.wickets, runs: innings.runs, player: br.dismissedPlayer,
      wicketType: br.wicketType, fielder: br.fielder,
      overs: `${Math.floor(innings.balls / 6)}.${innings.balls % 6}`
    });
    if (!innings.partnerships) innings.partnerships = [];
    const cp = innings.partnerships[innings.partnerships.length - 1];
    if (cp) { cp.endedAt = innings.wickets; cp.endedBy = br.dismissedPlayer; }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // BATTING STATS
  // ══════════════════════════════════════════════════════════════════════════════

  _updateBattingStats(innings, br) {
    if (!br.batsmanOnStrike && !br.batsmanNonStrike) return;
    if (!innings.batting) innings.batting = [];
    const sid = String(br.batsmanOnStrike?._id || br.batsmanOnStrike);
    const nid = String(br.batsmanNonStrike?._id || br.batsmanNonStrike);

    if (sid) {
      let bat = innings.batting.find(b => String(b.player?._id || b.player) === sid);
      if (!bat) {
        bat = { player: br.batsmanOnStrike, runs: 0, ballsFaced: 0, fours: 0, sixes: 0, dotBalls: 0, isOut: false, dismissalType: null, dismissedBy: null, fielder: null };
        innings.batting.push(bat);
      } else {
        if (bat.ballsFaced == null || isNaN(bat.ballsFaced)) bat.ballsFaced = bat.balls || 0;
        if (bat.dotBalls == null || isNaN(bat.dotBalls)) bat.dotBalls = 0;
      }
      if (br.isWicket) { bat.isOut = true; bat.dismissalType = br.wicketType; bat.dismissedBy = br.bowler; bat.fielder = br.fielder; }
      bat.runs += br.batsmanRuns;
      if (!br.isWide && !br.isNoBall) { bat.ballsFaced += 1; if (br.batsmanRuns === 0 && !br.isWicket) bat.dotBalls += 1; }
      if (br.isFour) bat.fours += 1;
      if (br.isSix) bat.sixes += 1;
    }
    if (nid && br.batsmanRuns % 2 === 1) {
      let bat = innings.batting.find(b => String(b.player?._id || b.player) === nid);
      if (!bat) {
        bat = { player: br.batsmanNonStrike, runs: 0, ballsFaced: 0, fours: 0, sixes: 0, dotBalls: 0, isOut: false, dismissalType: null, dismissedBy: null, fielder: null };
        innings.batting.push(bat);
      } else {
        if (bat.ballsFaced == null || isNaN(bat.ballsFaced)) bat.ballsFaced = bat.balls || 0;
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // BOWLING STATS
  // ══════════════════════════════════════════════════════════════════════════════

  _updateBowlingStats(innings, br, ballType) {
    const bowlerId = String(br.bowler?._id || br.bowler);
    if (!bowlerId) return;
    if (!innings.bowling) innings.bowling = [];
    let bowl = innings.bowling.find(b => String(b.player?._id || b.player) === bowlerId);
    if (!bowl) {
      bowl = { player: br.bowler, overs: 0, maidens: 0, runs: 0, wickets: 0, wides: 0, noBalls: 0, balls: 0, dots: 0, economy: 0 };
      innings.bowling.push(bowl);
    }
    if (!br.isWide && !br.isNoBall) { bowl.balls += 1; if (br.batsmanRuns === 0 && !br.isWicket && ballType === 'legal') bowl.dots += 1; }
    if (ballType === 'wide') bowl.wides += 1;
    if (ballType === 'noBall') bowl.noBalls += 1;
    if (ballType === 'wide' || ballType === 'noBall') bowl.runs += br.extraRuns + br.batsmanRuns;
    else if (ballType === 'legal') bowl.runs += br.batsmanRuns;
    if (br.isWicket) bowl.wickets += 1;
    const tb = bowl.balls;
    bowl.overs = Math.floor(tb / 6);
    bowl.economy = tb > 0 ? ((bowl.runs / tb) * 6).toFixed(2) : '0.00';
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // FIELDING STATS (Enhanced)
  // ══════════════════════════════════════════════════════════════════════════════

  _updateFieldingStats(innings, br) {
    if (!br.fielder || !br.isWicket) return;
    if (!innings.fielding) innings.fielding = [];
    const fid = String(br.fielder?._id || br.fielder);
    let fld = innings.fielding.find(f => String(f.player?._id || f.player) === fid);
    if (!fld) {
      fld = { player: br.fielder, catches: 0, stumpings: 0, runOuts: 0, directHitRunOuts: 0, assistedRunOuts: 0 };
      innings.fielding.push(fld);
    }
    if (br.wicketType === 'caught') fld.catches += 1;
    if (br.wicketType === 'stumped') fld.stumpings += 1;
    if (br.wicketType === 'runOut') {
      fld.runOuts += 1;
      if (br.isDirectHitRunOut) fld.directHitRunOuts += 1;
      if (br.isAssistedRunOut) fld.assistedRunOuts += 1;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // OVER MANAGEMENT
  // ══════════════════════════════════════════════════════════════════════════════

  _updateOverStats(over) {
    over.runsScored = over.balls.reduce((s, b) => s + (b.runs || 0) + (b.extraRuns || 0) + (b.penaltyRuns || 0), 0);
    over.wickets = over.balls.filter(b => b.isWicket).length;
  }

  _completeOver(innings, over) {
    over.isComplete = true;
    this.events.push({ type: 'overComplete', overNumber: over.overNumber, runs: over.runsScored, wickets: over.wickets });
    const isMaiden = over.balls.every(b => b.batsmanRuns === 0 && !b.isWicket && !b.isWide && !b.isNoBall && !b.isBye && !b.isLegBye);
    if (isMaiden) { over.isMaiden = true; this.events.push({ type: 'maiden', overNumber: over.overNumber }); }
    const bowler = innings.bowling?.find(b => String(b.player?._id || b.player) === String(over.bowler?._id || over.bowler));
    if (bowler && isMaiden) bowler.maidens = (bowler.maidens || 0) + 1;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // STRIKE ROTATION
  // ══════════════════════════════════════════════════════════════════════════════

  _updateStrikeRotation(innings, br) {
    if (!br.isWide && !br.isNoBall) {
      const runs = br.batsmanRuns || 0;
      if (runs % 2 === 1) {
        [br.batsmanOnStrike, br.batsmanNonStrike] = [br.batsmanNonStrike, br.batsmanOnStrike];
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // PARTNERSHIP
  // ══════════════════════════════════════════════════════════════════════════════

  _updatePartnership(innings, br) {
    if (!innings.partnerships) innings.partnerships = [];
    let p = innings.partnerships[innings.partnerships.length - 1];
    if (!p || p.endedAt) {
      p = { runs: 0, balls: 0, batsman1: br.batsmanOnStrike, batsman2: br.batsmanNonStrike, startedAt: innings.wickets + 1, endedAt: null, endedBy: null };
      innings.partnerships.push(p);
    }
    p.runs += (br.runs || 0) + (br.extraRuns || 0) + (br.penaltyRuns || 0);
    if (!br.isWide && !br.isNoBall) p.balls += 1;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // POWERPLAY
  // ══════════════════════════════════════════════════════════════════════════════

  _updatePowerplay(innings) {
    const rules = POWERPLAY_RULES[this.match.matchType];
    if (!rules) return;
    const completedOvers = Math.floor(innings.balls / 6);
    let phase = 0;
    for (let i = 0; i < rules.length; i++) {
      if (completedOvers >= rules[i].start && completedOvers < rules[i].end) { phase = i; break; }
      if (i === rules.length - 1 && completedOvers >= rules[i].start) phase = i;
    }
    this.match.powerplay = { active: completedOvers < (this.format.maxOvers || 50), phase, fieldersOutside: rules[phase]?.fieldersOutside || 5 };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // RUN RATE
  // ══════════════════════════════════════════════════════════════════════════════

  _updateRunRate(innings) {
    const ov = innings.balls / 6;
    innings.runRate = ov > 0 ? (innings.runs / ov).toFixed(2) : '0.00';
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // TARGET
  // ══════════════════════════════════════════════════════════════════════════════

  _checkTarget(innings, inningsIndex) {
    if (inningsIndex === 1 && innings.target && innings.runs >= innings.target) {
      innings.status = 'completed';
      this.match.matchState = 'completed';
      this.match.status = 'completed';
      const w = 10 - innings.wickets;
      this.match.result = { winner: innings.team, margin: `${w} wickets`, description: `${innings.team?.name || 'Team'} won by ${w} wickets` };
      this.events.push({ type: 'matchComplete', result: this.match.result });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // INNINGS COMPLETE
  // ══════════════════════════════════════════════════════════════════════════════

  _checkInningsComplete(innings, inningsIndex) {
    if (innings.status === 'completed') return true;
    if (innings.wickets >= this.format.maxWickets) return true;
    const mo = this.format.maxOvers;
    if (mo !== null) { const co = Math.floor(innings.balls / 6); if (co >= mo && innings.balls % 6 === 0) return true; }
    if (inningsIndex === 1 && innings.target && innings.runs >= innings.target) return true;
    if (innings.isDeclared) return true;
    return false;
  }

  _endInnings(innings, inningsIndex) {
    innings.status = 'completed';
    this.match.matchState = inningsIndex === 0 ? 'inningsBreak' : 'completed';
    this.events.push({ type: 'inningsComplete', innings: inningsIndex, runs: innings.runs, wickets: innings.wickets });
    if (inningsIndex === 0) innings.target = innings.runs + 1;
    if (inningsIndex === 1 || (inningsIndex === 0 && this.match.innings.length <= 1)) this._calculateResult();
    if (inningsIndex < this.match.innings.length - 1) this.match.currentInnings = inningsIndex + 1;
  }

  _calculateResult() {
    const i1 = this.match.innings[0], i2 = this.match.innings[1];
    if (!i1) return;
    if (!i2) {
      this.match.status = 'completed'; this.match.matchState = 'completed';
      this.match.result = { winner: i1.team, margin: 'innings victory', description: `${i1.team?.name || 'Team 1'} won by innings` };
      return;
    }
    this.match.status = 'completed'; this.match.matchState = 'completed';
    if (i2.runs > i1.runs) {
      const wl = this.format.maxWickets - i2.wickets;
      this.match.result = { winner: i2.team, margin: `${wl} wickets`, description: `${i2.team?.name || 'Team 2'} won by ${wl} wickets${i2.balls ? ` (${i2.balls} balls remaining)` : ''}` };
    } else if (i1.runs > i2.runs) {
      const rm = i1.runs - i2.runs;
      this.match.result = { winner: i1.team, margin: `${rm} runs`, description: `${i1.team?.name || 'Team 1'} won by ${rm} runs` };
    } else {
      this.match.result = { winner: null, margin: 'tie', description: 'Match tied', isTie: true, superOverAvailable: this.format.superOver };
    }
    this.events.push({ type: 'result', result: this.match.result });
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // REVERT BALL
  // ══════════════════════════════════════════════════════════════════════════════

  _revertLastBall(inningsIndex) {
    const innings = this.match.innings[inningsIndex];
    if (!innings || !innings.oversHistory?.length) return null;
    const lastOver = innings.oversHistory[innings.oversHistory.length - 1];
    const lastBall = lastOver.balls.pop();
    if (!lastBall) return null;

    innings.runs -= (lastBall.runs || 0) + (lastBall.extraRuns || 0) + (lastBall.penaltyRuns || 0);
    if (lastBall.isWicket) innings.wickets -= 1;
    if (!lastBall.isWide && !lastBall.isNoBall) innings.balls -= 1;

    if (lastBall.isWide) innings.extras.wides = Math.max(0, (innings.extras.wides || 0) - (lastBall.extraRuns || 0));
    if (lastBall.isNoBall) innings.extras.noBalls = Math.max(0, (innings.extras.noBalls || 0) - 1);
    if (lastBall.isBye) innings.extras.byes = Math.max(0, (innings.extras.byes || 0) - (lastBall.extraRuns || 0));
    if (lastBall.isLegBye) innings.extras.legByes = Math.max(0, (innings.extras.legByes || 0) - (lastBall.extraRuns || 0));
    innings.extras.total = Math.max(0, (innings.extras.wides || 0) + (innings.extras.noBalls || 0) + (innings.extras.byes || 0) + (innings.extras.legByes || 0) + (innings.extras.penalty || 0));

    const bid = String(lastBall.bowler?._id || lastBall.bowler);
    const bowl = innings.bowling?.find(b => String(b.player?._id || b.player) === bid);
    if (bowl) {
      if (!lastBall.isWide && !lastBall.isNoBall) bowl.balls = Math.max(0, bowl.balls - 1);
      if (lastBall.isWide) bowl.wides = Math.max(0, bowl.wides - 1);
      if (lastBall.isNoBall) bowl.noBalls = Math.max(0, bowl.noBalls - 1);
      if (lastBall.isWicket) bowl.wickets = Math.max(0, bowl.wickets - 1);
      bowl.runs = Math.max(0, bowl.runs - (lastBall.batsmanRuns || 0) - (lastBall.extraRuns ? (lastBall.isWide || lastBall.isNoBall ? lastBall.extraRuns : 0) : 0));
      bowl.economy = bowl.balls > 0 ? ((bowl.runs / bowl.balls) * 6).toFixed(2) : '0.00';
    }

    const sid = String(lastBall.batsmanOnStrike?._id || lastBall.batsmanOnStrike);
    const bat = innings.batting?.find(b => String(b.player?._id || b.player) === sid);
    if (bat) {
      bat.runs = Math.max(0, bat.runs - (lastBall.batsmanRuns || 0));
      if (!lastBall.isWide && !lastBall.isNoBall) bat.ballsFaced = Math.max(0, bat.ballsFaced - 1);
      if (lastBall.isFour) bat.fours = Math.max(0, bat.fours - 1);
      if (lastBall.isSix) bat.sixes = Math.max(0, bat.sixes - 1);
      if (lastBall.isWicket) { bat.isOut = false; bat.dismissalType = null; }
    }

    if (lastOver.balls.length === 0) innings.oversHistory.pop();
    this._updateOverStats(lastOver);
    innings.isFreeHit = false;
    if (lastBall.isWicket && innings.fallOfWickets?.length) innings.fallOfWickets.pop();
    this.events.push({ type: 'ballReverted' });
    return { ball: lastBall, innings, match: this.match };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // PENALTY RUNS
  // ══════════════════════════════════════════════════════════════════════════════

  _awardPenaltyRuns(inningsIndex, runs, reason) {
    const innings = this.match.innings[inningsIndex];
    if (!innings) throw new Error('Innings not found');
    const validReasons = ['illegalFielding', 'ballTampering', 'deliberateObstruction', 'unfairPlay'];
    if (!validReasons.includes(reason)) throw new Error(`Invalid penalty reason: ${reason}`);

    if (!innings.extras) innings.extras = {};
    innings.extras.penalty = (innings.extras.penalty || 0) + runs;
    innings.extras.total = (innings.extras.total || 0) + runs;
    innings.runs = (innings.runs || 0) + runs;
    innings.penaltyRuns = (innings.penaltyRuns || 0) + runs;

    this.events.push({ type: 'penaltyRuns', runs, reason });

    return { innings, runs, reason };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // RESET MATCH
  // ══════════════════════════════════════════════════════════════════════════════

  _resetMatch() {
    this.match.innings.forEach(inn => {
      inn.runs = 0; inn.wickets = 0; inn.balls = 0;
      inn.extras = { wides: 0, noBalls: 0, byes: 0, legByes: 0, penalty: 0, total: 0 };
      inn.batting = []; inn.bowling = []; inn.fielding = [];
      inn.oversHistory = []; inn.partnerships = []; inn.fallOfWickets = [];
      inn.target = null; inn.runRate = '0.00'; inn.isFreeHit = false;
      inn.penaltyRuns = 0; inn.status = 'upcoming';
    });
    this.match.currentInnings = 0;
    this.match.status = 'live';
    this.match.matchState = 'firstInnings';
    this.match.result = null;
    this.events.push({ type: 'matchReset' });
    return { match: this.match };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // DRS (Decision Review System)
  // ══════════════════════════════════════════════════════════════════════════════

  requestDRS(inningsIndex, teamId, category) {
    const innings = this.match.innings[inningsIndex];
    if (!innings) throw new Error('Innings not found');
    if (!DRS_CATEGORIES.includes(category)) throw new Error(`Invalid DRS category: ${category}`);

    const drs = innings.drs;
    const teamKey = String(teamId) === String(this.match.teams?.[0]?._id || this.match.teams?.[0]) ? 'team1' : 'team2';
    const teamDrs = drs[teamKey];

    if (teamDrs.used >= teamDrs.total) {
      return { success: false, reason: 'No reviews remaining', reviewsLeft: 0 };
    }

    teamDrs.used += 1;
    const decision = this._simulateDRS(category);
    teamDrs.lastCategory = category;
    teamDrs.lastDecision = decision;

    if (decision === 'successful') {
      teamDrs.successful += 1;
      teamDrs.retained += 1;
    } else if (decision === 'unsuccessful') {
      teamDrs.unsuccessful += 1;
    }

    this.events.push({
      type: 'drsReview', team: teamId, category, decision,
      reviewsRemaining: teamDrs.total - teamDrs.used + (decision === 'successful' ? 1 : 0),
      reviewRetained: decision === 'successful' || decision === 'umpiresCall'
    });

    return { success: true, decision, category, reviewsLeft: teamDrs.total - teamDrs.used, reviewRetained: decision === 'successful' || decision === 'umpiresCall' };
  }

  _simulateDRS(category) {
    const r = Math.random();
    if (r < 0.3) return 'successful';
    if (r < 0.6) return 'umpiresCall';
    return 'unsuccessful';
  }

  getDRSStatus(inningsIndex) {
    return this.match.innings[inningsIndex]?.drs || null;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // DLS (Duckworth-Lewis-Stern)
  // ══════════════════════════════════════════════════════════════════════════════

  calculateDLSTarget(inningsIndex, oversRemaining, wicketsLost) {
    const innings = this.match.innings[inningsIndex];
    if (!innings) throw new Error('Innings not found');

    this.match.matchState = 'dlsActive';
    const resourcesUsed = this._dlsResourceTable(this.format.maxOvers || 50, this.format.maxWickets - wicketsLost);
    const totalResources = 100;
    const resourcesRemaining = this._dlsResourceTable(oversRemaining, this.format.maxWickets - wicketsLost);
    const resourceFactor = resourcesRemaining / resourcesUsed;

    let revisedTarget;
    if (inningsIndex === 0) {
      revisedTarget = Math.floor(innings.runs * resourceFactor);
      innings.target = revisedTarget;
    } else {
      const originalTarget = innings.target || 0;
      const runsScored = innings.runs || 0;
      const parScore = Math.floor(innings.runs * resourceFactor);
      revisedTarget = Math.floor(parScore + 1);

      if (resourceFactor < 1) {
        innings.target = revisedTarget;
        innings.dlsTarget = revisedTarget;
      }
    }

    this.events.push({
      type: 'dlsCalculation', oversRemaining, wicketsLost,
      resourcesUsed, resourcesRemaining, resourceFactor,
      originalTarget: innings.target || 0, revisedTarget: revisedTarget || 0
    });

    return { revisedTarget, oversRemaining, wicketsLost, resourcesUsed, resourcesRemaining, resourceFactor };
  }

  _dlsResourceTable(overs, wicketsRemaining) {
    const ref = [
      [100, 70, 50, 35, 25, 15, 10, 5, 3, 1],
      [95, 67, 48, 33, 24, 14, 9, 5, 3, 1],
      [90, 64, 46, 32, 23, 14, 9, 5, 3, 1],
      [85, 61, 44, 31, 22, 13, 9, 5, 3, 1],
      [80, 58, 42, 30, 21, 13, 8, 5, 3, 1],
      [75, 55, 40, 28, 20, 12, 8, 5, 3, 1],
      [70, 52, 38, 27, 19, 12, 8, 4, 3, 1],
      [65, 48, 35, 25, 18, 11, 7, 4, 3, 1],
      [60, 45, 33, 24, 17, 11, 7, 4, 3, 1],
      [55, 42, 31, 22, 16, 10, 7, 4, 3, 1],
      [50, 38, 28, 20, 15, 10, 7, 4, 2, 1],
      [45, 34, 25, 18, 13, 9, 6, 4, 2, 1],
      [40, 30, 22, 16, 12, 8, 6, 3, 2, 1],
      [35, 26, 19, 14, 10, 7, 5, 3, 2, 1],
      [30, 22, 16, 12, 9, 6, 4, 3, 2, 1],
      [25, 18, 13, 10, 7, 5, 4, 2, 2, 1],
      [20, 14, 10, 8, 6, 4, 3, 2, 1, 1],
      [15, 10, 8, 6, 4, 3, 2, 2, 1, 1],
      [10, 7, 5, 4, 3, 2, 2, 1, 1, 0],
      [5, 3, 3, 2, 2, 1, 1, 1, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    ];
    const row = Math.min(Math.max(Math.floor(overs), 0), 20);
    const col = Math.min(Math.max(wicketsRemaining - 1, 0), 9);
    return ref[row][col];
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // SUBSTITUTE & CONCUSSION & IMPACT PLAYER
  // ══════════════════════════════════════════════════════════════════════════════

  addSubstituteFielder(inningsIndex, substitute, replacedPlayer) {
    const innings = this.match.innings[inningsIndex];
    if (!innings) throw new Error('Innings not found');
    if (!innings.substitutes) innings.substitutes = { fielding: [], concussion: null, impactPlayer: null };

    innings.substitutes.fielding.push({
      player: substitute, replaces: replacedPlayer, type: 'fielding',
      canBat: false, canBowl: false, canCaptain: false,
      canCatch: true, canRunOut: true
    });

    this.events.push({ type: 'substituteAdded', player: substitute, replaces: replacedPlayer });
    return { substitute, replacedPlayer };
  }

  addConcussionSubstitute(inningsIndex, substitute, replacedPlayer) {
    const innings = this.match.innings[inningsIndex];
    if (!innings) throw new Error('Innings not found');
    if (!innings.substitutes) innings.substitutes = { fielding: [], concussion: null, impactPlayer: null };

    innings.substitutes.concussion = {
      player: substitute, replaces: replacedPlayer, type: 'concussion',
      canBat: true, canBowl: true, canCaptain: false
    };

    this.events.push({ type: 'concussionSubstitute', player: substitute, replaces: replacedPlayer });
    return { substitute, replacedPlayer };
  }

  addImpactPlayer(innings, substitutes, impactPlayerIndex) {
    if (!innings.substitutes) innings.substitutes = { fielding: [], concussion: null, impactPlayer: null };
    if (innings.substitutes.impactPlayer) throw new Error('Impact Player already used');

    if (!substitutes || substitutes.length !== 5) throw new Error('Exactly 5 substitute players must be nominated');

    const selected = substitutes[impactPlayerIndex];
    if (!selected) throw new Error('Invalid impact player selection');

    innings.substitutes.impactPlayer = {
      player: selected, type: 'impact',
      canBat: true, canBowl: true, canCaptain: false
    };
    innings.substitutes.nominatedSubstitutes = substitutes;

    this.events.push({ type: 'impactPlayerAdded', player: selected });
    return { impactPlayer: selected, substitutes };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // SUPER OVER
  // ══════════════════════════════════════════════════════════════════════════════

  startSuperOver() {
    const base = {
      team: null, runs: 0, wickets: 0, balls: 0,
      extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0, penalty: 0, total: 0 },
      batting: [], bowling: [], fielding: [],
      oversHistory: [], partnerships: [], fallOfWickets: [],
      isFreeHit: false, status: 'live', drs: null, substitutes: { fielding: [], concussion: null, impactPlayer: null }
    };
    this.match.innings.push(base, { ...base, status: 'upcoming' });
    this.match.currentInnings = this.match.innings.length - 2;
    this.match.totalOvers = 1;
    this.match.status = 'live';
    this.match.matchState = 'superOver';
    this.match.isSuperOver = true;
    this.events.push({ type: 'superOverStarted' });
    return { match: this.match };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // DECLARATION (TEST)
  // ══════════════════════════════════════════════════════════════════════════════

  declareInnings(inningsIndex) {
    const inn = this.match.innings[inningsIndex];
    if (!inn) throw new Error('Innings not found');
    if (this.format.maxOvers !== null) throw new Error('Declaration only allowed in Test matches');
    inn.isDeclared = true;
    inn.status = 'completed';
    this.events.push({ type: 'declaration', innings: inningsIndex, runs: inn.runs, wickets: inn.wickets });
    if (inningsIndex === 0 && this.match.innings[1]) { this.match.currentInnings = 1; this.match.innings[1].status = 'live'; }
    if (inningsIndex === 0 && !this.match.innings[1]) this.match.currentInnings = 1;
    if (inningsIndex >= 2) this._calculateResult();
    return { match: this.match, innings: inn };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // MATCH STATE MANAGEMENT
  // ══════════════════════════════════════════════════════════════════════════════

  setMatchState(state) {
    if (!MATCH_STATES.includes(state)) throw new Error(`Invalid match state: ${state}`);
    this.match.matchState = state;
    if (state === 'completed') this.match.status = 'completed';
    if (state === 'rainDelay') this.events.push({ type: 'rainDelay' });
    if (state === 'abandoned') {
      this.match.status = 'abandoned';
      this.match.result = { winner: null, margin: 'noResult', description: 'Match abandoned' };
      this.events.push({ type: 'matchAbandoned' });
    }
    this.events.push({ type: 'matchStateChange', state });
    return { matchState: state };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // SCOREBOARD GENERATION
  // ══════════════════════════════════════════════════════════════════════════════

  generateScoreboard() {
    return {
      matchState: this.match.matchState,
      innings: this.match.innings.map((inn, idx) => this._inningsScoreboard(inn, idx)),
      result: this.match.result || null,
      powerplay: this.match.powerplay || null,
      drs: this.match.innings.map(inn => inn.drs || null)
    };
  }

  _inningsScoreboard(inn, idx) {
    const teamName = inn.team?.name || `Team ${idx + 1}`;
    const tb = inn.balls || 0;
    const overs = `${Math.floor(tb / 6)}.${tb % 6}`;
    const ext = inn.extras?.total || 0;
    const totalRuns = inn.runs || 0;
    const crr = inn.runRate || '0.00';

    const batting = (inn.batting || []).map(b => ({
      player: b.player?.name || 'Unknown',
      runs: b.runs || 0, balls: b.ballsFaced || 0,
      fours: b.fours || 0, sixes: b.sixes || 0,
      dotBalls: b.dotBalls || 0,
      strikeRate: b.ballsFaced > 0 ? ((b.runs / b.ballsFaced) * 100).toFixed(2) : '0.00',
      dismissal: b.isOut ? this._formatDismissal(b) : (b.ballsFaced > 0 ? 'not out' : 'did not bat')
    }));

    const bowling = (inn.bowling || []).map(b => ({
      player: b.player?.name || 'Unknown',
      overs: `${Math.floor(b.balls / 6)}.${b.balls % 6}`,
      maidens: b.maidens || 0, runs: b.runs || 0,
      wickets: b.wickets || 0, economy: b.economy || '0.00',
      wides: b.wides || 0, noBalls: b.noBalls || 0, dots: b.dots || 0
    }));

    const fielding = (inn.fielding || []).map(f => ({
      player: f.player?.name || 'Unknown',
      catches: f.catches || 0, stumpings: f.stumpings || 0,
      runOuts: f.runOuts || 0, directHitRunOuts: f.directHitRunOuts || 0,
      assistedRunOuts: f.assistedRunOuts || 0
    }));

    const fow = (inn.fallOfWickets || []).map(f => ({
      wicket: f.wicket, runs: f.runs, player: f.player?.name || 'Unknown',
      overs: f.overs || '0.0'
    }));

    const partnerships = (inn.partnerships || []).map(p => ({
      runs: p.runs || 0, balls: p.balls || 0,
      wicket: p.endedAt || 'ongoing', batsmen: `${p.batsman1?.name || '?'} & ${p.batsman2?.name || '?'}`
    }));

    return {
      team: teamName,
      score: `${totalRuns}/${inn.wickets || 0}`,
      overs, runRate: crr,
      target: inn.target || null,
      dlsTarget: inn.dlsTarget || null,
      extras: { total: ext, breakdown: inn.extras || {} },
      penaltyRuns: inn.penaltyRuns || 0,
      batting, bowling, fielding,
      fallOfWickets: fow, partnerships,
      isDeclared: inn.isDeclared || false,
      status: inn.status || 'completed',
      drs: inn.drs ? { team1: inn.drs.team1, team2: inn.drs.team2 } : null,
      substitutes: inn.substitutes || null
    };
  }

  _formatDismissal(b) {
    const t = b.dismissalType;
    if (t === 'bowled') return `b ${b.dismissedBy?.name || ''}`;
    if (t === 'caught') return `c ${b.fielder?.name || ''} b ${b.dismissedBy?.name || ''}`;
    if (t === 'lbw') return `lbw b ${b.dismissedBy?.name || ''}`;
    if (t === 'stumped') return `st ${b.fielder?.name || ''} b ${b.dismissedBy?.name || ''}`;
    if (t === 'runOut') return `run out (${b.fielder?.name || ''})`;
    if (t === 'hitWicket') return `hit wicket b ${b.dismissedBy?.name || ''}`;
    if (t === 'retiredOut') return 'retired out';
    if (t === 'obstructingField') return 'obstructing the field';
    if (t === 'hitTwice') return 'hit the ball twice';
    return t || 'out';
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // TOURNAMENT STATS
  // ══════════════════════════════════════════════════════════════════════════════

  static calculateNRR(teamStats) {
    if (!teamStats) return '0.00';
    const runsScored = teamStats.runsScored || 0;
    const oversFaced = teamStats.oversFaced || 1;
    const runsConceded = teamStats.runsConceded || 0;
    const oversBowled = teamStats.oversBowled || 1;
    const nrr = (runsScored / oversFaced) - (runsConceded / oversBowled);
    return nrr.toFixed(3);
  }

  static calculatePoints(matches) {
    return matches.reduce((points, m) => {
      if (!m.result) return points;
      if (m.result.margin === 'tie' || m.status === 'abandoned') return points + 1;
      return points + (m.result.winner ? 2 : 0);
    }, 0);
  }

  static generatePointsTable(teams) {
    return teams.map(t => {
      const played = t.matches?.length || 0;
      const won = t.matches?.filter(m => m.result?.winner && String(m.result.winner) === String(t._id)).length || 0;
      const lost = t.matches?.filter(m => m.result?.winner && String(m.result.winner) !== String(t._id)).length || 0;
      const tied = t.matches?.filter(m => m.result?.margin === 'tie').length || 0;
      const nr = t.matches?.filter(m => m.status === 'abandoned').length || 0;
      const points = won * 2 + tied + nr;
      const nrr = this.calculateNRR(t.stats);

      return {
        team: t.name || 'Unknown', played, won, lost, tied, nr, points, nrr
      };
    }).sort((a, b) => b.points - a.points || parseFloat(b.nrr) - parseFloat(a.nrr));
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // STATIC HELPERS
  // ══════════════════════════════════════════════════════════════════════════════

  static isValidMatchType(type) { return !!FORMATS[type]; }
  static getFormat(type) { return FORMATS[type] || FORMATS.T20; }
  static getMatchStates() { return MATCH_STATES; }
  static getDRSCategories() { return DRS_CATEGORIES; }
}

export { ScoringEngine, FORMATS, MATCH_STATES, DRS_CATEGORIES, POWERPLAY_RULES };
