import crypto from 'node:crypto';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import {
  DEFAULT_AVATAR_ID,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  MAX_WS_PAYLOAD_BYTES,
  PROTOCOL_VERSION,
} from '../../shared/constants.ts';
import { ClientCommandSchema, type ServerEvent } from '../../shared/protocol.ts';
import type { ErrorCode } from '../../shared/types.ts';
import {
  extractUploadedAvatarKey,
  isValidAvatarId,
  normalizeDemoModePreference,
  resolveAvatarUrl,
  sanitizeNickname,
} from '../../shared/validation.ts';
import { AvatarService } from '../avatars/avatarService.ts';
import { ChallengeError, ChallengeManager } from '../challenges/challengeManager.ts';
import { ServerConfigService } from '../config/serverConfig.ts';
import { LeaderboardService } from '../leaderboard/leaderboardService.ts';
import { MatchError, MatchManager } from '../matches/matchManager.ts';
import { SessionManager, type PlayerSession } from '../sessions/sessionManager.ts';

interface SocketState {
  socketId: string;
  ws: WebSocket;
  playerId: string | null;
  isAlive: boolean;
  lastPongAt: number;
  lastWsPingSentPerfMs: number | null;
  commandTimestamps: number[];
  inputTimestamps: number[];
  recentRequestIds: string[];
}

export interface WsGatewayOptions {
  server: HttpServer;
  sessions: SessionManager;
  avatarService: AvatarService;
  configService?: ServerConfigService;
  leaderboard?: LeaderboardService;
  allowedOrigins?: string[];
  challengeExpiryMs?: number;
  disconnectGraceMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
}

export function isOriginAllowed(
  req: IncomingMessage,
  extraAllowedOrigins: string[] = [],
): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // Non-browser clients / curl / test clients

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return false;
  }

  if (extraAllowedOrigins.includes(origin)) {
    return true;
  }

  const forwardedHost = req.headers['x-forwarded-host'];
  const hostHeader = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) ?? req.headers.host;
  if (!hostHeader) return false;

  return parsedOrigin.host.toLowerCase() === hostHeader.toLowerCase();
}

export class WsGateway {
  readonly wss: WebSocketServer;
  readonly sessions: SessionManager;
  readonly challenges: ChallengeManager;
  readonly matches: MatchManager;
  readonly configService: ServerConfigService;
  readonly leaderboard: LeaderboardService;
  private readonly avatarService: AvatarService;
  private readonly socketsById = new Map<string, SocketState>();
  private readonly socketsByPlayerId = new Map<string, SocketState>();
  private readonly heartbeatTimer: ReturnType<typeof setInterval>;
  private readonly lobbyDisconnectGraceMs = 3_000;
  private readonly heartbeatTimeoutMs: number;
  private readonly allowedOrigins: string[];

  constructor(options: WsGatewayOptions) {
    this.sessions = options.sessions;
    this.avatarService = options.avatarService;
    this.configService = options.configService ?? new ServerConfigService();
    this.leaderboard = options.leaderboard ?? new LeaderboardService();
    this.allowedOrigins = options.allowedOrigins ?? [];
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? HEARTBEAT_TIMEOUT_MS;
    const initialCfg = this.configService.getConfig();

    this.challenges = new ChallengeManager(
      this.sessions,
      {
        onChallengeCreated: (challenge, affectedPlayers) => {
          for (const player of affectedPlayers) {
            if (player.isBot) continue;
            this.sendToPlayer(player.playerId, {
              type: 'challenge.received',
              protocolVersion: PROTOCOL_VERSION,
              serverTime: Date.now(),
              payload: { challenge },
            });
            this.broadcastLobbyUpsert(player);
          }
        },
        onChallengeUpdated: (challenge, affectedPlayers) => {
          for (const player of affectedPlayers) {
            if (player.isBot) continue;
            this.sendToPlayer(player.playerId, {
              type: 'challenge.updated',
              protocolVersion: PROTOCOL_VERSION,
              serverTime: Date.now(),
              payload: { challenge },
            });
            this.broadcastLobbyUpsert(player);
          }
        },
        onChallengeAcceptedStartMatch: (from, to) => {
          this.matches.createMatch(from, to);
          if (!from.isBot) this.broadcastLobbyUpsert(from);
          if (!to.isBot) this.broadcastLobbyUpsert(to);
        },
      },
      options.challengeExpiryMs ?? initialCfg.challengeExpiryMs,
    );

    this.matches = new MatchManager(
      this.sessions,
      {
        onMatchStarted: (matchId, left, right, snapshot, participants, rules) => {
          if (!left.isBot) {
            this.sendToPlayer(left.playerId, {
              type: 'match.started',
              protocolVersion: PROTOCOL_VERSION,
              serverTime: Date.now(),
              payload: { matchId, yourSide: 'left', participants, snapshot, rules },
            });
            this.broadcastLobbyUpsert(left);
          }
          if (!right.isBot) {
            this.sendToPlayer(right.playerId, {
              type: 'match.started',
              protocolVersion: PROTOCOL_VERSION,
              serverTime: Date.now(),
              payload: { matchId, yourSide: 'right', participants, snapshot, rules },
            });
            this.broadcastLobbyUpsert(right);
          }
        },
        onMatchSnapshot: (match, snapshot) => {
          const event: ServerEvent = {
            type: 'match.snapshot',
            protocolVersion: PROTOCOL_VERSION,
            serverTime: Date.now(),
            payload: snapshot,
          };
          this.sendToPlayer(match.leftPlayerId, event);
          this.sendToPlayer(match.rightPlayerId, event);
        },
        onMatchPhase: (match, participants) => {
          const event: ServerEvent = {
            type: 'match.phase',
            protocolVersion: PROTOCOL_VERSION,
            serverTime: Date.now(),
            payload: {
              matchId: match.matchId,
              phase: match.phase,
              countdownEndsAt: match.countdownEndsAt,
              pausedReason:
                match.phase === 'PAUSED_DISCONNECT'
                  ? 'Opponent disconnected. Waiting for reconnect.'
                  : null,
              pauseExpiresAt: match.pauseExpiresAt,
              disconnectedPlayerId: match.disconnectedPlayerId,
              participants,
            },
          };
          this.sendToPlayer(match.leftPlayerId, event);
          this.sendToPlayer(match.rightPlayerId, event);
        },
        onMatchFinished: (match, winner, winnerSide, reason, durationMs) => {
          const loserId =
            winner.playerId === match.leftPlayerId ? match.rightPlayerId : match.leftPlayerId;
          const winnerSideStats =
            winner.playerId === match.leftPlayerId ? match.pingStats.left : match.pingStats.right;
          const loserSideStats =
            loserId === match.leftPlayerId ? match.pingStats.left : match.pingStats.right;
          this.leaderboard.recordMatchResult({
            winnerId: winner.playerId,
            loserId,
            durationMs,
            reason,
            winnerPingRange:
              winnerSideStats.minPingMs !== null && winnerSideStats.maxPingMs !== null
                ? { minMs: winnerSideStats.minPingMs, maxMs: winnerSideStats.maxPingMs }
                : undefined,
            loserPingRange:
              loserSideStats.minPingMs !== null && loserSideStats.maxPingMs !== null
                ? { minMs: loserSideStats.minPingMs, maxMs: loserSideStats.maxPingMs }
                : undefined,
          });
          this.broadcastLeaderboard();

          const event: ServerEvent = {
            type: 'match.finished',
            protocolVersion: PROTOCOL_VERSION,
            serverTime: Date.now(),
            payload: {
              matchId: match.matchId,
              winnerPlayerId: winner.playerId,
              winnerNickname: winner.nickname,
              winnerSide,
              reason,
              finalScore: {
                left: match.score.left,
                right: match.score.right,
              },
            },
          };
          this.sendToPlayer(match.leftPlayerId, event);
          this.sendToPlayer(match.rightPlayerId, event);
        },
        onMatchRematchUpdated: (match, state) => {
          const event: ServerEvent = {
            type: 'match.rematch.updated',
            protocolVersion: PROTOCOL_VERSION,
            serverTime: Date.now(),
            payload: state,
          };
          this.sendToPlayer(match.leftPlayerId, event);
          this.sendToPlayer(match.rightPlayerId, event);
        },
        onPlayerReturnedToLobby: (player) => {
          if (this.sessions.getById(player.playerId)) {
            this.broadcastLobbyUpsert(player);
          }
        },
        onDisconnectGraceExpiredRemovePlayer: (playerId) => {
          if (this.sessions.removeSession(playerId)) {
            this.avatarService.releaseSessionTracking(playerId);
            this.broadcastLobbyRemove(playerId);
          }
        },
      },
      options.disconnectGraceMs ?? initialCfg.disconnectGraceMs,
      this.configService,
    );

    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: MAX_WS_PAYLOAD_BYTES,
    });

    options.server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const urlPath = (req.url ?? '').split('?')[0];
      if (urlPath !== '/ws') {
        socket.destroy();
        return;
      }
      if (!isOriginAllowed(req, this.allowedOrigins)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit('connection', ws, req);
      });
    });

    this.wss.on('connection', (ws) => {
      this.handleConnection(ws);
    });

    const intervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      for (const state of this.socketsById.values()) {
        if (!state.isAlive || now - state.lastPongAt > this.heartbeatTimeoutMs) {
          state.ws.terminate();
          continue;
        }
        state.isAlive = false;
        state.lastWsPingSentPerfMs = performance.now();
        try {
          state.ws.ping();
        } catch {
          state.ws.terminate();
        }
      }
    }, intervalMs);
  }

  private handleConnection(ws: WebSocket): void {
    const socketId = `sk_${crypto.randomBytes(8).toString('hex')}`;
    const state: SocketState = {
      socketId,
      ws,
      playerId: null,
      isAlive: true,
      lastPongAt: Date.now(),
      lastWsPingSentPerfMs: null,
      commandTimestamps: [],
      inputTimestamps: [],
      recentRequestIds: [],
    };
    this.socketsById.set(socketId, state);

    ws.on('pong', () => {
      state.isAlive = true;
      state.lastPongAt = Date.now();
      if (state.lastWsPingSentPerfMs !== null && state.playerId) {
        const measured = Math.max(0, Math.round(performance.now() - state.lastWsPingSentPerfMs));
        state.lastWsPingSentPerfMs = null;
        const session = this.sessions.getById(state.playerId);
        if (session && session.pingMs === null) {
          session.pingMs = measured;
          this.matches.recordPingSample(session.playerId, measured);
          this.broadcastLobbyUpsert(session);
        }
      }
    });

    ws.on('message', (data, isBinary) => {
      state.isAlive = true;
      state.lastPongAt = Date.now();
      if (isBinary) {
        this.sendError(ws, undefined, 'INVALID_MESSAGE', 'Binary frames are not supported.');
        return;
      }
      void this.handleRawMessage(state, data.toString('utf8'));
    });

    ws.on('close', () => {
      this.handleDisconnect(state);
    });

    ws.on('error', () => {
      this.handleDisconnect(state);
    });
  }

  private checkRateLimit(state: SocketState, isInput: boolean): boolean {
    const now = Date.now();
    if (isInput) {
      state.inputTimestamps = state.inputTimestamps.filter((t) => now - t < 1000);
      if (state.inputTimestamps.length >= 150) return false;
      state.inputTimestamps.push(now);
      return true;
    }
    state.commandTimestamps = state.commandTimestamps.filter((t) => now - t < 2000);
    if (state.commandTimestamps.length >= 30) return false;
    state.commandTimestamps.push(now);
    return true;
  }

  private async resolveValidatedAvatar(
    avatarId: string,
  ): Promise<{ avatarId: string; avatarUrl: string }> {
    if (!isValidAvatarId(avatarId)) {
      return {
        avatarId: DEFAULT_AVATAR_ID,
        avatarUrl: resolveAvatarUrl(DEFAULT_AVATAR_ID),
      };
    }
    const uploadedKey = extractUploadedAvatarKey(avatarId);
    if (uploadedKey) {
      const exists = await this.avatarService.avatarExists(uploadedKey);
      if (!exists) {
        return {
          avatarId: DEFAULT_AVATAR_ID,
          avatarUrl: resolveAvatarUrl(DEFAULT_AVATAR_ID),
        };
      }
    }
    return {
      avatarId,
      avatarUrl: resolveAvatarUrl(avatarId),
    };
  }

  private async handleRawMessage(state: SocketState, rawText: string): Promise<void> {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawText);
    } catch {
      this.sendError(state.ws, undefined, 'INVALID_MESSAGE', 'Malformed JSON payload.');
      return;
    }

    const result = ClientCommandSchema.safeParse(parsedJson);
    if (!result.success) {
      const maybeReqId =
        typeof parsedJson === 'object' &&
        parsedJson !== null &&
        'requestId' in parsedJson &&
        typeof (parsedJson as { requestId: unknown }).requestId === 'string'
          ? (parsedJson as { requestId: string }).requestId
          : undefined;
      this.sendError(state.ws, maybeReqId, 'INVALID_MESSAGE', 'Invalid command schema.');
      return;
    }

    const cmd = result.data;
    const isInput = cmd.type === 'match.input';
    if (!this.checkRateLimit(state, isInput)) {
      this.sendError(state.ws, cmd.requestId, 'RATE_LIMITED', 'Too many requests.', cmd.type);
      return;
    }

    if (cmd.type === 'ping') {
      if (state.playerId && typeof cmd.payload.lastPingMs === 'number') {
        const roundedPing = Math.max(0, Math.round(cmd.payload.lastPingMs));
        const sess = this.sessions.getById(state.playerId);
        if (sess) {
          const changed = sess.pingMs !== roundedPing;
          sess.pingMs = roundedPing;
          this.matches.recordPingSample(state.playerId, roundedPing);
          if (changed) {
            this.broadcastLobbyUpsert(sess);
          }
        }
      }
      this.send(state.ws, {
        type: 'pong',
        protocolVersion: PROTOCOL_VERSION,
        serverTime: Date.now(),
        requestId: cmd.requestId,
        payload: { clientTime: cmd.payload.clientTime },
      });
      return;
    }

    if (cmd.type === 'session.hello') {
      await this.handleSessionHello(state, cmd);
      return;
    }

    if (!state.playerId) {
      this.sendError(
        state.ws,
        cmd.requestId,
        'UNAUTHORIZED',
        'Session handshake (session.hello) required first.',
        cmd.type,
      );
      return;
    }

    const session = this.sessions.getById(state.playerId);
    if (!session) {
      this.sendError(state.ws, cmd.requestId, 'UNAUTHORIZED', 'Session not found.', cmd.type);
      return;
    }

    // Deduplicate accidental repeated request IDs for non-input commands
    if (!isInput) {
      if (state.recentRequestIds.includes(cmd.requestId)) {
        this.sendAck(state.ws, cmd.requestId, cmd.type);
        return;
      }
      state.recentRequestIds.push(cmd.requestId);
      if (state.recentRequestIds.length > 64) {
        state.recentRequestIds.shift();
      }
    }

    try {
      switch (cmd.type) {
        case 'profile.update': {
          const nick = sanitizeNickname(cmd.payload.nickname);
          if (!nick.ok) {
            this.sendError(state.ws, cmd.requestId, 'INVALID_PROFILE', nick.error, cmd.type);
            return;
          }
          if (!this.sessions.isNicknameAvailable(nick.value, session.playerId)) {
            this.sendError(
              state.ws,
              cmd.requestId,
              'NICKNAME_TAKEN',
              `Nickname "${nick.value}" is already taken. Please choose another.`,
              cmd.type,
            );
            return;
          }
          const avatar = await this.resolveValidatedAvatar(cmd.payload.avatarId);
          session.nickname = nick.value;
          session.avatarId = avatar.avatarId;
          session.avatarUrl = avatar.avatarUrl;
          if (cmd.payload.demoModePreference !== undefined) {
            session.demoModePreference = normalizeDemoModePreference(
              cmd.payload.demoModePreference,
            );
          }
          this.leaderboard.upsertPlayer(session);
          this.sendAck(state.ws, cmd.requestId, cmd.type);
          this.broadcastLobbyUpsert(session);
          this.broadcastLeaderboard();
          break;
        }
        case 'challenge.create': {
          this.challenges.createChallenge(session.playerId, cmd.payload.targetPlayerId);
          this.sendAck(state.ws, cmd.requestId, cmd.type);
          break;
        }
        case 'challenge.accept': {
          this.challenges.acceptChallenge(session.playerId, cmd.payload.challengeId);
          this.sendAck(state.ws, cmd.requestId, cmd.type);
          break;
        }
        case 'challenge.decline': {
          this.challenges.declineChallenge(session.playerId, cmd.payload.challengeId);
          this.sendAck(state.ws, cmd.requestId, cmd.type);
          break;
        }
        case 'challenge.cancel': {
          this.challenges.cancelChallenge(session.playerId, cmd.payload.challengeId);
          this.sendAck(state.ws, cmd.requestId, cmd.type);
          break;
        }
        case 'match.input': {
          this.matches.handleInput(
            session.playerId,
            cmd.payload.matchId,
            cmd.payload.direction,
            cmd.payload.seq,
          );
          break;
        }
        case 'match.leave': {
          this.matches.leaveMatch(session.playerId, cmd.payload.matchId);
          this.sendAck(state.ws, cmd.requestId, cmd.type);
          break;
        }
        case 'match.rematch.request': {
          this.matches.requestRematch(session.playerId, cmd.payload.matchId);
          this.sendAck(state.ws, cmd.requestId, cmd.type);
          break;
        }
        case 'match.rematch.accept': {
          this.matches.acceptRematch(session.playerId, cmd.payload.matchId);
          this.sendAck(state.ws, cmd.requestId, cmd.type);
          break;
        }
        case 'lobby.join': {
          this.matches.returnPlayerToLobby(session.playerId);
          this.sendAck(state.ws, cmd.requestId, cmd.type);
          break;
        }
      }
    } catch (err) {
      if (err instanceof ChallengeError || err instanceof MatchError) {
        this.sendError(state.ws, cmd.requestId, err.code, err.message, cmd.type);
        return;
      }
      this.sendError(
        state.ws,
        cmd.requestId,
        'INVALID_MESSAGE',
        'Failed to process command.',
        cmd.type,
      );
    }
  }

  private async handleSessionHello(
    state: SocketState,
    cmd: Extract<ReturnType<typeof ClientCommandSchema.parse>, { type: 'session.hello' }>,
  ): Promise<void> {
    if (cmd.payload.protocolVersion !== PROTOCOL_VERSION) {
      this.sendError(
        state.ws,
        cmd.requestId,
        'PROTOCOL_MISMATCH',
        `Unsupported protocol version ${cmd.payload.protocolVersion}. Expected ${PROTOCOL_VERSION}.`,
        cmd.type,
      );
      return;
    }

    const nick = sanitizeNickname(cmd.payload.profile.nickname);
    if (!nick.ok) {
      this.sendError(state.ws, cmd.requestId, 'INVALID_PROFILE', nick.error, cmd.type);
      return;
    }

    const avatar = await this.resolveValidatedAvatar(cmd.payload.profile.avatarId);

    // If this socket was already bound, ignore duplicate hello or re-sync
    if (state.playerId) {
      const existing = this.sessions.getById(state.playerId);
      if (existing) {
        if (!this.sessions.isNicknameAvailable(nick.value, existing.playerId)) {
          this.sendError(
            state.ws,
            cmd.requestId,
            'NICKNAME_TAKEN',
            `Nickname "${nick.value}" is already taken. Please choose another.`,
            cmd.type,
          );
          return;
        }
        existing.nickname = nick.value;
        existing.avatarId = avatar.avatarId;
        existing.avatarUrl = avatar.avatarUrl;
        if (cmd.payload.profile.demoModePreference !== undefined) {
          existing.demoModePreference = normalizeDemoModePreference(
            cmd.payload.profile.demoModePreference,
          );
        }
        this.sendSessionReady(state.ws, existing, false);
        return;
      }
    }

    const recoverable = cmd.payload.recoveryToken
      ? this.sessions.findByRecoveryToken(cmd.payload.recoveryToken)
      : undefined;

    if (!this.sessions.isNicknameAvailable(nick.value, recoverable?.playerId)) {
      this.sendError(
        state.ws,
        cmd.requestId,
        'NICKNAME_TAKEN',
        `Nickname "${nick.value}" is already taken. Please choose another.`,
        cmd.type,
      );
      return;
    }

    const requestedDemoPref = cmd.payload.profile.demoModePreference
      ? normalizeDemoModePreference(cmd.payload.profile.demoModePreference)
      : undefined;

    let session: PlayerSession | null = null;
    let recovered = false;

    if (cmd.payload.recoveryToken && recoverable) {
      const candidate = this.sessions.recoverSession({
        recoveryToken: cmd.payload.recoveryToken,
        nickname: nick.value,
        avatarId: avatar.avatarId,
        avatarUrl: avatar.avatarUrl,
        socketId: state.socketId,
        demoModePreference: requestedDemoPref,
      });
      if (candidate) {
        // Close previous superseded socket for the same player if still open
        const prevSocket = this.socketsByPlayerId.get(candidate.playerId);
        if (prevSocket && prevSocket.socketId !== state.socketId) {
          prevSocket.playerId = null;
          prevSocket.ws.close(4001, 'Replaced by reconnected session');
        }
        session = candidate;
        recovered = true;
      }
    }

    if (!session) {
      session = this.sessions.createSession({
        nickname: nick.value,
        avatarId: avatar.avatarId,
        avatarUrl: avatar.avatarUrl,
        socketId: state.socketId,
        demoModePreference: requestedDemoPref ?? 'default',
      });
    }

    state.playerId = session.playerId;
    this.socketsByPlayerId.set(session.playerId, state);
    this.leaderboard.upsertPlayer(session);

    if (recovered && session.activeMatchId) {
      this.matches.handlePlayerReconnect(session.playerId);
    }

    this.sendAck(state.ws, cmd.requestId, cmd.type);
    this.sendSessionReady(state.ws, session, recovered);
    this.broadcastLobbyUpsert(session, session.playerId);
    this.broadcastLeaderboard();
  }

  private sendSessionReady(ws: WebSocket, session: PlayerSession, recovered: boolean): void {
    const activeChallenge = this.challenges.getActiveForPlayer(session.playerId);
    const activeMatch = this.matches.getActiveMatchSync(session.playerId);
    this.send(ws, {
      type: 'session.ready',
      protocolVersion: PROTOCOL_VERSION,
      serverTime: Date.now(),
      payload: {
        playerId: session.playerId,
        profile: {
          nickname: session.nickname,
          avatarId: session.avatarId,
          avatarUrl: session.avatarUrl,
          demoModePreference: session.demoModePreference,
        },
        recoveryToken: session.recoveryToken,
        uploadToken: session.uploadToken,
        recovered,
        lobby: this.sessions.getLobbySnapshot(),
        activeChallenge,
        activeMatch,
        arenaConfig: this.configService.getPublicConfig(),
      },
    });
  }

  private handleDisconnect(state: SocketState): void {
    if (!this.socketsById.delete(state.socketId)) return;

    const playerId = state.playerId;
    if (!playerId) return;

    const currentSocket = this.socketsByPlayerId.get(playerId);
    if (currentSocket?.socketId === state.socketId) {
      this.socketsByPlayerId.delete(playerId);
    } else {
      // Socket was already superseded by a newer reconnected socket
      return;
    }

    const session = this.sessions.markDisconnected(playerId);
    if (!session) return;

    this.leaderboard.markDisconnected(playerId);
    // Promptly cancel any pending challenge on disconnect
    this.challenges.invalidateForPlayer(playerId, 'Player disconnected');

    this.broadcastLobbyUpsert(session);
    this.broadcastLeaderboard();

    if (session.activeMatchId) {
      this.matches.handlePlayerDisconnect(playerId);
      return;
    }

    // Lobby-only disconnect: allow brief refresh window before removing from roster
    session.disconnectExpiryTimer = setTimeout(() => {
      session.disconnectExpiryTimer = null;
      const latest = this.sessions.getById(playerId);
      if (latest && !latest.connected && !latest.activeMatchId) {
        this.sessions.removeSession(playerId);
        this.avatarService.releaseSessionTracking(playerId);
        this.broadcastLobbyRemove(playerId);
      }
    }, this.lobbyDisconnectGraceMs);
  }

  private send(ws: WebSocket, event: ServerEvent): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(event));
    } catch {
      // Ignore closed/broken pipe; close handler cleans up
    }
  }

  private sendToPlayer(playerId: string, event: ServerEvent): void {
    const sock = this.socketsByPlayerId.get(playerId);
    if (sock) {
      this.send(sock.ws, event);
    }
  }

  private sendAck(ws: WebSocket, requestId: string, commandType: string): void {
    this.send(ws, {
      type: 'command.ack',
      protocolVersion: PROTOCOL_VERSION,
      serverTime: Date.now(),
      requestId,
      payload: { commandType },
    });
  }

  private sendError(
    ws: WebSocket,
    requestId: string | undefined,
    code: ErrorCode,
    message: string,
    commandType?: string,
  ): void {
    this.send(ws, {
      type: 'command.error',
      protocolVersion: PROTOCOL_VERSION,
      serverTime: Date.now(),
      requestId,
      payload: { code, message, commandType },
    });
  }

  private broadcastLobbyUpsert(player: PlayerSession, excludePlayerId?: string): void {
    const event: ServerEvent = {
      type: 'lobby.player.upsert',
      protocolVersion: PROTOCOL_VERSION,
      serverTime: Date.now(),
      payload: { player: this.sessions.toLobbyPlayer(player) },
    };
    for (const sock of this.socketsByPlayerId.values()) {
      if (excludePlayerId && sock.playerId === excludePlayerId) continue;
      this.send(sock.ws, event);
    }
  }

  private broadcastLobbyRemove(playerId: string): void {
    const event: ServerEvent = {
      type: 'lobby.player.remove',
      protocolVersion: PROTOCOL_VERSION,
      serverTime: Date.now(),
      payload: { playerId },
    };
    for (const sock of this.socketsByPlayerId.values()) {
      this.send(sock.ws, event);
    }
  }

  broadcastNotice(level: 'info' | 'warning', message: string): void {
    const event: ServerEvent = {
      type: 'server.notice',
      protocolVersion: PROTOCOL_VERSION,
      serverTime: Date.now(),
      payload: { level, message },
    };
    for (const sock of this.socketsByPlayerId.values()) {
      this.send(sock.ws, event);
    }
  }

  broadcastLeaderboard(): void {
    const event: ServerEvent = {
      type: 'leaderboard.updated',
      protocolVersion: PROTOCOL_VERSION,
      serverTime: Date.now(),
      payload: {
        entries: this.leaderboard.getEntries(),
        summary: this.leaderboard.getSummary(),
      },
    };
    for (const sock of this.socketsByPlayerId.values()) {
      this.send(sock.ws, event);
    }
  }

  applyRuntimeConfigUpdate(): void {
    const cfg = this.configService.getConfig();
    this.challenges.setExpiryMs(cfg.challengeExpiryMs);
    this.matches.setDisconnectGraceMs(cfg.disconnectGraceMs);

    const event: ServerEvent = {
      type: 'config.updated',
      protocolVersion: PROTOCOL_VERSION,
      serverTime: Date.now(),
      payload: { config: this.configService.getPublicConfig() },
    };
    for (const sock of this.socketsByPlayerId.values()) {
      this.send(sock.ws, event);
    }
  }

  closeAll(noticeMessage?: string): void {
    clearInterval(this.heartbeatTimer);
    if (noticeMessage) {
      this.broadcastNotice('warning', noticeMessage);
    }
    this.challenges.clearAll();
    this.matches.clearAll();
    this.sessions.clearAll();
    for (const sock of this.socketsById.values()) {
      try {
        sock.ws.close(1001, 'Server shutting down');
      } catch {
        // Ignore
      }
    }
    this.socketsById.clear();
    this.socketsByPlayerId.clear();
    this.wss.close();
  }
}
