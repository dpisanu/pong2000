import {
  ARENA_ASPECT,
  BALL_INITIAL_SPEED,
  BALL_MAX_SPEED,
  BALL_RADIUS_X,
  BALL_RADIUS_Y,
  BALL_SPEED_INCREMENT,
  MAX_BOUNCE_ANGLE_RAD,
  PADDLE_HEIGHT,
  PADDLE_MARGIN_X,
  PADDLE_SPEED,
  PADDLE_WIDTH,
} from '../../../shared/src/constants.ts';
import type { PaddleSide } from '../../../shared/src/types.ts';

export type PaddleInputDir = -1 | 0 | 1;

export interface PhysicsState {
  ballX: number;
  ballY: number;
  ballVx: number; // height-normalized units/sec
  ballVy: number; // height-normalized units/sec
  leftY: number;
  rightY: number;
  serveCount: number;
}

export interface PhysicsStepResult {
  scoredSide: PaddleSide | null;
  wallHit: boolean;
  paddleHit: boolean;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function createInitialPhysics(serveToward: PaddleSide = 'right'): PhysicsState {
  const state: PhysicsState = {
    ballX: 0.5,
    ballY: 0.5,
    ballVx: 0,
    ballVy: 0,
    leftY: 0.5,
    rightY: 0.5,
    serveCount: 0,
  };
  resetBallForServe(state, serveToward);
  return state;
}

export function resetBallForServe(state: PhysicsState, serveToward: PaddleSide): void {
  state.ballX = 0.5;
  state.ballY = 0.5;
  state.serveCount += 1;
  // Deterministic bounded serve angle alternating vertically by serveCount
  const anglePattern = [0.22, -0.26, 0.16, -0.2, 0.28, -0.14];
  const angle = anglePattern[(state.serveCount - 1) % anglePattern.length];
  const dirX = serveToward === 'right' ? 1 : -1;
  state.ballVx = dirX * Math.cos(angle) * BALL_INITIAL_SPEED;
  state.ballVy = Math.sin(angle) * BALL_INITIAL_SPEED;
}

export function stepMatchPhysics(
  state: PhysicsState,
  inputs: { left: PaddleInputDir; right: PaddleInputDir },
  dtSec: number,
): PhysicsStepResult {
  const minPaddleY = PADDLE_HEIGHT / 2;
  const maxPaddleY = 1 - PADDLE_HEIGHT / 2;

  state.leftY = clamp(state.leftY + inputs.left * PADDLE_SPEED * dtSec, minPaddleY, maxPaddleY);
  state.rightY = clamp(state.rightY + inputs.right * PADDLE_SPEED * dtSec, minPaddleY, maxPaddleY);

  const substeps = 4;
  const subDt = dtSec / substeps;
  const leftFaceX = PADDLE_MARGIN_X + PADDLE_WIDTH;
  const leftBackX = PADDLE_MARGIN_X;
  const rightFaceX = 1 - PADDLE_MARGIN_X - PADDLE_WIDTH;
  const rightBackX = 1 - PADDLE_MARGIN_X;
  const halfPaddleH = PADDLE_HEIGHT / 2 + BALL_RADIUS_Y * 0.65;

  let wallHit = false;
  let paddleHit = false;

  for (let i = 0; i < substeps; i++) {
    const prevX = state.ballX;
    state.ballX += (state.ballVx / ARENA_ASPECT) * subDt;
    state.ballY += state.ballVy * subDt;

    // Top / Bottom wall bounce
    if (state.ballY - BALL_RADIUS_Y <= 0) {
      state.ballY = BALL_RADIUS_Y;
      state.ballVy = Math.abs(state.ballVy);
      wallHit = true;
    } else if (state.ballY + BALL_RADIUS_Y >= 1) {
      state.ballY = 1 - BALL_RADIUS_Y;
      state.ballVy = -Math.abs(state.ballVy);
      wallHit = true;
    }

    // Left paddle collision (moving left)
    if (
      state.ballVx < 0 &&
      prevX - BALL_RADIUS_X >= leftBackX &&
      state.ballX - BALL_RADIUS_X <= leftFaceX &&
      state.ballX + BALL_RADIUS_X >= leftBackX
    ) {
      if (Math.abs(state.ballY - state.leftY) <= halfPaddleH) {
        const relY = clamp((state.ballY - state.leftY) / (PADDLE_HEIGHT / 2), -1, 1);
        const bounceAngle = relY * MAX_BOUNCE_ANGLE_RAD;
        const speed = Math.min(
          BALL_MAX_SPEED,
          Math.hypot(state.ballVx, state.ballVy) + BALL_SPEED_INCREMENT,
        );
        state.ballVx = Math.cos(bounceAngle) * speed;
        state.ballVy = Math.sin(bounceAngle) * speed;
        state.ballX = leftFaceX + BALL_RADIUS_X + 0.0005;
        paddleHit = true;
      }
    }

    // Right paddle collision (moving right)
    if (
      state.ballVx > 0 &&
      prevX + BALL_RADIUS_X <= rightBackX &&
      state.ballX + BALL_RADIUS_X >= rightFaceX &&
      state.ballX - BALL_RADIUS_X <= rightBackX
    ) {
      if (Math.abs(state.ballY - state.rightY) <= halfPaddleH) {
        const relY = clamp((state.ballY - state.rightY) / (PADDLE_HEIGHT / 2), -1, 1);
        const bounceAngle = relY * MAX_BOUNCE_ANGLE_RAD;
        const speed = Math.min(
          BALL_MAX_SPEED,
          Math.hypot(state.ballVx, state.ballVy) + BALL_SPEED_INCREMENT,
        );
        state.ballVx = -Math.cos(bounceAngle) * speed;
        state.ballVy = Math.sin(bounceAngle) * speed;
        state.ballX = rightFaceX - BALL_RADIUS_X - 0.0005;
        paddleHit = true;
      }
    }

    // Goal boundaries
    if (state.ballX + BALL_RADIUS_X < 0) {
      return { scoredSide: 'right', wallHit, paddleHit };
    }
    if (state.ballX - BALL_RADIUS_X > 1) {
      return { scoredSide: 'left', wallHit, paddleHit };
    }
  }

  return { scoredSide: null, wallHit, paddleHit };
}
