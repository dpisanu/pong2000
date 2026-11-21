import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchManager } from '../../server/src/matches/matchManager.ts';
import { SessionManager } from '../../server/src/sessions/sessionManager.ts';
import type { MatchSnapshot } from '../../shared/src/types.ts';

describe('MatchManager countdown paddle head start', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-21T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('unlocks paddle movement during the final 1 second of the 3-second countdown while keeping the ball centered', () => {
    const sessions = new SessionManager();
    const left = sessions.createSession({
      nickname: 'LeftPlayer',
      avatarId: 'gallery:ace-paddle',
      avatarUrl: '/avatars/ace-paddle.svg',
      socketId: 'sock-left',
    });
    const right = sessions.createSession({
      nickname: 'RightPlayer',
      avatarId: 'gallery:rally-fox',
      avatarUrl: '/avatars/rally-fox.svg',
      socketId: 'sock-right',
    });

    const snapshots: MatchSnapshot[] = [];
    const phases: string[] = [];

    const matches = new MatchManager(sessions, {
      onMatchStarted: (_matchId, _l, _r, snapshot) => {
        snapshots.push(snapshot);
        phases.push(snapshot.phase);
      },
      onMatchSnapshot: (_match, snapshot) => {
        snapshots.push(snapshot);
      },
      onMatchPhase: (match) => {
        phases.push(match.phase);
      },
      onMatchFinished: () => {},
      onMatchRematchUpdated: () => {},
      onPlayerReturnedToLobby: () => {},
      onDisconnectGraceExpiredRemovePlayer: () => {},
    });

    const match = matches.createMatch(left, right);
    expect(snapshots[0].phase).toBe('COUNTDOWN');
    expect(snapshots[0].paddlesUnlocked).toBe(false);

    // Players press movement keys early during first 1.5s of countdown
    matches.handleInput(left.playerId, match.matchId, -1, 1);
    matches.handleInput(right.playerId, match.matchId, 1, 1);

    vi.advanceTimersByTime(1900);
    // Before second 2 is reached, paddles are still locked at center
    expect(match.phase).toBe('COUNTDOWN');
    expect(match.physics.leftY).toBe(0.5);
    expect(match.physics.rightY).toBe(0.5);
    expect(match.physics.ballX).toBe(0.5);
    expect(match.physics.ballY).toBe(0.5);

    // Advance past second 2 into the final 1-second head-start window (t = 2500ms)
    vi.advanceTimersByTime(600);
    expect(match.phase).toBe('COUNTDOWN');
    expect(match.countdownPaddlesUnlocked).toBe(true);
    expect(match.physics.leftY).toBeLessThan(0.5);
    expect(match.physics.rightY).toBeGreaterThan(0.5);
    // Ball must remain stationary at center until countdown finishes
    expect(match.physics.ballX).toBe(0.5);
    expect(match.physics.ballY).toBe(0.5);

    const unlockedSnapshots = snapshots.filter(
      (s) => s.phase === 'COUNTDOWN' && s.paddlesUnlocked,
    );
    expect(unlockedSnapshots.length).toBeGreaterThan(0);

    // Complete remaining ~500ms -> transitions to PLAYING and ball begins moving
    vi.advanceTimersByTime(600);
    expect(match.phase).toBe('PLAYING');
    expect(phases).toContain('PLAYING');
    expect(match.physics.ballX).not.toBe(0.5);

    matches.clearAll();
  });
});
