import { describe, expect, it } from 'vitest';
import {
  BALL_MAX_SPEED,
  BALL_RADIUS_Y,
  PADDLE_HEIGHT,
  PADDLE_MARGIN_X,
  PADDLE_WIDTH,
  SIMULATION_DT_SEC,
} from '../../shared/src/constants.ts';
import {
  computeDemoPaddleInput,
  createInitialPhysics,
  stepMatchPhysics,
  stepPaddlesOnly,
} from '../../server/src/engine/pongEngine.ts';

describe('pongEngine physics', () => {
  it('moves and clamps paddles without moving the ball in stepPaddlesOnly', () => {
    const state = createInitialPhysics('right');
    const initialBallX = state.ballX;
    const initialBallY = state.ballY;

    for (let i = 0; i < 30; i++) {
      stepPaddlesOnly(state, { left: -1, right: 1 }, SIMULATION_DT_SEC);
    }

    expect(state.leftY).toBeLessThan(0.5);
    expect(state.rightY).toBeGreaterThan(0.5);
    expect(state.leftY).toBeGreaterThanOrEqual(PADDLE_HEIGHT / 2);
    expect(state.rightY).toBeLessThanOrEqual(1 - PADDLE_HEIGHT / 2);
    expect(state.ballX).toBe(initialBallX);
    expect(state.ballY).toBe(initialBallY);
  });

  it('clamps left and right paddles inside arena bounds', () => {
    const state = createInitialPhysics('right');
    for (let i = 0; i < 200; i++) {
      stepMatchPhysics(state, { left: -1, right: 1 }, SIMULATION_DT_SEC);
    }
    expect(state.leftY).toBeCloseTo(PADDLE_HEIGHT / 2, 5);
    expect(state.rightY).toBeCloseTo(1 - PADDLE_HEIGHT / 2, 5);
  });

  it('bounces ball off top and bottom walls cleanly', () => {
    const state = createInitialPhysics('right');
    state.ballX = 0.5;
    state.ballY = BALL_RADIUS_Y + 0.001;
    state.ballVx = 0.5;
    state.ballVy = -0.5;

    const topRes = stepMatchPhysics(state, { left: 0, right: 0 }, SIMULATION_DT_SEC);
    expect(topRes.wallHit).toBe(true);
    expect(state.ballVy).toBeGreaterThan(0);
    expect(state.ballY).toBeGreaterThanOrEqual(BALL_RADIUS_Y);

    state.ballY = 1 - BALL_RADIUS_Y - 0.001;
    state.ballVy = 0.5;
    const bottomRes = stepMatchPhysics(state, { left: 0, right: 0 }, SIMULATION_DT_SEC);
    expect(bottomRes.wallHit).toBe(true);
    expect(state.ballVy).toBeLessThan(0);
    expect(state.ballY).toBeLessThanOrEqual(1 - BALL_RADIUS_Y);
  });

  it('prevents ball tunneling through paddles even at max speed and caps speed', () => {
    const state = createInitialPhysics('left');
    const leftFaceX = PADDLE_MARGIN_X + PADDLE_WIDTH;
    state.leftY = 0.5;
    state.ballY = 0.5;
    state.ballX = leftFaceX + 0.015;
    state.ballVx = -BALL_MAX_SPEED;
    state.ballVy = 0;

    const res = stepMatchPhysics(state, { left: 0, right: 0 }, SIMULATION_DT_SEC);
    expect(res.paddleHit).toBe(true);
    expect(res.scoredSide).toBeNull();
    expect(state.ballVx).toBeGreaterThan(0);
    expect(Math.hypot(state.ballVx, state.ballVy)).toBeLessThanOrEqual(BALL_MAX_SPEED + 1e-6);
  });

  it('detects goals on left and right boundaries', () => {
    const stateLeft = createInitialPhysics('left');
    stateLeft.ballX = 0.001;
    stateLeft.ballY = 0.1; // away from paddle at 0.5
    stateLeft.ballVx = -1.2;
    stateLeft.ballVy = 0;
    const res1 = stepMatchPhysics(stateLeft, { left: 0, right: 0 }, SIMULATION_DT_SEC * 2);
    expect(res1.scoredSide).toBe('right');

    const stateRight = createInitialPhysics('right');
    stateRight.ballX = 0.999;
    stateRight.ballY = 0.1; // away from paddle at 0.5
    stateRight.ballVx = 1.2;
    stateRight.ballVy = 0;
    const res2 = stepMatchPhysics(stateRight, { left: 0, right: 0 }, SIMULATION_DT_SEC * 2);
    expect(res2.scoredSide).toBe('left');
  });

  it('supports full-height Demo paddle (1.0) rebounding top and bottom edge shots', () => {
    const rules = { rightPaddleHeight: 1.0 };
    const state = createInitialPhysics('right');
    const rightFaceX = 1 - PADDLE_MARGIN_X - PADDLE_WIDTH;

    // Attempting to move full-height paddle stays clamped cleanly at center 0.5
    stepPaddlesOnly(state, { left: 0, right: 1 }, SIMULATION_DT_SEC * 10, rules);
    expect(state.rightY).toBe(0.5);

    // Ball approaching near top edge (ballY = 0.05) should hit Demo paddle and angle upward
    state.ballX = rightFaceX - 0.01;
    state.ballY = 0.05;
    state.ballVx = 0.8;
    state.ballVy = 0;
    const topHit = stepMatchPhysics(state, { left: 0, right: 0 }, SIMULATION_DT_SEC * 2, rules);
    expect(topHit.paddleHit).toBe(true);
    expect(topHit.scoredSide).toBeNull();
    expect(state.ballVx).toBeLessThan(0);
    expect(state.ballVy).toBeLessThan(0);

    // Ball approaching near bottom edge (ballY = 0.95) should hit Demo paddle and angle downward
    state.ballX = rightFaceX - 0.01;
    state.ballY = 0.95;
    state.ballVx = 0.8;
    state.ballVy = 0;
    const bottomHit = stepMatchPhysics(state, { left: 0, right: 0 }, SIMULATION_DT_SEC * 2, rules);
    expect(bottomHit.paddleHit).toBe(true);
    expect(bottomHit.scoredSide).toBeNull();
    expect(state.ballVx).toBeLessThan(0);
    expect(state.ballVy).toBeGreaterThan(0);
  });

  it('computes Demo auto-movement input toward ballY and applies per-side paddle speed', () => {
    const state = createInitialPhysics('right');
    state.rightY = 0.5;
    state.ballY = 0.25;
    expect(computeDemoPaddleInput(state, 'right')).toBe(-1);

    state.ballY = 0.8;
    expect(computeDemoPaddleInput(state, 'right')).toBe(1);

    state.ballY = 0.505;
    expect(computeDemoPaddleInput(state, 'right')).toBe(0);

    const beforeLeft = state.leftY;
    const beforeRight = state.rightY;
    stepPaddlesOnly(
      state,
      { left: 1, right: 1 },
      0.2,
      { leftPaddleSpeed: 0.5, rightPaddleSpeed: 1.5, rightPaddleHeight: 0.25 },
    );
    expect(state.leftY - beforeLeft).toBeCloseTo(0.1, 4);
    expect(state.rightY - beforeRight).toBeCloseTo(0.3, 4);
  });
});
