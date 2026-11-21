import { describe, expect, it } from 'vitest';
import { DEMO_PLAYER_ID, DEMO_PLAYER_NICKNAME } from '../../shared/src/constants.ts';
import { LeaderboardService } from '../../server/src/leaderboard/leaderboardService.ts';
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
  it('seeds Demo Player and ranks players by wins, win rate, forfeits, and longest match', () => {
    const lb = new LeaderboardService(true);
    const alice = makeHumanSession('pl_alice', 'Alice');
    const bob = makeHumanSession('pl_bob', 'Bob');
    lb.upsertPlayer(alice);
    lb.upsertPlayer(bob);

    lb.updatePing('pl_alice', 14.4);
    lb.updatePing('pl_bob', 62.7);

    // Match 1: Alice beats Bob in 45s
    lb.recordMatchResult({
      winnerId: 'pl_alice',
      loserId: 'pl_bob',
      durationMs: 45_000,
      reason: 'SCORE_LIMIT',
    });

    // Match 2: Demo Player wins when Bob forfeits in 12s
    lb.recordMatchResult({
      winnerId: DEMO_PLAYER_ID,
      loserId: 'pl_bob',
      durationMs: 12_000,
      reason: 'FORFEIT_LEAVE',
    });

    // Match 3: Alice wins a longer 90s match vs Demo Player
    lb.recordMatchResult({
      winnerId: 'pl_alice',
      loserId: DEMO_PLAYER_ID,
      durationMs: 90_000,
      reason: 'SCORE_LIMIT',
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
      pingMs: 14,
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
      pingMs: 63,
    });

    lb.markDisconnected('pl_bob');
    const afterDc = lb.getEntries().find((e) => e.playerId === 'pl_bob');
    expect(afterDc?.connected).toBe(false);
    expect(afterDc?.pingMs).toBeNull();
  });
});
