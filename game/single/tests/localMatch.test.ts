import { describe, expect, it } from 'vitest';
import {
  COUNTDOWN_PADDLE_UNLOCK_MS,
  INITIAL_COUNTDOWN_MS,
  POINT_COUNTDOWN_MS,
  SIMULATION_DT_MS,
  WIN_SCORE,
} from '@multi/shared/constants.ts';
import {
  createLocalMatchState,
  createRestartedLocalMatch,
  stepLocalMatchState,
  toActiveMatchSync,
} from '@multi/shared/localMatch.ts';

describe('localMatch (single-page 2-player shared engine)', () => {
  it('initializes directly in COUNTDOWN with two connected human players', () => {
    const state = createLocalMatchState({ nowEpochMs: 10_000, nowPerfMs: 1_000 });
    const sync = toActiveMatchSync(state);

    expect(state.phase).toBe('COUNTDOWN');
    expect(state.participants[0].nickname).toBe('Player 1');
    expect(state.participants[0].side).toBe('left');
    expect(state.participants[0].connected).toBe(true);
    expect(state.participants[1].nickname).toBe('Player 2');
    expect(state.participants[1].side).toBe('right');
    expect(state.participants[1].connected).toBe(true);
    expect(sync.snapshot.paddlesUnlocked).toBe(false);
    expect(sync.rules?.isDemoMatch).toBe(false);
    expect(sync.rules?.winScore).toBe(WIN_SCORE);
  });

  it('keeps paddles locked early in countdown, unlocks in final 1s, and moves both paddles simultaneously', () => {
    const startPerf = 1_000;
    const state = createLocalMatchState({ nowEpochMs: 50_000, nowPerfMs: startPerf });
    state.inputs.left = -1; // W
    state.inputs.right = 1; // ArrowDown

    // Before the final COUNTDOWN_PADDLE_UNLOCK_MS window: paddles stay centered and locked
    const earlyPerf = startPerf + INITIAL_COUNTDOWN_MS - COUNTDOWN_PADDLE_UNLOCK_MS - 100;
    stepLocalMatchState(state, earlyPerf, 50_000);
    expect(state.phase).toBe('COUNTDOWN');
    expect(state.countdownPaddlesUnlocked).toBe(false);
    expect(state.physics.leftY).toBeCloseTo(0.5, 5);
    expect(state.physics.rightY).toBeCloseTo(0.5, 5);

    // Inside final COUNTDOWN_PADDLE_UNLOCK_MS window: both paddles unlock and respond simultaneously
    const unlockPerf = startPerf + INITIAL_COUNTDOWN_MS - COUNTDOWN_PADDLE_UNLOCK_MS + 100;
    const changed = stepLocalMatchState(state, unlockPerf, 52_100);
    expect(changed).toBe(true);
    expect(state.phase).toBe('COUNTDOWN');
    expect(state.countdownPaddlesUnlocked).toBe(true);

    // Advance two 60 Hz frames during unlock window
    stepLocalMatchState(state, unlockPerf + SIMULATION_DT_MS * 2, 52_134);
    expect(state.physics.leftY).toBeLessThan(0.5);
    expect(state.physics.rightY).toBeGreaterThan(0.5);

    // Crossing countdown completion transitions into PLAYING
    stepLocalMatchState(state, startPerf + INITIAL_COUNTDOWN_MS, 53_000);
    expect(state.phase).toBe('PLAYING');
  });

  it('awards points, runs point countdown, and finishes with SCORE_LIMIT at winScore', () => {
    const startPerf = 2_000;
    const state = createLocalMatchState({
      rules: { winScore: 2, initialCountdownMs: 500, pointCountdownMs: POINT_COUNTDOWN_MS },
      nowEpochMs: 20_000,
      nowPerfMs: startPerf,
    });

    // Enter PLAYING
    stepLocalMatchState(state, startPerf + 500, 20_500);
    expect(state.phase).toBe('PLAYING');

    // Place ball right at the right goal line moving right -> Left Player scores 1-0
    state.physics.ballX = 1.01;
    state.physics.ballY = 0.5;
    state.physics.ballVx = 0.8;
    state.physics.ballVy = 0;

    const afterPointPerf = startPerf + 500 + SIMULATION_DT_MS;
    stepLocalMatchState(state, afterPointPerf, 20_517);
    expect(state.score).toEqual({ left: 1, right: 0 });
    expect(state.phase).toBe('COUNTDOWN');
    expect(state.countdownEndsAt).toBe(20_517 + POINT_COUNTDOWN_MS);
    // Serve resets toward the scored-on side (right)
    expect(state.physics.ballX).toBeCloseTo(0.5, 5);
    expect(state.physics.ballVx).toBeGreaterThan(0);

    // Finish point countdown back into PLAYING and score winning point
    const resumedPerf = afterPointPerf + POINT_COUNTDOWN_MS;
    stepLocalMatchState(state, resumedPerf, 22_017);
    expect(state.phase).toBe('PLAYING');

    state.physics.ballX = 1.01;
    state.physics.ballY = 0.5;
    state.physics.ballVx = 0.8;
    state.physics.ballVy = 0;

    stepLocalMatchState(state, resumedPerf + SIMULATION_DT_MS, 22_034);
    expect(state.score).toEqual({ left: 2, right: 0 });
    expect(state.phase).toBe('FINISHED');
    expect(state.winnerPlayerId).toBe(state.participants[0].playerId);
    expect(state.outcomeReason).toBe('SCORE_LIMIT');
  });

  it('supports restarting and swapping sides via createRestartedLocalMatch', () => {
    const initial = createLocalMatchState({ nowEpochMs: 1_000, nowPerfMs: 1_000 });
    initial.score = { left: 5, right: 2 };
    initial.phase = 'FINISHED';
    initial.winnerPlayerId = initial.participants[0].playerId;

    const sameSides = createRestartedLocalMatch(initial, {
      swapSides: false,
      nowEpochMs: 5_000,
      nowPerfMs: 5_000,
    });
    expect(sameSides.matchId).not.toBe(initial.matchId);
    expect(sameSides.phase).toBe('COUNTDOWN');
    expect(sameSides.score).toEqual({ left: 0, right: 0 });
    expect(sameSides.participants[0].playerId).toBe(initial.participants[0].playerId);
    expect(sameSides.participants[1].playerId).toBe(initial.participants[1].playerId);

    const swapped = createRestartedLocalMatch(initial, {
      swapSides: true,
      nowEpochMs: 6_000,
      nowPerfMs: 6_000,
    });
    expect(swapped.participants[0].playerId).toBe(initial.participants[1].playerId);
    expect(swapped.participants[0].side).toBe('left');
    expect(swapped.participants[1].playerId).toBe(initial.participants[0].playerId);
    expect(swapped.participants[1].side).toBe('right');
  });
});
