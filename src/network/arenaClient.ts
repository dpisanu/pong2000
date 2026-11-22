import { PROTOCOL_VERSION } from '../../shared/src/constants.ts';
import type { ClientCommand, ServerEvent } from '../../shared/src/protocol.ts';
import type { PlayerProfile } from '../../shared/src/types.ts';

export type ConnectionState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING';

export interface ArenaClientHandlers {
  onConnectionState: (state: ConnectionState) => void;
  onEvent: (event: ServerEvent) => void;
  onLatency?: (pingMs: number | null) => void;
  onTransportError?: (message: string) => void;
}

export class ArenaClient {
  private ws: WebSocket | null = null;
  private profile: PlayerProfile | null = null;
  private recoveryToken: string | undefined;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pendingPings = new Map<string, number>();
  private lastPingMs: number | null = null;
  private manuallyClosed = false;
  private requestCounter = 0;
  private readonly handlers: ArenaClientHandlers;

  constructor(handlers: ArenaClientHandlers) {
    this.handlers = handlers;
  }

  private nextRequestId(): string {
    this.requestCounter += 1;
    return `req-${Date.now().toString(36)}-${this.requestCounter}`;
  }

  private getWsUrl(): string {
    const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${scheme}//${window.location.host}/ws`;
  }

  connect(profile: PlayerProfile, recoveryToken?: string): void {
    this.profile = profile;
    this.recoveryToken = recoveryToken;
    this.manuallyClosed = false;
    this.clearReconnectTimer();
    this.openSocket(false);
  }

  updateSessionCredentials(profile: PlayerProfile, recoveryToken: string): void {
    this.profile = profile;
    this.recoveryToken = recoveryToken;
  }

  disconnect(): void {
    this.manuallyClosed = true;
    this.clearReconnectTimer();
    this.stopPingLoop();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this.handlers.onConnectionState('DISCONNECTED');
    this.handlers.onLatency?.(null);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startPingLoop(): void {
    this.stopPingLoop();
    this.sendPing();
    this.pingTimer = setInterval(() => {
      this.sendPing();
    }, 2000);
  }

  private stopPingLoop(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.pendingPings.clear();
    this.lastPingMs = null;
  }

  private sendPing(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const nowPerf = performance.now();
    // Prune any unanswered pings older than 15s
    for (const [id, sentAt] of this.pendingPings.entries()) {
      if (nowPerf - sentAt > 15_000) {
        this.pendingPings.delete(id);
      }
    }
    const requestId = this.nextRequestId();
    this.pendingPings.set(requestId, nowPerf);
    this.send({
      type: 'ping',
      requestId,
      payload: {
        clientTime: Date.now(),
        ...(this.lastPingMs !== null ? { lastPingMs: this.lastPingMs } : {}),
      },
    });
  }

  private openSocket(isReconnect: boolean): void {
    if (!this.profile) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      this.ws.close();
    }

    this.handlers.onConnectionState(isReconnect ? 'RECONNECTING' : 'CONNECTING');
    const ws = new WebSocket(this.getWsUrl());
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.handlers.onConnectionState('CONNECTED');
      if (this.profile) {
        this.send({
          type: 'session.hello',
          requestId: this.nextRequestId(),
          payload: {
            protocolVersion: PROTOCOL_VERSION,
            profile: this.profile,
            recoveryToken: this.recoveryToken,
          },
        });
      }
      this.startPingLoop();
    };

    ws.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(String(msg.data)) as ServerEvent;
        if (parsed.type === 'pong') {
          const sentPerf = this.pendingPings.get(parsed.requestId);
          if (sentPerf !== undefined) {
            this.pendingPings.delete(parsed.requestId);
            const rttMs = Math.max(0, Math.round(performance.now() - sentPerf));
            const wasNull = this.lastPingMs === null;
            this.lastPingMs = rttMs;
            this.handlers.onLatency?.(rttMs);
            if (wasNull) {
              this.sendPing();
            }
          }
          return;
        }
        this.handlers.onEvent(parsed);
      } catch {
        this.handlers.onTransportError?.('Received malformed message from server.');
      }
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopPingLoop();
      this.handlers.onLatency?.(null);
      if (this.manuallyClosed) {
        this.handlers.onConnectionState('DISCONNECTED');
        return;
      }
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      // Close handler schedules reconnect
    };
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    this.handlers.onConnectionState('RECONNECTING');
    const delayMs = Math.min(8000, 500 * Math.pow(2, this.reconnectAttempt));
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.openSocket(true);
    }, delayMs);
  }

  private send(command: ClientCommand): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    this.ws.send(JSON.stringify(command));
    return true;
  }

  updateProfile(profile: PlayerProfile): string | null {
    this.profile = profile;
    const requestId = this.nextRequestId();
    const sent = this.send({
      type: 'profile.update',
      requestId,
      payload: profile,
    });
    return sent ? requestId : null;
  }

  createChallenge(targetPlayerId: string): boolean {
    return this.send({
      type: 'challenge.create',
      requestId: this.nextRequestId(),
      payload: { targetPlayerId },
    });
  }

  acceptChallenge(challengeId: string): boolean {
    return this.send({
      type: 'challenge.accept',
      requestId: this.nextRequestId(),
      payload: { challengeId },
    });
  }

  declineChallenge(challengeId: string): boolean {
    return this.send({
      type: 'challenge.decline',
      requestId: this.nextRequestId(),
      payload: { challengeId },
    });
  }

  cancelChallenge(challengeId: string): boolean {
    return this.send({
      type: 'challenge.cancel',
      requestId: this.nextRequestId(),
      payload: { challengeId },
    });
  }

  sendMatchInput(matchId: string, direction: -1 | 0 | 1, seq: number): boolean {
    return this.send({
      type: 'match.input',
      requestId: this.nextRequestId(),
      payload: { matchId, direction, seq },
    });
  }

  leaveMatch(matchId: string): boolean {
    return this.send({
      type: 'match.leave',
      requestId: this.nextRequestId(),
      payload: { matchId },
    });
  }

  requestRematch(matchId: string): boolean {
    return this.send({
      type: 'match.rematch.request',
      requestId: this.nextRequestId(),
      payload: { matchId },
    });
  }

  acceptRematch(matchId: string): boolean {
    return this.send({
      type: 'match.rematch.accept',
      requestId: this.nextRequestId(),
      payload: { matchId },
    });
  }

  returnToLobby(): boolean {
    return this.send({
      type: 'lobby.join',
      requestId: this.nextRequestId(),
      payload: {},
    });
  }
}

export async function uploadAvatarFile(
  file: File,
  uploadToken: string,
): Promise<{ avatarId: string; avatarUrl: string }> {
  const response = await fetch('/api/avatars', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${uploadToken}`,
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: file,
  });

  const data = (await response.json().catch(() => ({}))) as {
    avatarId?: string;
    avatarUrl?: string;
    error?: string;
  };

  if (!response.ok || !data.avatarId || !data.avatarUrl) {
    throw new Error(data.error || 'Avatar upload failed.');
  }

  return {
    avatarId: data.avatarId,
    avatarUrl: data.avatarUrl,
  };
}
