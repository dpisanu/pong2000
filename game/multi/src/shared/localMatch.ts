import {
  BALL_INITIAL_SPEED,
  BALL_MAX_SPEED,
  BALL_SPEED_INCREMENT,
  BUNDLED_AVATARS,
  COUNTDOWN_PADDLE_UNLOCK_MS,
  INITIAL_COUNTDOWN_MS,
  MAX_CATCHUP_STEPS,
  PADDLE_HEIGHT,
  PADDLE_SPEED,
  POINT_COUNTDOWN_MS,
  RESUME_COUNTDOWN_MS,
  SIMULATION_DT_MS,
  SIMULATION_DT_SEC,
  WIN_SCORE,
} from './constants.ts';
import {
  createInitialPhysics,
  resetBallForServe,
  stepMatchPhysics,
  stepPaddlesOnly,
  type EngineRules,
  type PaddleInputDir,
  type PhysicsState,
} from './pongEngine.ts';
import type {
  ActiveMatchSync,
  MatchOutcomeReason,
  MatchParticipant,
  MatchPhase,
  MatchRulesConfig,
  MatchSnapshot,
  PaddleSide,
} from './types.ts';

export interface LocalPlayerInfo {
  playerId: string;
  nickname: string;
  avatarId: string;
  avatarUrl: string;
}

export interface LocalMatchState {
  matchId: string;
  participants: [MatchParticipant, MatchParticipant];
  rules: MatchRulesConfig;
  phase: MatchPhase;
  physics: PhysicsState;
  inputs: { left: PaddleInputDir; right: PaddleInputDir };
  score: { left: number; right: number };
  tick: number;
  countdownEndsAt: number | null;
  countdownEndPerfMs: number | null;
  countdownPaddlesUnlocked: boolean;
  winnerPlayerId: string | null;
  outcomeReason: MatchOutcomeReason | null;
  accumulatorMs: number;
  lastStepPerfMs: number;
}

export const DEFAULT_LOCAL_PLAYERS: [LocalPlayerInfo, LocalPlayerInfo] = [
  {
    playerId: 'local_p1',
    nickname: 'Player 1',
    avatarId: BUNDLED_AVATARS[0].id,
    avatarUrl: BUNDLED_AVATARS[0].url,
  },
  {
    playerId: 'local_p2',
    nickname: 'Player 2',
    avatarId: BUNDLED_AVATARS[1].id,
    avatarUrl: BUNDLED_AVATARS[1].url,
  },
];

export function createDefaultLocalRules(overrides: Partial<MatchRulesConfig> = {}): MatchRulesConfig {
  const paddleHeight = overrides.paddleHeight ?? PADDLE_HEIGHT;
  return {
    paddleHeight,
    leftPaddleHeight: overrides.leftPaddleHeight ?? paddleHeight,
    rightPaddleHeight: overrides.rightPaddleHeight ?? paddleHeight,
    paddleSpeed: overrides.paddleSpeed ?? PADDLE_SPEED,
    ballInitialSpeed: overrides.ballInitialSpeed ?? BALL_INITIAL_SPEED,
    ballSpeedIncrement: overrides.ballSpeedIncrement ?? BALL_SPEED_INCREMENT,
    ballMaxSpeed: overrides.ballMaxSpeed ?? BALL_MAX_SPEED,
    winScore: overrides.winScore ?? WIN_SCORE,
    initialCountdownMs: overrides.initialCountdownMs ?? INITIAL_COUNTDOWN_MS,
    pointCountdownMs: overrides.pointCountdownMs ?? POINT_COUNTDOWN_MS,
    resumeCountdownMs: overrides.resumeCountdownMs ?? RESUME_COUNTDOWN_MS,
    isDemoMatch: false,
    demoSide: null,
    demoMode: null,
    demoPaddleSpeed: 0,
  };
}

let localMatchCounter = 0;

function nextLocalMatchId(): string {
  localMatchCounter += 1;
  return `local_mt_${localMatchCounter}`;
}

export function createLocalMatchState(options?: {
  leftPlayer?: LocalPlayerInfo;
  rightPlayer?: LocalPlayerInfo;
  rules?: Partial<MatchRulesConfig>;
  nowEpochMs?: number;
  nowPerfMs?: number;
}): LocalMatchState {
  const left = options?.leftPlayer ?? DEFAULT_LOCAL_PLAYERS[0];
  const right = options?.rightPlayer ?? DEFAULT_LOCAL_PLAYERS[1];
  const rules = createDefaultLocalRules(options?.rules);
  const nowEpochMs = options?.nowEpochMs ?? Date.now();
  const nowPerfMs = options?.nowPerfMs ?? performance.now();

  return {
    matchId: nextLocalMatchId(),
    participants: [
      {
        playerId: left.playerId,
        nickname: left.nickname,
        avatarId: left.avatarId,
        avatarUrl: left.avatarUrl,
        side: 'left',
        connected: true,
      },
      {
        playerId: right.playerId,
        nickname: right.nickname,
        avatarId: right.avatarId,
        avatarUrl: right.avatarUrl,
        side: 'right',
        connected: true,
      },
    ],
    rules,
    phase: 'COUNTDOWN',
    physics: createInitialPhysics('right', rules.ballInitialSpeed),
    inputs: { left: 0, right: 0 },
    score: { left: 0, right: 0 },
    tick: 0,
    countdownEndsAt: nowEpochMs + rules.initialCountdownMs,
    countdownEndPerfMs: nowPerfMs + rules.initialCountdownMs,
    countdownPaddlesUnlocked: false,
    winnerPlayerId: null,
    outcomeReason: null,
    accumulatorMs: 0,
    lastStepPerfMs: nowPerfMs,
  };
}

export function stepLocalMatchState(
  state: LocalMatchState,
  nowPerfMs: number,
  nowEpochMs: number = Date.now(),
): boolean {
  if (state.phase === 'FINISHED' || state.phase === 'FORFEITED' || state.phase === 'CLOSED') {
    state.lastStepPerfMs = nowPerfMs;
    return false;
  }

  const elapsedMs = Math.max(0, nowPerfMs - state.lastStepPerfMs);
  state.lastStepPerfMs = nowPerfMs;

  const engineRules: EngineRules = {
    leftPaddleHeight: state.rules.leftPaddleHeight,
    rightPaddleHeight: state.rules.rightPaddleHeight,
    paddleSpeed: state.rules.paddleSpeed,
    ballInitialSpeed: state.rules.ballInitialSpeed,
    ballSpeedIncrement: state.rules.ballSpeedIncrement,
    ballMaxSpeed: state.rules.ballMaxSpeed,
  };

  if (state.phase === 'COUNTDOWN') {
    if (state.countdownEndPerfMs === null) return false;
    const remainingMs = state.countdownEndPerfMs - nowPerfMs;

    if (remainingMs <= 0) {
      state.phase = 'PLAYING';
      state.countdownEndsAt = null;
      state.countdownEndPerfMs = null;
      state.countdownPaddlesUnlocked = true;
      state.accumulatorMs = SIMULATION_DT_MS;
      return true;
    }

    if (remainingMs <= COUNTDOWN_PADDLE_UNLOCK_MS) {
      let changed = false;
      if (!state.countdownPaddlesUnlocked) {
        state.countdownPaddlesUnlocked = true;
        state.accumulatorMs = SIMULATION_DT_MS;
        changed = true;
      } else {
        state.accumulatorMs = Math.min(
          state.accumulatorMs + elapsedMs,
          SIMULATION_DT_MS * MAX_CATCHUP_STEPS,
        );
      }

      while (state.accumulatorMs >= SIMULATION_DT_MS) {
        state.accumulatorMs -= SIMULATION_DT_MS;
        state.tick += 1;
        changed = true;
        stepPaddlesOnly(state.physics, state.inputs, SIMULATION_DT_SEC, engineRules);
      }
      return changed;
    }

    state.countdownPaddlesUnlocked = false;
    state.accumulatorMs = 0;
    return false;
  }

  // PLAYING: fixed 60 Hz simulation using identical engine physics as multi
  state.accumulatorMs = Math.min(
    state.accumulatorMs + elapsedMs,
    SIMULATION_DT_MS * MAX_CATCHUP_STEPS,
  );

  let changed = false;
  while (state.accumulatorMs >= SIMULATION_DT_MS && state.phase === 'PLAYING') {
    state.accumulatorMs -= SIMULATION_DT_MS;
    state.tick += 1;
    changed = true;

    const result = stepMatchPhysics(state.physics, state.inputs, SIMULATION_DT_SEC, engineRules);
    if (result.scoredSide) {
      if (result.scoredSide === 'left') {
        state.score.left += 1;
      } else {
        state.score.right += 1;
      }

      if (state.score.left >= state.rules.winScore || state.score.right >= state.rules.winScore) {
        const winnerSide: PaddleSide = state.score.left >= state.rules.winScore ? 'left' : 'right';
        state.phase = 'FINISHED';
        state.winnerPlayerId =
          winnerSide === 'left'
            ? state.participants[0].playerId
            : state.participants[1].playerId;
        state.outcomeReason = 'SCORE_LIMIT';
        state.countdownEndsAt = null;
        state.countdownEndPerfMs = null;
        state.countdownPaddlesUnlocked = false;
        state.accumulatorMs = 0;
        return true;
      }

      const serveToward: PaddleSide = result.scoredSide === 'left' ? 'right' : 'left';
      resetBallForServe(state.physics, serveToward, state.rules.ballInitialSpeed);
      state.phase = 'COUNTDOWN';
      state.countdownEndsAt = nowEpochMs + state.rules.pointCountdownMs;
      state.countdownEndPerfMs = nowPerfMs + state.rules.pointCountdownMs;
      state.countdownPaddlesUnlocked = false;
      state.accumulatorMs = 0;
      return true;
    }
  }

  return changed;
}

export function createRestartedLocalMatch(
  prev: LocalMatchState,
  options?: {
    swapSides?: boolean;
    nowEpochMs?: number;
    nowPerfMs?: number;
  },
): LocalMatchState {
  const [currLeft, currRight] = prev.participants;
  const nextLeft = options?.swapSides ? currRight : currLeft;
  const nextRight = options?.swapSides ? currLeft : currRight;

  return createLocalMatchState({
    leftPlayer: nextLeft,
    rightPlayer: nextRight,
    rules: prev.rules,
    nowEpochMs: options?.nowEpochMs,
    nowPerfMs: options?.nowPerfMs,
  });
}

export function toLocalMatchSnapshot(state: LocalMatchState): MatchSnapshot {
  return {
    matchId: state.matchId,
    tick: state.tick,
    phase: state.phase,
    ball: {
      x: state.physics.ballX,
      y: state.physics.ballY,
      vx: state.physics.ballVx,
      vy: state.physics.ballVy,
    },
    paddles: {
      leftY: state.physics.leftY,
      rightY: state.physics.rightY,
    },
    score: {
      left: state.score.left,
      right: state.score.right,
    },
    countdownEndsAt: state.countdownEndsAt,
    paddlesUnlocked:
      state.phase === 'PLAYING' ||
      (state.phase === 'COUNTDOWN' && state.countdownPaddlesUnlocked),
    pausedReason: null,
    pauseExpiresAt: null,
    disconnectedPlayerId: null,
  };
}

export function toActiveMatchSync(state: LocalMatchState): ActiveMatchSync {
  return {
    matchId: state.matchId,
    yourSide: 'left',
    participants: state.participants,
    snapshot: toLocalMatchSnapshot(state),
    rematch: {
      matchId: state.matchId,
      requestedByPlayerId: null,
      acceptedByPlayerId: null,
      status: 'NONE',
    },
    rules: state.rules,
    winnerPlayerId: state.winnerPlayerId,
    outcomeReason: state.outcomeReason,
  };
}
