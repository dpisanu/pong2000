import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  DISCONNECT_GRACE_MS,
  INITIAL_COUNTDOWN_MS,
  MAX_CATCHUP_STEPS,
  POINT_COUNTDOWN_MS,
  RESUME_COUNTDOWN_MS,
  SIMULATION_DT_MS,
  SIMULATION_DT_SEC,
  SNAPSHOT_INTERVAL_TICKS,
  WIN_SCORE,
} from '../../../shared/src/constants.ts';
import type {
  ActiveMatchSync,
  ErrorCode,
  MatchOutcomeReason,
  MatchParticipant,
  MatchPhase,
  MatchRematchState,
  MatchSnapshot,
  PaddleSide,
} from '../../../shared/src/types.ts';
import {
  createInitialPhysics,
  resetBallForServe,
  stepMatchPhysics,
  type PaddleInputDir,
  type PhysicsState,
} from '../engine/pongEngine.ts';
import type { PlayerSession, SessionManager } from '../sessions/sessionManager.ts';

export interface MatchRecord {
  matchId: string;
  leftPlayerId: string;
  rightPlayerId: string;
  phase: MatchPhase;
  physics: PhysicsState;
  inputs: { left: PaddleInputDir; right: PaddleInputDir };
  lastSeq: { left: number; right: number };
  score: { left: number; right: number };
  tick: number;
  countdownEndsAt: number | null;
  countdownEndPerfMs: number | null;
  pauseExpiresAt: number | null;
  disconnectedPlayerId: string | null;
  disconnectTimers: Map<string, ReturnType<typeof setTimeout>>;
  rematchRequestedBy: string | null;
  rematchAcceptedBy: string | null;
  rematchCancelled: boolean;
  winnerPlayerId: string | null;
  outcomeReason: MatchOutcomeReason | null;
  returnedToLobby: Set<string>;
  loopTimer: ReturnType<typeof setInterval> | null;
  lastStepPerfMs: number;
  accumulatorMs: number;
  snapshotTickCounter: number;
}

export interface MatchCallbacks {
  onMatchStarted: (matchId: string, left: PlayerSession, right: PlayerSession, snapshot: MatchSnapshot, participants: [MatchParticipant, MatchParticipant]) => void;
  onMatchSnapshot: (match: MatchRecord, snapshot: MatchSnapshot) => void;
  onMatchPhase: (match: MatchRecord, participants: [MatchParticipant, MatchParticipant]) => void;
  onMatchFinished: (
    match: MatchRecord,
    winner: PlayerSession,
    winnerSide: PaddleSide,
    reason: MatchOutcomeReason,
  ) => void;
  onMatchRematchUpdated: (match: MatchRecord, state: MatchRematchState) => void;
  onPlayerReturnedToLobby: (player: PlayerSession) => void;
  onDisconnectGraceExpiredRemovePlayer: (playerId: string) => void;
}

export class MatchError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export class MatchManager {
  private readonly matches = new Map<string, MatchRecord>();
  private readonly sessions: SessionManager;
  private readonly callbacks: MatchCallbacks;
  private readonly graceMs: number;

  constructor(
    sessions: SessionManager,
    callbacks: MatchCallbacks,
    graceMs: number = DISCONNECT_GRACE_MS,
  ) {
    this.sessions = sessions;
    this.callbacks = callbacks;
    this.graceMs = graceMs;
  }

  getMatchById(matchId: string): MatchRecord | undefined {
    return this.matches.get(matchId);
  }

  getActiveMatchCount(): number {
    return this.matches.size;
  }

  getParticipants(match: MatchRecord): [MatchParticipant, MatchParticipant] {
    const left = this.sessions.getById(match.leftPlayerId);
    const right = this.sessions.getById(match.rightPlayerId);
    return [
      {
        playerId: match.leftPlayerId,
        nickname: left?.nickname ?? 'Left Player',
        avatarId: left?.avatarId ?? 'gallery:ace-paddle',
        avatarUrl: left?.avatarUrl ?? '/avatars/default.svg',
        side: 'left',
        connected: Boolean(left?.connected),
      },
      {
        playerId: match.rightPlayerId,
        nickname: right?.nickname ?? 'Right Player',
        avatarId: right?.avatarId ?? 'gallery:rally-fox',
        avatarUrl: right?.avatarUrl ?? '/avatars/default.svg',
        side: 'right',
        connected: Boolean(right?.connected),
      },
    ];
  }

  toSnapshot(match: MatchRecord): MatchSnapshot {
    return {
      matchId: match.matchId,
      tick: match.tick,
      phase: match.phase,
      ball: {
        x: Number(match.physics.ballX.toFixed(5)),
        y: Number(match.physics.ballY.toFixed(5)),
        vx: Number(match.physics.ballVx.toFixed(4)),
        vy: Number(match.physics.ballVy.toFixed(4)),
      },
      paddles: {
        leftY: Number(match.physics.leftY.toFixed(5)),
        rightY: Number(match.physics.rightY.toFixed(5)),
      },
      score: {
        left: match.score.left,
        right: match.score.right,
      },
      countdownEndsAt: match.countdownEndsAt,
      pausedReason:
        match.phase === 'PAUSED_DISCONNECT' ? 'Opponent disconnected. Waiting for reconnect.' : null,
      pauseExpiresAt: match.pauseExpiresAt,
      disconnectedPlayerId: match.disconnectedPlayerId,
    };
  }

  getRematchState(match: MatchRecord): MatchRematchState {
    let status: MatchRematchState['status'] = 'NONE';
    if (match.rematchCancelled) {
      status = 'CANCELLED';
    } else if (match.rematchRequestedBy && match.rematchAcceptedBy) {
      status = 'ACCEPTED';
    } else if (match.rematchRequestedBy) {
      status = 'PENDING';
    }
    return {
      matchId: match.matchId,
      requestedByPlayerId: match.rematchRequestedBy,
      acceptedByPlayerId: match.rematchAcceptedBy,
      status,
    };
  }

  getActiveMatchSync(playerId: string): ActiveMatchSync | null {
    const session = this.sessions.getById(playerId);
    if (!session?.activeMatchId) return null;
    const match = this.matches.get(session.activeMatchId);
    if (!match || match.phase === 'CLOSED') return null;

    const yourSide: PaddleSide = match.leftPlayerId === playerId ? 'left' : 'right';
    return {
      matchId: match.matchId,
      yourSide,
      participants: this.getParticipants(match),
      snapshot: this.toSnapshot(match),
      rematch: this.getRematchState(match),
      winnerPlayerId: match.winnerPlayerId,
      outcomeReason: match.outcomeReason,
    };
  }

  createMatch(leftPlayer: PlayerSession, rightPlayer: PlayerSession): MatchRecord {
    const matchId = `mt_${crypto.randomBytes(8).toString('hex')}`;
    const nowEpoch = Date.now();
    const nowPerf = performance.now();

    leftPlayer.status = 'IN_GAME';
    leftPlayer.priorStatus = 'IN_GAME';
    leftPlayer.activeMatchId = matchId;
    leftPlayer.activeChallengeId = null;

    rightPlayer.status = 'IN_GAME';
    rightPlayer.priorStatus = 'IN_GAME';
    rightPlayer.activeMatchId = matchId;
    rightPlayer.activeChallengeId = null;

    const match: MatchRecord = {
      matchId,
      leftPlayerId: leftPlayer.playerId,
      rightPlayerId: rightPlayer.playerId,
      phase: 'COUNTDOWN',
      physics: createInitialPhysics('right'),
      inputs: { left: 0, right: 0 },
      lastSeq: { left: -1, right: -1 },
      score: { left: 0, right: 0 },
      tick: 0,
      countdownEndsAt: nowEpoch + INITIAL_COUNTDOWN_MS,
      countdownEndPerfMs: nowPerf + INITIAL_COUNTDOWN_MS,
      pauseExpiresAt: null,
      disconnectedPlayerId: null,
      disconnectTimers: new Map(),
      rematchRequestedBy: null,
      rematchAcceptedBy: null,
      rematchCancelled: false,
      winnerPlayerId: null,
      outcomeReason: null,
      returnedToLobby: new Set(),
      loopTimer: null,
      lastStepPerfMs: nowPerf,
      accumulatorMs: 0,
      snapshotTickCounter: 0,
    };

    this.matches.set(matchId, match);
    const participants = this.getParticipants(match);
    const snapshot = this.toSnapshot(match);

    this.callbacks.onMatchStarted(matchId, leftPlayer, rightPlayer, snapshot, participants);

    match.loopTimer = setInterval(() => {
      this.tickMatch(match);
    }, 16);

    return match;
  }

  private tickMatch(match: MatchRecord): void {
    if (
      match.phase === 'FINISHED' ||
      match.phase === 'FORFEITED' ||
      match.phase === 'CLOSED' ||
      match.phase === 'PAUSED_DISCONNECT'
    ) {
      match.lastStepPerfMs = performance.now();
      return;
    }

    const nowPerf = performance.now();
    const elapsedMs = Math.max(0, nowPerf - match.lastStepPerfMs);
    match.lastStepPerfMs = nowPerf;

    if (match.phase === 'COUNTDOWN') {
      if (match.countdownEndPerfMs !== null && nowPerf >= match.countdownEndPerfMs) {
        match.phase = 'PLAYING';
        match.countdownEndsAt = null;
        match.countdownEndPerfMs = null;
        match.accumulatorMs = 0;
        this.callbacks.onMatchPhase(match, this.getParticipants(match));
        this.callbacks.onMatchSnapshot(match, this.toSnapshot(match));
      }
      return;
    }

    // PLAYING: fixed 60 Hz simulation with catch-up cap
    match.accumulatorMs = Math.min(
      match.accumulatorMs + elapsedMs,
      SIMULATION_DT_MS * MAX_CATCHUP_STEPS,
    );

    let stepped = false;
    while (match.accumulatorMs >= SIMULATION_DT_MS && match.phase === 'PLAYING') {
      match.accumulatorMs -= SIMULATION_DT_MS;
      match.tick += 1;
      stepped = true;

      const result = stepMatchPhysics(match.physics, match.inputs, SIMULATION_DT_SEC);
      if (result.scoredSide) {
        if (result.scoredSide === 'left') {
          match.score.left += 1;
        } else {
          match.score.right += 1;
        }

        if (match.score.left >= WIN_SCORE || match.score.right >= WIN_SCORE) {
          const winnerSide: PaddleSide = match.score.left >= WIN_SCORE ? 'left' : 'right';
          this.finishMatch(match, winnerSide, 'SCORE_LIMIT');
          return;
        }

        // Next serve countdown (serve toward player who was scored on)
        const serveToward: PaddleSide = result.scoredSide === 'left' ? 'right' : 'left';
        resetBallForServe(match.physics, serveToward);
        match.phase = 'COUNTDOWN';
        match.countdownEndsAt = Date.now() + POINT_COUNTDOWN_MS;
        match.countdownEndPerfMs = performance.now() + POINT_COUNTDOWN_MS;
        this.callbacks.onMatchPhase(match, this.getParticipants(match));
        this.callbacks.onMatchSnapshot(match, this.toSnapshot(match));
        return;
      }
    }

    if (stepped) {
      match.snapshotTickCounter += 1;
      if (match.snapshotTickCounter >= SNAPSHOT_INTERVAL_TICKS) {
        match.snapshotTickCounter = 0;
        this.callbacks.onMatchSnapshot(match, this.toSnapshot(match));
      }
    }
  }

  handleInput(
    playerId: string,
    matchId: string,
    direction: PaddleInputDir,
    seq: number,
  ): void {
    const match = this.matches.get(matchId);
    if (!match) {
      throw new MatchError('MATCH_NOT_FOUND', 'Match does not exist.');
    }
    const side: PaddleSide | null =
      match.leftPlayerId === playerId
        ? 'left'
        : match.rightPlayerId === playerId
          ? 'right'
          : null;

    if (!side) {
      throw new MatchError('NOT_MATCH_PARTICIPANT', 'You are not a participant in this match.');
    }

    if (seq <= match.lastSeq[side]) {
      return; // Ignore stale or out-of-order input packet
    }
    match.lastSeq[side] = seq;
    match.inputs[side] = direction;
  }

  handlePlayerDisconnect(playerId: string): void {
    const session = this.sessions.getById(playerId);
    if (!session?.activeMatchId) return;
    const match = this.matches.get(session.activeMatchId);
    if (!match || match.phase === 'CLOSED') return;

    // Clear any existing timer for this player
    const existingTimer = match.disconnectTimers.get(playerId);
    if (existingTimer) clearTimeout(existingTimer);

    if (match.phase === 'FINISHED' || match.phase === 'FORFEITED') {
      // Post-match disconnect: cancel pending rematch and remove if grace expires
      if (match.rematchRequestedBy && !match.rematchCancelled) {
        match.rematchCancelled = true;
        this.callbacks.onMatchRematchUpdated(match, this.getRematchState(match));
      }
      const timer = setTimeout(() => {
        match.disconnectTimers.delete(playerId);
        this.callbacks.onDisconnectGraceExpiredRemovePlayer(playerId);
        this.cleanupIfAbandoned(match);
      }, this.graceMs);
      match.disconnectTimers.set(playerId, timer);
      return;
    }

    // Active match (COUNTDOWN, PLAYING, or already PAUSED_DISCONNECT)
    match.phase = 'PAUSED_DISCONNECT';
    match.disconnectedPlayerId = playerId;
    match.pauseExpiresAt = Date.now() + this.graceMs;
    match.countdownEndsAt = null;
    match.countdownEndPerfMs = null;
    match.inputs = { left: 0, right: 0 };

    this.callbacks.onMatchPhase(match, this.getParticipants(match));
    this.callbacks.onMatchSnapshot(match, this.toSnapshot(match));

    const timer = setTimeout(() => {
      this.handleDisconnectTimeout(match, playerId);
    }, this.graceMs);
    match.disconnectTimers.set(playerId, timer);
  }

  handlePlayerReconnect(playerId: string): void {
    const session = this.sessions.getById(playerId);
    if (!session?.activeMatchId) return;
    const match = this.matches.get(session.activeMatchId);
    if (!match || match.phase === 'CLOSED') return;

    const timer = match.disconnectTimers.get(playerId);
    if (timer) {
      clearTimeout(timer);
      match.disconnectTimers.delete(playerId);
    }

    if (match.phase === 'PAUSED_DISCONNECT') {
      // Check if any OTHER participant is still disconnected
      const otherId =
        match.leftPlayerId === playerId ? match.rightPlayerId : match.leftPlayerId;
      const otherSession = this.sessions.getById(otherId);

      if (otherSession?.connected) {
        match.phase = 'COUNTDOWN';
        match.disconnectedPlayerId = null;
        match.pauseExpiresAt = null;
        match.countdownEndsAt = Date.now() + RESUME_COUNTDOWN_MS;
        match.countdownEndPerfMs = performance.now() + RESUME_COUNTDOWN_MS;
        match.lastStepPerfMs = performance.now();
        this.callbacks.onMatchPhase(match, this.getParticipants(match));
        this.callbacks.onMatchSnapshot(match, this.toSnapshot(match));
      } else {
        // Other player is still disconnected
        match.disconnectedPlayerId = otherId;
        this.callbacks.onMatchPhase(match, this.getParticipants(match));
      }
    }
  }

  private handleDisconnectTimeout(match: MatchRecord, disconnectedPlayerId: string): void {
    match.disconnectTimers.delete(disconnectedPlayerId);
    if (match.phase === 'CLOSED') return;

    const winnerSide: PaddleSide =
      match.leftPlayerId === disconnectedPlayerId ? 'right' : 'left';
    const winnerId = winnerSide === 'left' ? match.leftPlayerId : match.rightPlayerId;
    const winnerSession = this.sessions.getById(winnerId);

    if (match.phase === 'PAUSED_DISCONNECT') {
      this.forfeitMatch(match, winnerSide, 'FORFEIT_DISCONNECT');
    }

    // Remove the timed-out disconnected session and release if both gone
    this.callbacks.onDisconnectGraceExpiredRemovePlayer(disconnectedPlayerId);

    if (!winnerSession || !winnerSession.connected) {
      this.closeMatch(match);
    }
  }

  leaveMatch(playerId: string, matchId: string): void {
    const match = this.matches.get(matchId);
    if (!match) {
      throw new MatchError('MATCH_NOT_FOUND', 'Match does not exist.');
    }
    if (match.leftPlayerId !== playerId && match.rightPlayerId !== playerId) {
      throw new MatchError('NOT_MATCH_PARTICIPANT', 'You are not a participant in this match.');
    }

    if (
      match.phase === 'COUNTDOWN' ||
      match.phase === 'PLAYING' ||
      match.phase === 'PAUSED_DISCONNECT'
    ) {
      const winnerSide: PaddleSide = match.leftPlayerId === playerId ? 'right' : 'left';
      this.forfeitMatch(match, winnerSide, 'FORFEIT_LEAVE');
    }

    this.returnPlayerToLobby(playerId, match);
  }

  returnPlayerToLobby(playerId: string, specificMatch?: MatchRecord): void {
    const session = this.sessions.getById(playerId);
    if (!session) return;

    const matchId = specificMatch?.matchId ?? session.activeMatchId;
    if (matchId) {
      const match = specificMatch ?? this.matches.get(matchId);
      if (match) {
        if (match.phase === 'COUNTDOWN' || match.phase === 'PLAYING' || match.phase === 'PAUSED_DISCONNECT') {
          const winnerSide: PaddleSide = match.leftPlayerId === playerId ? 'right' : 'left';
          this.forfeitMatch(match, winnerSide, 'FORFEIT_LEAVE');
        }
        match.returnedToLobby.add(playerId);
        if (match.rematchRequestedBy && !match.rematchCancelled) {
          match.rematchCancelled = true;
          this.callbacks.onMatchRematchUpdated(match, this.getRematchState(match));
        }
        this.cleanupIfAbandoned(match);
      }
    }

    session.activeMatchId = null;
    if (session.connected) {
      session.status = 'AVAILABLE';
      session.priorStatus = 'AVAILABLE';
    }
    this.callbacks.onPlayerReturnedToLobby(session);
  }

  requestRematch(playerId: string, matchId: string): void {
    const match = this.matches.get(matchId);
    if (!match) {
      throw new MatchError('MATCH_NOT_FOUND', 'Match does not exist.');
    }
    if (match.leftPlayerId !== playerId && match.rightPlayerId !== playerId) {
      throw new MatchError('NOT_MATCH_PARTICIPANT', 'You are not in this match.');
    }
    if (match.phase !== 'FINISHED' && match.phase !== 'FORFEITED') {
      throw new MatchError('INVALID_MATCH_STATE', 'Rematch is only available after a match ends.');
    }
    if (match.rematchCancelled || match.returnedToLobby.size > 0) {
      throw new MatchError('INVALID_MATCH_STATE', 'Opponent has already returned to the lobby.');
    }

    const otherId = match.leftPlayerId === playerId ? match.rightPlayerId : match.leftPlayerId;
    const other = this.sessions.getById(otherId);
    if (!other || !other.connected || other.activeMatchId !== match.matchId) {
      match.rematchCancelled = true;
      this.callbacks.onMatchRematchUpdated(match, this.getRematchState(match));
      throw new MatchError('PLAYER_UNAVAILABLE', 'Opponent is no longer in the match.');
    }

    if (!match.rematchRequestedBy) {
      match.rematchRequestedBy = playerId;
      this.callbacks.onMatchRematchUpdated(match, this.getRematchState(match));
      return;
    }

    if (match.rematchRequestedBy === playerId) {
      return; // Idempotent re-request
    }

    // Other player had already requested -> mutual agreement!
    this.completeRematch(match, playerId);
  }

  acceptRematch(playerId: string, matchId: string): void {
    const match = this.matches.get(matchId);
    if (!match) {
      throw new MatchError('MATCH_NOT_FOUND', 'Match does not exist.');
    }
    if (match.leftPlayerId !== playerId && match.rightPlayerId !== playerId) {
      throw new MatchError('NOT_MATCH_PARTICIPANT', 'You are not in this match.');
    }
    if (match.phase !== 'FINISHED' && match.phase !== 'FORFEITED') {
      throw new MatchError('INVALID_MATCH_STATE', 'Rematch is only available after a match ends.');
    }
    if (!match.rematchRequestedBy || match.rematchRequestedBy === playerId) {
      throw new MatchError('INVALID_MATCH_STATE', 'No incoming rematch request to accept.');
    }
    if (match.rematchCancelled || match.returnedToLobby.size > 0) {
      throw new MatchError('INVALID_MATCH_STATE', 'Rematch request is no longer active.');
    }

    this.completeRematch(match, playerId);
  }

  private completeRematch(oldMatch: MatchRecord, acceptingPlayerId: string): void {
    const left = this.sessions.getById(oldMatch.leftPlayerId);
    const right = this.sessions.getById(oldMatch.rightPlayerId);

    if (!left || !left.connected || !right || !right.connected) {
      oldMatch.rematchCancelled = true;
      this.callbacks.onMatchRematchUpdated(oldMatch, this.getRematchState(oldMatch));
      throw new MatchError('PLAYER_UNAVAILABLE', 'Opponent disconnected.');
    }

    oldMatch.rematchAcceptedBy = acceptingPlayerId;
    this.callbacks.onMatchRematchUpdated(oldMatch, this.getRematchState(oldMatch));

    // Close old match and start a brand new match ID with swapped paddle sides!
    this.closeMatch(oldMatch);
    this.createMatch(right, left);
  }

  private finishMatch(
    match: MatchRecord,
    winnerSide: PaddleSide,
    reason: MatchOutcomeReason,
  ): void {
    this.stopSimulation(match);
    match.phase = 'FINISHED';
    match.countdownEndsAt = null;
    match.countdownEndPerfMs = null;
    match.pauseExpiresAt = null;
    match.disconnectedPlayerId = null;

    const winnerId = winnerSide === 'left' ? match.leftPlayerId : match.rightPlayerId;
    match.winnerPlayerId = winnerId;
    match.outcomeReason = reason;

    const winner = this.sessions.getById(winnerId);
    if (winner) {
      this.callbacks.onMatchPhase(match, this.getParticipants(match));
      this.callbacks.onMatchSnapshot(match, this.toSnapshot(match));
      this.callbacks.onMatchFinished(match, winner, winnerSide, reason);
    }
  }

  private forfeitMatch(
    match: MatchRecord,
    winnerSide: PaddleSide,
    reason: MatchOutcomeReason,
  ): void {
    this.stopSimulation(match);
    match.phase = 'FORFEITED';
    match.countdownEndsAt = null;
    match.countdownEndPerfMs = null;
    match.pauseExpiresAt = null;

    const winnerId = winnerSide === 'left' ? match.leftPlayerId : match.rightPlayerId;
    match.winnerPlayerId = winnerId;
    match.outcomeReason = reason;

    const winner = this.sessions.getById(winnerId);
    if (winner) {
      this.callbacks.onMatchPhase(match, this.getParticipants(match));
      this.callbacks.onMatchSnapshot(match, this.toSnapshot(match));
      this.callbacks.onMatchFinished(match, winner, winnerSide, reason);
    }
  }

  private stopSimulation(match: MatchRecord): void {
    if (match.loopTimer) {
      clearInterval(match.loopTimer);
      match.loopTimer = null;
    }
  }

  private cleanupIfAbandoned(match: MatchRecord): void {
    const left = this.sessions.getById(match.leftPlayerId);
    const right = this.sessions.getById(match.rightPlayerId);
    const leftDone = match.returnedToLobby.has(match.leftPlayerId) || !left;
    const rightDone = match.returnedToLobby.has(match.rightPlayerId) || !right;
    if (leftDone && rightDone) {
      this.closeMatch(match);
    }
  }

  private closeMatch(match: MatchRecord): void {
    this.stopSimulation(match);
    for (const timer of match.disconnectTimers.values()) {
      clearTimeout(timer);
    }
    match.disconnectTimers.clear();
    match.phase = 'CLOSED';
    this.matches.delete(match.matchId);
  }

  clearAll(): void {
    for (const match of this.matches.values()) {
      this.stopSimulation(match);
      for (const timer of match.disconnectTimers.values()) {
        clearTimeout(timer);
      }
      match.disconnectTimers.clear();
    }
    this.matches.clear();
  }
}
