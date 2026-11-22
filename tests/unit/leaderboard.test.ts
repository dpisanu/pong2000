import { describe, expect, it } from 'vitest';
import { DEMO_PLAYER_ID, DEMO_PLAYER_NICKNAME } from '../../shared/src/constants.ts';
import {
  LeaderboardService,
  computeTrimmedAveragePing,
} from '../../server/src/leaderboard/leaderboardService.ts';
import type { PlayerSession } from '../../server/src/sessions/sessionManager.ts';

function makeHumanSession(playerId: string, nickname: string): PlayerSession {
  return {
    playerId,
    recoveryToken: 'rec-123',
    uploadToken: 'up-123',
    nickname,
    avatarId: 'gallery:ace-paddle',
    avatarUrl: '/avatars/ace-paddle.svg',
    status: 'AVAILABLE',
    priorStatus: 'AVAILABLE',
    activeChallengeId: null,
    activeMatchId: null,
    connected: true,
    socketId: 'sk-1',
    disconnectExpiryTimer: null,
    createdAt: Date.now(),
    pingMs: null,
  };
}

describe('LeaderboardService', () => {
  it('computes trimmed average ping by dropping the overall lowest and highest datapoints when > 2 samples exist', () => {
    expect(computeTrimmedAveragePing([])).toBeNull();
    // Single match (2 datapoints): cannot drop both without leaving 0, so averages both
    expect(computeTrimmedAveragePing([18, 32])).toBe(25);
    // Multiple matches: drops single overall lowest (10) and highest (240), averaging [18, 20, 30, 42] = 27.5 -> 28
    expect(computeTrimmedAveragePing([18, 42, 10, 240, 20, 30])).toBe(28);
  });

  it('seeds Demo Player and computes trimmed overall match ping average across matches', () => {
    const lb = new LeaderboardService(true);
    const alice = makeHumanSession('pl_alice', 'Alice');
    const bob = makeHumanSession('pl_bob', 'Bob');
    lb.upsertPlayer(alice);
    lb.upsertPlayer(bob);

    // Before any completed match, overall leaderboard pingMs is null
    expect(lb.getEntries().find((e) => e.playerId === 'pl_alice')?.pingMs).toBeNull();

    // Match 1: Alice beats Bob in 45s (Alice: 18-30ms, Bob: 40-70ms)
    lb.recordMatchResult({
      winnerId: 'pl_alice',
      loserId: 'pl_bob',
      durationMs: 45_000,
      reason: 'SCORE_LIMIT',
      winnerPingRange: { minMs: 18, maxMs: 30 },
      loserPingRange: { minMs: 40, maxMs: 70 },
    });

    // Match 2: Demo Player wins when Bob forfeits in 12s (Bob: 10-240ms)
    // Bob datapoints = [40, 70, 10, 240] -> drop 10 & 240 -> avg(40, 70) = 55
    lb.recordMatchResult({
      winnerId: DEMO_PLAYER_ID,
      loserId: 'pl_bob',
      durationMs: 12_000,
      reason: 'FORFEIT_LEAVE',
      loserPingRange: { minMs: 10, maxMs: 240 },
    });

    // Match 3: Alice wins a longer 90s match vs Demo Player (Alice: 10-180ms)
    // Alice datapoints = [18, 30, 10, 180] -> drop 10 & 180 -> avg(18, 30) = 24
    lb.recordMatchResult({
      winnerId: 'pl_alice',
      loserId: DEMO_PLAYER_ID,
      durationMs: 90_000,
      reason: 'SCORE_LIMIT',
      winnerPingRange: { minMs: 10, maxMs: 180 },
    });

    const entries = lb.getEntries();
    expect(entries.map((e) => e.nickname)).toEqual(['Alice', DEMO_PLAYER_NICKNAME, 'Bob']);

    expect(entries[0]).toMatchObject({
      playerId: 'pl_alice',
      matchesPlayed: 2,
      wins: 2,
      losses: 0,
      forfeits: 0,
      longestMatchMs: 90_000,
      pingMs: 24,
      connected: true,
    });

    expect(entries[1]).toMatchObject({
      playerId: DEMO_PLAYER_ID,
      isBot: true,
      matchesPlayed: 2,
      wins: 1,
      losses: 1,
      forfeits: 0,
      longestMatchMs: 90_000,
      pingMs: 0,
    });

    expect(entries[2]).toMatchObject({
      playerId: 'pl_bob',
      matchesPlayed: 2,
      wins: 0,
      losses: 2,
      forfeits: 1,
      longestMatchMs: 45_000,
      pingMs: 55,
    });

    expect(lb.getSummary()).toEqual({
      totalPlayTimeMs: 147_000,
      totalPlayerCount: 2,
    });

    lb.markDisconnected('pl_bob');
    const afterDc = lb.getEntries().find((e) => e.playerId === 'pl_bob');
    expect(afterDc?.connected).toBe(false);
    // Overall match-based ping average remains intact after disconnect
    expect(afterDc?.pingMs).toBe(55);
    expect(lb.getSummary()).toEqual({
      totalPlayTimeMs: 147_000,
      totalPlayerCount: 2,
    });
  });
});
