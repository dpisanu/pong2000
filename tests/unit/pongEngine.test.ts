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
  createInitialPhysics,
  stepMatchPhysics,
} from '../../server/src/engine/pongEngine.ts';

describe('pongEngine physics', () => {
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
});
