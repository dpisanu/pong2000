import crypto from 'node:crypto';
import { CHALLENGE_EXPIRY_MS } from '../../../shared/src/constants.ts';
import type { ChallengeInfo, ChallengeStatus, ErrorCode } from '../../../shared/src/types.ts';
import type { PlayerSession, SessionManager } from '../sessions/sessionManager.ts';

export interface ChallengeRecord {
  challengeId: string;
  fromPlayerId: string;
  toPlayerId: string;
  status: ChallengeStatus;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  botAcceptTimer: ReturnType<typeof setTimeout> | null;
  isBotTarget: boolean;
}

export interface ChallengeCallbacks {
  onChallengeCreated: (challenge: ChallengeInfo, affectedPlayers: PlayerSession[]) => void;
  onChallengeUpdated: (challenge: ChallengeInfo, affectedPlayers: PlayerSession[]) => void;
  onChallengeAcceptedStartMatch: (fromPlayer: PlayerSession, toPlayer: PlayerSession) => void;
}

export class ChallengeError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export class ChallengeManager {
  private readonly challenges = new Map<string, ChallengeRecord>();
  private readonly sessions: SessionManager;
  private readonly callbacks: ChallengeCallbacks;
  private expiryMs: number;

  constructor(
    sessions: SessionManager,
    callbacks: ChallengeCallbacks,
    expiryMs: number = CHALLENGE_EXPIRY_MS,
  ) {
    this.sessions = sessions;
    this.callbacks = callbacks;
    this.expiryMs = expiryMs;
  }

  setExpiryMs(expiryMs: number): void {
    this.expiryMs = expiryMs;
  }

  private toInfo(record: ChallengeRecord, reason?: string): ChallengeInfo {
    const from = this.sessions.getById(record.fromPlayerId);
    const to = this.sessions.getById(record.toPlayerId);
    return {
      challengeId: record.challengeId,
      fromPlayerId: record.fromPlayerId,
      fromNickname: from?.nickname ?? 'Player',
      fromAvatarUrl: from?.avatarUrl ?? '/avatars/default.svg',
      toPlayerId: record.toPlayerId,
      toNickname: to?.nickname ?? 'Player',
      toAvatarUrl: to?.avatarUrl ?? '/avatars/default.svg',
      status: record.status,
      expiresAt: record.expiresAt,
      reason,
    };
  }

  getActiveForPlayer(playerId: string): ChallengeInfo | null {
    const session = this.sessions.getById(playerId);
    if (!session?.activeChallengeId) return null;
    const record = this.challenges.get(session.activeChallengeId);
    if (!record || record.status !== 'PENDING') return null;
    return this.toInfo(record);
  }

  createChallenge(fromPlayerId: string, targetPlayerId: string): ChallengeInfo {
    if (fromPlayerId === targetPlayerId) {
      throw new ChallengeError('SELF_CHALLENGE', 'You cannot challenge yourself.');
    }

    const from = this.sessions.getById(fromPlayerId);
    const target = this.sessions.getById(targetPlayerId);

    if (!from || !from.connected) {
      throw new ChallengeError('UNAUTHORIZED', 'Active player session required.');
    }
    if (!target || !target.connected) {
      throw new ChallengeError('PLAYER_NOT_FOUND', 'That player is not currently online.');
    }
    if (from.status !== 'AVAILABLE' || from.activeChallengeId || from.activeMatchId) {
      throw new ChallengeError('ALREADY_BUSY', 'Finish or cancel your current activity first.');
    }

    const isBotTarget = Boolean(target.isBot);
    if (
      !isBotTarget &&
      (target.status !== 'AVAILABLE' || target.activeChallengeId || target.activeMatchId)
    ) {
      throw new ChallengeError('PLAYER_UNAVAILABLE', `${target.nickname} is currently unavailable.`);
    }

    const challengeId = `ch_${crypto.randomBytes(8).toString('hex')}`;
    const expiresAt = Date.now() + this.expiryMs;

    // Atomic reservation
    from.status = 'INVITED';
    from.priorStatus = 'INVITED';
    from.activeChallengeId = challengeId;

    if (!isBotTarget) {
      target.status = 'INVITED';
      target.priorStatus = 'INVITED';
      target.activeChallengeId = challengeId;
    }

    const record: ChallengeRecord = {
      challengeId,
      fromPlayerId,
      toPlayerId: targetPlayerId,
      status: 'PENDING',
      expiresAt,
      timer: setTimeout(() => {
        this.expireChallenge(challengeId);
      }, this.expiryMs),
      botAcceptTimer: null,
      isBotTarget,
    };

    this.challenges.set(challengeId, record);

    const info = this.toInfo(record);
    this.callbacks.onChallengeCreated(info, isBotTarget ? [from] : [from, target]);

    if (isBotTarget) {
      record.botAcceptTimer = setTimeout(() => {
        record.botAcceptTimer = null;
        this.autoAcceptBotChallenge(challengeId);
      }, 60);
    }

    return info;
  }

  private autoAcceptBotChallenge(challengeId: string): void {
    const record = this.challenges.get(challengeId);
    if (!record || record.status !== 'PENDING') return;

    const from = this.sessions.getById(record.fromPlayerId);
    const to = this.sessions.getById(record.toPlayerId);
    if (!from || !from.connected || !to || from.activeChallengeId !== challengeId) {
      this.finalizeTerminal(record, 'INVALIDATED', 'Participant unavailable');
      return;
    }

    if (record.timer) {
      clearTimeout(record.timer);
      record.timer = null;
    }

    record.status = 'MATCH_CREATED';
    from.activeChallengeId = null;

    const info = this.toInfo(record);
    this.callbacks.onChallengeUpdated(info, [from]);
    this.callbacks.onChallengeAcceptedStartMatch(from, to);
    this.challenges.delete(challengeId);
  }

  acceptChallenge(actorPlayerId: string, challengeId: string): ChallengeInfo {
    const record = this.challenges.get(challengeId);
    if (!record) {
      throw new ChallengeError('CHALLENGE_NOT_FOUND', 'Challenge no longer exists.');
    }
    if (record.status !== 'PENDING') {
      throw new ChallengeError('CHALLENGE_CLOSED', 'Challenge is no longer pending.');
    }
    if (record.toPlayerId !== actorPlayerId) {
      throw new ChallengeError('UNAUTHORIZED', 'Only the invited player can accept this challenge.');
    }

    const from = this.sessions.getById(record.fromPlayerId);
    const to = this.sessions.getById(record.toPlayerId);
    if (!from || !from.connected || !to || !to.connected) {
      this.finalizeTerminal(record, 'INVALIDATED', 'Participant disconnected');
      throw new ChallengeError('PLAYER_UNAVAILABLE', 'The challenger is no longer connected.');
    }
    if (from.activeChallengeId !== challengeId || to.activeChallengeId !== challengeId) {
      this.finalizeTerminal(record, 'INVALIDATED', 'Challenge state mismatch');
      throw new ChallengeError('CHALLENGE_CLOSED', 'Challenge is no longer valid.');
    }

    if (record.timer) {
      clearTimeout(record.timer);
      record.timer = null;
    }
    if (record.botAcceptTimer) {
      clearTimeout(record.botAcceptTimer);
      record.botAcceptTimer = null;
    }

    record.status = 'MATCH_CREATED';
    from.activeChallengeId = null;
    to.activeChallengeId = null;

    const info = this.toInfo(record);
    this.callbacks.onChallengeUpdated(info, [from, to]);
    this.callbacks.onChallengeAcceptedStartMatch(from, to);
    this.challenges.delete(challengeId);
    return info;
  }

  declineChallenge(actorPlayerId: string, challengeId: string): ChallengeInfo {
    const record = this.challenges.get(challengeId);
    if (!record) {
      throw new ChallengeError('CHALLENGE_NOT_FOUND', 'Challenge no longer exists.');
    }
    if (record.status !== 'PENDING') {
      throw new ChallengeError('CHALLENGE_CLOSED', 'Challenge is already closed.');
    }
    if (record.toPlayerId !== actorPlayerId) {
      throw new ChallengeError('UNAUTHORIZED', 'Only the invited player can decline this challenge.');
    }

    return this.finalizeTerminal(record, 'DECLINED', 'Declined by opponent');
  }

  cancelChallenge(actorPlayerId: string, challengeId: string): ChallengeInfo {
    const record = this.challenges.get(challengeId);
    if (!record) {
      throw new ChallengeError('CHALLENGE_NOT_FOUND', 'Challenge no longer exists.');
    }
    if (record.status !== 'PENDING') {
      throw new ChallengeError('CHALLENGE_CLOSED', 'Challenge is already closed.');
    }
    if (record.fromPlayerId !== actorPlayerId) {
      throw new ChallengeError('UNAUTHORIZED', 'Only the challenger can cancel this invitation.');
    }

    return this.finalizeTerminal(record, 'CANCELLED', 'Cancelled by challenger');
  }

  expireChallenge(challengeId: string): void {
    const record = this.challenges.get(challengeId);
    if (!record || record.status !== 'PENDING') return;
    this.finalizeTerminal(record, 'EXPIRED', 'Invitation timed out');
  }

  invalidateForPlayer(playerId: string, reason = 'Participant disconnected'): void {
    const session = this.sessions.getById(playerId);
    const challengeId = session?.activeChallengeId;
    if (!challengeId) return;

    const record = this.challenges.get(challengeId);
    if (!record || record.status !== 'PENDING') {
      if (session) session.activeChallengeId = null;
      return;
    }
    this.finalizeTerminal(record, 'INVALIDATED', reason);
  }

  private finalizeTerminal(
    record: ChallengeRecord,
    status: ChallengeStatus,
    reason?: string,
  ): ChallengeInfo {
    if (record.timer) {
      clearTimeout(record.timer);
      record.timer = null;
    }
    if (record.botAcceptTimer) {
      clearTimeout(record.botAcceptTimer);
      record.botAcceptTimer = null;
    }
    record.status = status;

    const affected: PlayerSession[] = [];
    const from = this.sessions.getById(record.fromPlayerId);
    const to = record.isBotTarget ? undefined : this.sessions.getById(record.toPlayerId);

    for (const p of [from, to]) {
      if (!p) continue;
      if (p.activeChallengeId === record.challengeId) {
        p.activeChallengeId = null;
      }
      if (p.connected && !p.activeMatchId) {
        p.status = 'AVAILABLE';
        p.priorStatus = 'AVAILABLE';
      }
      affected.push(p);
    }

    const info = this.toInfo(record, reason);
    this.callbacks.onChallengeUpdated(info, affected);
    this.challenges.delete(record.challengeId);
    return info;
  }

  clearAll(): void {
    for (const record of this.challenges.values()) {
      if (record.timer) clearTimeout(record.timer);
      if (record.botAcceptTimer) clearTimeout(record.botAcceptTimer);
    }
    this.challenges.clear();
  }
}
