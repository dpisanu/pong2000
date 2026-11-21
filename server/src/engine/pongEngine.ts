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

export interface EngineRules {
  leftPaddleHeight?: number;
  rightPaddleHeight?: number;
  paddleSpeed?: number;
  leftPaddleSpeed?: number;
  rightPaddleSpeed?: number;
  ballInitialSpeed?: number;
  ballSpeedIncrement?: number;
  ballMaxSpeed?: number;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function createInitialPhysics(
  serveToward: PaddleSide = 'right',
  ballInitialSpeed: number = BALL_INITIAL_SPEED,
): PhysicsState {
  const state: PhysicsState = {
    ballX: 0.5,
    ballY: 0.5,
    ballVx: 0,
    ballVy: 0,
    leftY: 0.5,
    rightY: 0.5,
    serveCount: 0,
  };
  resetBallForServe(state, serveToward, ballInitialSpeed);
  return state;
}

export function resetBallForServe(
  state: PhysicsState,
  serveToward: PaddleSide,
  ballInitialSpeed: number = BALL_INITIAL_SPEED,
): void {
  state.ballX = 0.5;
  state.ballY = 0.5;
  state.serveCount += 1;
  // Deterministic bounded serve angle alternating vertically by serveCount
  const anglePattern = [0.22, -0.26, 0.16, -0.2, 0.28, -0.14];
  const angle = anglePattern[(state.serveCount - 1) % anglePattern.length];
  const dirX = serveToward === 'right' ? 1 : -1;
  state.ballVx = dirX * Math.cos(angle) * ballInitialSpeed;
  state.ballVy = Math.sin(angle) * ballInitialSpeed;
}

export function computeDemoPaddleInput(
  state: PhysicsState,
  demoSide: PaddleSide,
): PaddleInputDir {
  const paddleY = demoSide === 'left' ? state.leftY : state.rightY;
  const diff = state.ballY - paddleY;
  if (Math.abs(diff) <= 0.012) return 0;
  return diff < 0 ? -1 : 1;
}

export function stepPaddlesOnly(
  state: PhysicsState,
  inputs: { left: PaddleInputDir; right: PaddleInputDir },
  dtSec: number,
  rules?: EngineRules,
): void {
  const leftHeight = rules?.leftPaddleHeight ?? PADDLE_HEIGHT;
  const rightHeight = rules?.rightPaddleHeight ?? PADDLE_HEIGHT;
  const baseSpeed = rules?.paddleSpeed ?? PADDLE_SPEED;
  const leftSpeed = rules?.leftPaddleSpeed ?? baseSpeed;
  const rightSpeed = rules?.rightPaddleSpeed ?? baseSpeed;

  const minLeftY = leftHeight / 2;
  const maxLeftY = 1 - leftHeight / 2;
  const minRightY = rightHeight / 2;
  const maxRightY = 1 - rightHeight / 2;

  state.leftY = clamp(state.leftY + inputs.left * leftSpeed * dtSec, minLeftY, maxLeftY);
  state.rightY = clamp(state.rightY + inputs.right * rightSpeed * dtSec, minRightY, maxRightY);
}

export function stepMatchPhysics(
  state: PhysicsState,
  inputs: { left: PaddleInputDir; right: PaddleInputDir },
  dtSec: number,
  rules?: EngineRules,
): PhysicsStepResult {
  stepPaddlesOnly(state, inputs, dtSec, rules);

  const leftHeight = rules?.leftPaddleHeight ?? PADDLE_HEIGHT;
  const rightHeight = rules?.rightPaddleHeight ?? PADDLE_HEIGHT;
  const ballSpeedIncrement = rules?.ballSpeedIncrement ?? BALL_SPEED_INCREMENT;
  const ballMaxSpeed = rules?.ballMaxSpeed ?? BALL_MAX_SPEED;

  const substeps = 4;
  const subDt = dtSec / substeps;
  const leftFaceX = PADDLE_MARGIN_X + PADDLE_WIDTH;
  const leftBackX = PADDLE_MARGIN_X;
  const rightFaceX = 1 - PADDLE_MARGIN_X - PADDLE_WIDTH;
  const rightBackX = 1 - PADDLE_MARGIN_X;
  const leftHalfPaddleH = leftHeight / 2 + BALL_RADIUS_Y * 0.65;
  const rightHalfPaddleH = rightHeight / 2 + BALL_RADIUS_Y * 0.65;

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
      if (Math.abs(state.ballY - state.leftY) <= leftHalfPaddleH) {
        const relY = clamp((state.ballY - state.leftY) / (leftHeight / 2), -1, 1);
        const bounceAngle = relY * MAX_BOUNCE_ANGLE_RAD;
        const speed = Math.min(
          ballMaxSpeed,
          Math.hypot(state.ballVx, state.ballVy) + ballSpeedIncrement,
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
      if (Math.abs(state.ballY - state.rightY) <= rightHalfPaddleH) {
        const relY = clamp((state.ballY - state.rightY) / (rightHeight / 2), -1, 1);
        const bounceAngle = relY * MAX_BOUNCE_ANGLE_RAD;
        const speed = Math.min(
          ballMaxSpeed,
          Math.hypot(state.ballVx, state.ballVy) + ballSpeedIncrement,
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
