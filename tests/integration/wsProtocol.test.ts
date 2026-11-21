import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { DEMO_PLAYER_ID, PROTOCOL_VERSION } from '../../shared/src/constants.ts';
import type { ServerEvent } from '../../shared/src/protocol.ts';
import { AvatarService } from '../../server/src/avatars/avatarService.ts';
import { AdminAuthService, ServerConfigService } from '../../server/src/config/serverConfig.ts';
import { createApp } from '../../server/src/http/createApp.ts';
import { SessionManager } from '../../server/src/sessions/sessionManager.ts';
import { WsGateway } from '../../server/src/ws/wsGateway.ts';

interface TestClient {
  ws: WebSocket;
  events: ServerEvent[];
  send: (msg: unknown) => void;
  waitFor: <T extends ServerEvent['type']>(
    type: T,
    predicate?: (ev: Extract<ServerEvent, { type: T }>) => boolean,
    timeoutMs?: number,
  ) => Promise<Extract<ServerEvent, { type: T }>>;
}

async function createTestServer(opts?: {
  challengeExpiryMs?: number;
  disconnectGraceMs?: number;
}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lan-pong-int-'));
  const avatarService = new AvatarService(dir);
  await avatarService.init();

  const sessions = new SessionManager();
  const configService = new ServerConfigService();
  const adminAuth = new AdminAuthService();
  let gateway: WsGateway | null = null;
  const app = createApp({
    avatarService,
    sessions,
    getMatchManager: () => gateway!.matches,
    port: 0,
    configService,
    adminAuth,
    onConfigUpdated: () => gateway?.applyRuntimeConfigUpdate(),
  });

  const server = http.createServer(app);
  gateway = new WsGateway({
    server,
    sessions,
    avatarService,
    configService,
    challengeExpiryMs: opts?.challengeExpiryMs ?? 30_000,
    disconnectGraceMs: opts?.disconnectGraceMs ?? 10_000,
    heartbeatIntervalMs: 60_000,
    heartbeatTimeoutMs: 120_000,
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;

  const close = async () => {
    gateway?.closeAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(dir, { recursive: true, force: true });
  };

  return { port, gateway, close };
}

async function connectClient(
  port: number,
  nickname: string,
  recoveryToken?: string,
): Promise<{
  client: TestClient;
  ready: Extract<ServerEvent, { type: 'session.ready' }>;
}> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const events: ServerEvent[] = [];
  const waiters: Array<(ev: ServerEvent) => void> = [];

  ws.on('message', (data) => {
    const parsed = JSON.parse(data.toString('utf8')) as ServerEvent;
    events.push(parsed);
    for (let i = waiters.length - 1; i >= 0; i--) {
      waiters[i](parsed);
    }
  });

  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  const client: TestClient = {
    ws,
    events,
    send(msg: unknown) {
      ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
    },
    waitFor<T extends ServerEvent['type']>(
      type: T,
      predicate?: (ev: Extract<ServerEvent, { type: T }>) => boolean,
      timeoutMs = 3000,
    ) {
      const existing = events.find(
        (ev): ev is Extract<ServerEvent, { type: T }> =>
          ev.type === type && (!predicate || predicate(ev as Extract<ServerEvent, { type: T }>)),
      );
      if (existing) return Promise.resolve(existing);

      return new Promise<Extract<ServerEvent, { type: T }>>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Timed out waiting for event ${type}`));
        }, timeoutMs);

        const listener = (ev: ServerEvent) => {
          if (
            ev.type === type &&
            (!predicate || predicate(ev as Extract<ServerEvent, { type: T }>))
          ) {
            clearTimeout(timer);
            const idx = waiters.indexOf(listener);
            if (idx >= 0) waiters.splice(idx, 1);
            resolve(ev as Extract<ServerEvent, { type: T }>);
          }
        };
        waiters.push(listener);
      });
    },
  };

  client.send({
    type: 'session.hello',
    requestId: `hello-${nickname}`,
    payload: {
      protocolVersion: PROTOCOL_VERSION,
      profile: { nickname, avatarId: 'gallery:ace-paddle' },
      recoveryToken,
    },
  });

  const ready = await client.waitFor('session.ready');
  return { client, ready };
}

describe('WebSocket protocol & multiplayer integration', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const fn of cleanups.splice(0)) {
      await fn();
    }
  });

  it('prevents challenge race conditions and handles expiry cleanly', async () => {
    const srv = await createTestServer({ challengeExpiryMs: 140 });
    cleanups.push(srv.close);

    const a = await connectClient(srv.port, 'Alice');
    const b = await connectClient(srv.port, 'Bob');
    const c = await connectClient(srv.port, 'Charlie');

    // Alice and Charlie race to challenge Bob simultaneously
    a.client.send({
      type: 'challenge.create',
      requestId: 'ch-1',
      payload: { targetPlayerId: b.ready.payload.playerId },
    });
    c.client.send({
      type: 'challenge.create',
      requestId: 'ch-2',
      payload: { targetPlayerId: b.ready.payload.playerId },
    });

    const bChallenge = await b.client.waitFor('challenge.received');
    const winnerId = bChallenge.payload.challenge.fromPlayerId;
    expect([a.ready.payload.playerId, c.ready.payload.playerId]).toContain(winnerId);

    const loserClient = winnerId === a.ready.payload.playerId ? c.client : a.client;
    const loserError = await loserClient.waitFor('command.error');
    expect(['PLAYER_UNAVAILABLE', 'ALREADY_BUSY']).toContain(loserError.payload.code);

    // Let invitation expire after 140ms
    const expiredEv = await b.client.waitFor(
      'challenge.updated',
      (ev) => ev.payload.challenge.status === 'EXPIRED',
    );
    expect(expiredEv.payload.challenge.status).toBe('EXPIRED');

    // Now Bob can challenge Charlie cleanly
    b.client.send({
      type: 'challenge.create',
      requestId: 'ch-3',
      payload: { targetPlayerId: c.ready.payload.playerId },
    });
    const cIncoming = await c.client.waitFor(
      'challenge.received',
      (ev) => ev.payload.challenge.fromPlayerId === b.ready.payload.playerId,
    );
    expect(cIncoming.payload.challenge.fromPlayerId).toBe(b.ready.payload.playerId);

    a.client.ws.close();
    b.client.ws.close();
    c.client.ws.close();
  });

  it('isolates concurrent matches and blocks unauthorized input and malformed messages', async () => {
    const srv = await createTestServer();
    cleanups.push(srv.close);

    const p1 = await connectClient(srv.port, 'P1');
    const p2 = await connectClient(srv.port, 'P2');
    const p3 = await connectClient(srv.port, 'P3');
    const p4 = await connectClient(srv.port, 'P4');

    // Pair 1 starts match
    p1.client.send({
      type: 'challenge.create',
      requestId: 'm1-ch',
      payload: { targetPlayerId: p2.ready.payload.playerId },
    });
    const p2Inv = await p2.client.waitFor('challenge.received');
    p2.client.send({
      type: 'challenge.accept',
      requestId: 'm1-acc',
      payload: { challengeId: p2Inv.payload.challenge.challengeId },
    });
    const m1P1 = await p1.client.waitFor('match.started');
    const m1P2 = await p2.client.waitFor('match.started');
    expect(m1P1.payload.yourSide).not.toBe(m1P2.payload.yourSide);

    // Pair 2 starts second match
    p3.client.send({
      type: 'challenge.create',
      requestId: 'm2-ch',
      payload: { targetPlayerId: p4.ready.payload.playerId },
    });
    const p4Inv = await p4.client.waitFor('challenge.received');
    p4.client.send({
      type: 'challenge.accept',
      requestId: 'm2-acc',
      payload: { challengeId: p4Inv.payload.challenge.challengeId },
    });
    const m2P3 = await p3.client.waitFor('match.started');

    // P3 tries to inject paddle input into Match 1 -> rejected
    p3.client.send({
      type: 'match.input',
      requestId: 'bad-input',
      payload: { matchId: m1P1.payload.matchId, direction: 1, seq: 1 },
    });
    const err = await p3.client.waitFor('command.error');
    expect(err.payload.code).toBe('NOT_MATCH_PARTICIPANT');

    // Malformed JSON does not crash server
    p1.client.send('{not valid json');
    const parseErr = await p1.client.waitFor(
      'command.error',
      (ev) => ev.payload.code === 'INVALID_MESSAGE',
    );
    expect(parseErr.payload.code).toBe('INVALID_MESSAGE');

    // Verify match snapshots received by P1 belong ONLY to Match 1
    expect(
      p1.client.events.some(
        (ev) => ev.type === 'match.snapshot' && ev.payload.matchId === m2P3.payload.matchId,
      ),
    ).toBe(false);

    p1.client.ws.close();
    p2.client.ws.close();
    p3.client.ws.close();
    p4.client.ws.close();
  });

  it('pauses on mid-match disconnect, recovers within grace, and forfeits on timeout', async () => {
    const srv = await createTestServer({ disconnectGraceMs: 180 });
    cleanups.push(srv.close);

    const a = await connectClient(srv.port, 'Alice');
    const b = await connectClient(srv.port, 'Bob');

    a.client.send({
      type: 'challenge.create',
      requestId: 'rec-ch',
      payload: { targetPlayerId: b.ready.payload.playerId },
    });
    const bInv = await b.client.waitFor('challenge.received');
    b.client.send({
      type: 'challenge.accept',
      requestId: 'rec-acc',
      payload: { challengeId: bInv.payload.challenge.challengeId },
    });
    await a.client.waitFor('match.started');
    await b.client.waitFor('match.started');

    // Bob drops connection -> Alice sees PAUSED_DISCONNECT
    b.client.ws.close();
    const pausedEv = await a.client.waitFor(
      'match.phase',
      (ev) => ev.payload.phase === 'PAUSED_DISCONNECT',
    );
    expect(pausedEv.payload.phase).toBe('PAUSED_DISCONNECT');

    // Bob reconnects before 180ms using recoveryToken -> resumes!
    const b2 = await connectClient(srv.port, 'Bob', b.ready.payload.recoveryToken);
    expect(b2.ready.payload.recovered).toBe(true);
    expect(b2.ready.payload.activeMatch).not.toBeNull();
    expect(b2.ready.payload.recoveryToken).not.toBe(b.ready.payload.recoveryToken);

    const resumedEv = await a.client.waitFor(
      'match.phase',
      (ev) => ev.payload.phase === 'COUNTDOWN',
    );
    expect(resumedEv.payload.phase).toBe('COUNTDOWN');

    // Now Bob drops again and does NOT reconnect within 180ms -> forfeits
    b2.client.ws.close();
    const finishedEv = await a.client.waitFor(
      'match.finished',
      (ev) => ev.payload.reason === 'FORFEIT_DISCONNECT',
    );
    expect(finishedEv.payload.winnerPlayerId).toBe(a.ready.payload.playerId);

    a.client.ws.close();
  });

  it('enforces case-insensitive unique nicknames across sessions and profile updates', async () => {
    const srv = await createTestServer();
    cleanups.push(srv.close);

    const a = await connectClient(srv.port, 'Alex');
    const b = await connectClient(srv.port, 'Jordan');

    // New client attempting same nickname with different case is rejected with NICKNAME_TAKEN
    const wsDup = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
    await new Promise<void>((resolve) => wsDup.once('open', () => resolve()));
    const dupErrors: ServerEvent[] = [];
    wsDup.on('message', (d) => dupErrors.push(JSON.parse(d.toString('utf8')) as ServerEvent));
    wsDup.send(
      JSON.stringify({
        type: 'session.hello',
        requestId: 'dup-hello',
        payload: {
          protocolVersion: PROTOCOL_VERSION,
          profile: { nickname: 'alex', avatarId: 'gallery:ace-paddle' },
        },
      }),
    );
    await new Promise((r) => setTimeout(r, 80));
    expect(
      dupErrors.some(
        (ev) => ev.type === 'command.error' && ev.payload.code === 'NICKNAME_TAKEN',
      ),
    ).toBe(true);
    wsDup.close();

    // Existing client trying to rename to a taken nickname is rejected
    b.client.send({
      type: 'profile.update',
      requestId: 'dup-rename',
      payload: { nickname: 'ALEX', avatarId: 'gallery:rally-fox' },
    });
    const renameErr = await b.client.waitFor(
      'command.error',
      (ev) => ev.payload.code === 'NICKNAME_TAKEN',
    );
    expect(renameErr.payload.code).toBe('NICKNAME_TAKEN');

    // Existing client updating avatar while keeping own nickname succeeds
    b.client.send({
      type: 'profile.update',
      requestId: 'own-update',
      payload: { nickname: 'Jordan', avatarId: 'gallery:rally-fox' },
    });
    const ack = await b.client.waitFor(
      'command.ack',
      (ev) => ev.requestId === 'own-update',
    );
    expect(ack.payload.commandType).toBe('profile.update');

    a.client.ws.close();
    b.client.ws.close();
  });

  it('responds to WebSocket ping with matching pong clientTime', async () => {
    const srv = await createTestServer();
    cleanups.push(srv.close);

    const a = await connectClient(srv.port, 'PingTester');
    a.client.send({
      type: 'ping',
      requestId: 'ping-1',
      payload: { clientTime: 123456789 },
    });

    const pong = await a.client.waitFor('pong', (ev) => ev.requestId === 'ping-1');
    expect(pong.payload.clientTime).toBe(123456789);
    a.client.ws.close();
  });

  it('auto-accepts Demo Player challenges with full-height opponent paddle and leaves Demo Player available', async () => {
    const srv = await createTestServer();
    cleanups.push(srv.close);

    const p1 = await connectClient(srv.port, 'Solo1');
    const p2 = await connectClient(srv.port, 'Solo2');

    expect(p1.ready.payload.lobby.some((p) => p.playerId === DEMO_PLAYER_ID && p.isBot)).toBe(true);

    p1.client.send({
      type: 'challenge.create',
      requestId: 'demo-ch-1',
      payload: { targetPlayerId: DEMO_PLAYER_ID },
    });

    const started = await p1.client.waitFor('match.started');
    expect(started.payload.yourSide).toBe('left');
    expect(started.payload.rules?.isDemoMatch).toBe(true);
    expect(started.payload.rules?.rightPaddleHeight).toBe(1.0);
    expect(started.payload.participants[1].playerId).toBe(DEMO_PLAYER_ID);

    // Demo Player stays AVAILABLE so another human player can start their own Demo match concurrently
    p2.client.send({
      type: 'challenge.create',
      requestId: 'demo-ch-2',
      payload: { targetPlayerId: DEMO_PLAYER_ID },
    });
    const started2 = await p2.client.waitFor('match.started');
    expect(started2.payload.rules?.isDemoMatch).toBe(true);

    p1.client.ws.close();
    p2.client.ws.close();
  });

  it('secures /api/admin/* endpoints, updates runtime config, broadcasts config.updated, and updates /api/server-info', async () => {
    const srv = await createTestServer();
    cleanups.push(srv.close);
    const baseUrl = `http://127.0.0.1:${srv.port}`;

    const clientConn = await connectClient(srv.port, 'AdminWatcher');

    // Unauthenticated read rejected
    const unauthRes = await fetch(`${baseUrl}/api/admin/config`);
    expect(unauthRes.status).toBe(401);

    // Claim admin passcode via first-run setup
    const setupRes = await fetch(`${baseUrl}/api/admin/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: 'lan-admin-2026' }),
    });
    expect(setupRes.status).toBe(201);
    const { token } = (await setupRes.json()) as { token: string };
    expect(token).toMatch(/^ad_/);

    // Save custom physics, rounds, timeouts, and explicit Host IP
    const putRes = await fetch(`${baseUrl}/api/admin/config`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        paddleHeight: 0.28,
        paddleSpeed: 1.15,
        ballInitialSpeed: 0.85,
        winScore: 9,
        hostIp: '192.168.50.99',
      }),
    });
    expect(putRes.status).toBe(200);

    // Connected WebSocket clients receive updated public config immediately
    const cfgEv = await clientConn.client.waitFor('config.updated');
    expect(cfgEv.payload.config.winScore).toBe(9);
    expect(cfgEv.payload.config.paddleHeight).toBe(0.28);

    // Public /api/server-info uses configured Host IP without leaking admin settings
    const infoRes = await fetch(`${baseUrl}/api/server-info`);
    const info = (await infoRes.json()) as {
      lanUrls: string[];
      hasConfiguredHostIp: boolean;
      ipDetected: boolean;
    };
    expect(info.hasConfiguredHostIp).toBe(true);
    expect(info.ipDetected).toBe(true);
    expect(info.lanUrls[0]).toContain('192.168.50.99');

    clientConn.client.ws.close();
  });
});
