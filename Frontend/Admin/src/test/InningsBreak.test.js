import { describe, expect, it } from 'vitest';
import {
  getInningsBreakData,
  shouldShowInningsBreak,
} from '../utils/inningsBreak';

const finishedInnings = {
  team: 'teamA',
  status: 'completed',
  runs: 170,
  wickets: 7,
  balls: 120,
  extras: { wides: 6, noBalls: 2, byes: 1, legByes: 3 },
  batting: [
    { player: { _id: 'p1', name: 'A Batter' }, runs: 60, balls: 40, fours: 5, sixes: 2, isOut: true },
    { player: { _id: 'p2', name: 'B Batter' }, runs: 82, balls: 51, fours: 7, sixes: 4, isOut: true },
    { player: { _id: 'p3', name: 'C Batter' }, runs: 12, balls: 8, fours: 1, sixes: 0, isOut: false },
  ],
  bowling: [
    { player: { _id: 'b1', name: 'A Bowler' }, balls: 24, maidens: 1, runs: 22, wickets: 3 },
    { player: { _id: 'b2', name: 'B Bowler' }, balls: 24, maidens: 0, runs: 40, wickets: 1 },
    { player: { _id: 'b3', name: 'C Bowler' }, balls: 12, maidens: 0, runs: 18, wickets: 2 },
  ],
  fallOfWickets: [{ wicket: 1, runs: 24, player: { name: 'A Batter' }, overs: '2.3' }],
};

const matchBase = {
  _id: 'match1',
  status: 'innings_break',
  currentInnings: 1,
  totalOvers: 20,
  teams: [
    { _id: 'teamA', name: 'Team A' },
    { _id: 'teamB', name: 'Team B' },
  ],
  innings: [
    finishedInnings,
    { team: 'teamB', status: 'upcoming', runs: 0, wickets: 0, balls: 0, target: 171 },
  ],
};

describe('shouldShowInningsBreak', () => {
  it('shows after the first innings ends and before the chase has openers', () => {
    expect(shouldShowInningsBreak(matchBase)).toBe(true);
  });

  it('hides once the second innings has openers', () => {
    const match = {
      ...matchBase,
      innings: [
        finishedInnings,
        {
          ...matchBase.innings[1],
          onStrikeBatsman: 'p1',
          currentBatsman1: 'p1',
          currentBatsman2: 'p2',
        },
      ],
    };
    expect(shouldShowInningsBreak(match)).toBe(false);
  });

  it('hides when the chase is already live or the match is complete', () => {
    expect(shouldShowInningsBreak({
      ...matchBase,
      status: 'live',
      innings: [finishedInnings, { ...matchBase.innings[1], status: 'live' }],
    })).toBe(false);
    expect(shouldShowInningsBreak({
      ...matchBase,
      status: 'completed',
    })).toBe(false);
  });
});

describe('getInningsBreakData', () => {
  it('derives the full-innings target and required rate', () => {
    const data = getInningsBreakData(matchBase);
    expect(data).not.toBeNull();
    expect(data.finishedTeam.name).toBe('Team A');
    expect(data.chasingTeam.name).toBe('Team B');
    expect(data.score).toMatchObject({ runs: 170, wickets: 7, overs: '20.0' });
    expect(data.chase).toMatchObject({
      target: 171,
      runsNeeded: 171,
      ballsRemaining: 120,
      requiredRunRate: 8.55,
    });
    expect(data.extras.total).toBe(12);
  });

  it('sorts top batters and bowlers and keeps the overs summary', () => {
    const data = getInningsBreakData(matchBase);
    expect(data.topBatters.map((row) => row.name)).toEqual(['B Batter', 'A Batter', 'C Batter']);
    expect(data.topBowlers.map((row) => row.name)).toEqual(['A Bowler', 'C Bowler', 'B Bowler']);
    expect(data.oversSummary.find((row) => row.name === 'A Bowler')).toMatchObject({
      overs: '4.0',
      maidens: 1,
      runs: 22,
      wickets: 3,
    });
    expect(data.fallOfWickets[0]).toMatchObject({ wickets: 1, runs: 24, overs: '2.3' });
  });
});
