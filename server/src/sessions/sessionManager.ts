import crypto from 'node:crypto';
import type { LobbyPlayer, PlayerStatus } from '../../../shared/src/types.ts';

export interface PlayerSession {
  playerId: string;
  recoveryToken: string;
  uploadToken: string;
  nickname: string;
  avatarId: string;
  avatarUrl: string;
  status: PlayerStatus;
  priorStatus: 'AVAILABLE' | 'INVITED' | 'IN_GAME';
  activeChallengeId: string | null;
  activeMatchId: string | null;
  connected: boolean;
  socketId: string | null;
  disconnectExpiryTimer: ReturnType<typeof setTimeout> | null;
  createdAt: number;
}

export class SessionManager {
  private readonly sessions = new Map<string, PlayerSession>();
  private readonly recoveryIndex = new Map<string, string>();
  private readonly uploadTokenIndex = new Map<string, string>();

  private generateToken(): string {
    return crypto.randomBytes(24).toString('base64url');
  }

  private generatePlayerId(): string {
    return `pl_${crypto.randomBytes(8).toString('hex')}`;
  }

  createSession(params: {
    nickname: string;
    avatarId: string;
    avatarUrl: string;
    socketId: string;
  }): PlayerSession {
    const playerId = this.generatePlayerId();
    const recoveryToken = this.generateToken();
    const uploadToken = this.generateToken();

    const session: PlayerSession = {
      playerId,
      recoveryToken,
      uploadToken,
      nickname: params.nickname,
      avatarId: params.avatarId,
      avatarUrl: params.avatarUrl,
      status: 'AVAILABLE',
      priorStatus: 'AVAILABLE',
      activeChallengeId: null,
      activeMatchId: null,
      connected: true,
      socketId: params.socketId,
      disconnectExpiryTimer: null,
      createdAt: Date.now(),
    };

    this.sessions.set(playerId, session);
    this.recoveryIndex.set(recoveryToken, playerId);
    this.uploadTokenIndex.set(uploadToken, playerId);
    return session;
  }

  recoverSession(params: {
    recoveryToken: string;
    nickname: string;
    avatarId: string;
    avatarUrl: string;
    socketId: string;
  }): PlayerSession | null {
    const playerId = this.recoveryIndex.get(params.recoveryToken);
    if (!playerId) return null;

    const session = this.sessions.get(playerId);
    if (!session) {
      this.recoveryIndex.delete(params.recoveryToken);
      return null;
    }

    // Clear pending removal timer if any
    if (session.disconnectExpiryTimer) {
      clearTimeout(session.disconnectExpiryTimer);
      session.disconnectExpiryTimer = null;
    }

    // Rotate recovery and upload tokens on recovery
    this.recoveryIndex.delete(session.recoveryToken);
    this.uploadTokenIndex.delete(session.uploadToken);

    session.recoveryToken = this.generateToken();
    session.uploadToken = this.generateToken();
    this.recoveryIndex.set(session.recoveryToken, session.playerId);
    this.uploadTokenIndex.set(session.uploadToken, session.playerId);

    session.nickname = params.nickname;
    session.avatarId = params.avatarId;
    session.avatarUrl = params.avatarUrl;
    session.connected = true;
    session.socketId = params.socketId;

    if (session.activeMatchId) {
      session.status = 'IN_GAME';
      session.priorStatus = 'IN_GAME';
    } else {
      session.status = 'AVAILABLE';
      session.priorStatus = 'AVAILABLE';
      session.activeChallengeId = null;
    }

    return session;
  }

  getById(playerId: string): PlayerSession | undefined {
    return this.sessions.get(playerId);
  }

  findByRecoveryToken(token: string): PlayerSession | undefined {
    const playerId = this.recoveryIndex.get(token);
    if (!playerId) return undefined;
    return this.sessions.get(playerId);
  }

  getByUploadToken(token: string): PlayerSession | undefined {
    const playerId = this.uploadTokenIndex.get(token);
    if (!playerId) return undefined;
    return this.sessions.get(playerId);
  }

  isNicknameAvailable(nickname: string, excludePlayerId?: string): boolean {
    const normalized = nickname.trim().toLowerCase();
    for (const session of this.sessions.values()) {
      if (excludePlayerId && session.playerId === excludePlayerId) {
        continue;
      }
      if (session.nickname.trim().toLowerCase() === normalized) {
        return false;
      }
    }
    return true;
  }

  markDisconnected(playerId: string): PlayerSession | undefined {
    const session = this.sessions.get(playerId);
    if (!session) return undefined;
    if (session.status !== 'DISCONNECTED') {
      session.priorStatus =
        session.status === 'IN_GAME'
          ? 'IN_GAME'
          : session.status === 'INVITED'
            ? 'INVITED'
            : 'AVAILABLE';
    }
    session.connected = false;
    session.socketId = null;
    session.status = 'DISCONNECTED';
    return session;
  }

  removeSession(playerId: string): boolean {
    const session = this.sessions.get(playerId);
    if (!session) return false;
    if (session.disconnectExpiryTimer) {
      clearTimeout(session.disconnectExpiryTimer);
      session.disconnectExpiryTimer = null;
    }
    this.recoveryIndex.delete(session.recoveryToken);
    this.uploadTokenIndex.delete(session.uploadToken);
    this.sessions.delete(playerId);
    return true;
  }

  toLobbyPlayer(session: PlayerSession): LobbyPlayer {
    return {
      playerId: session.playerId,
      nickname: session.nickname,
      avatarId: session.avatarId,
      avatarUrl: session.avatarUrl,
      status: session.status,
    };
  }

  getLobbySnapshot(): LobbyPlayer[] {
    const list: LobbyPlayer[] = [];
    for (const session of this.sessions.values()) {
      list.push(this.toLobbyPlayer(session));
    }
    return list;
  }

  getAllSessions(): PlayerSession[] {
    return Array.from(this.sessions.values());
  }

  clearAll(): void {
    for (const session of this.sessions.values()) {
      if (session.disconnectExpiryTimer) {
        clearTimeout(session.disconnectExpiryTimer);
      }
    }
    this.sessions.clear();
    this.recoveryIndex.clear();
    this.uploadTokenIndex.clear();
  }
}
