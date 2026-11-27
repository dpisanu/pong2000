import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArenaClient, uploadAvatarFile, type ConnectionState } from '../../src/client/network/arenaClient.ts';
import { PROTOCOL_VERSION } from '../../src/shared/constants.ts';
import type { ServerEvent } from '../../src/shared/protocol.ts';

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  sentMessages: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }

  triggerOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  triggerMessage(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  triggerClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

describe('ArenaClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal('window', {
      location: {
        protocol: 'https:',
        host: 'arena.local:3000',
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('connects using wss:/ws: scheme, sends session.hello, and measures pong RTT', () => {
    const states: ConnectionState[] = [];
    const events: ServerEvent[] = [];
    const latencies: Array<number | null> = [];

    const client = new ArenaClient({
      onConnectionState: (state) => states.push(state),
      onEvent: (event) => events.push(event),
      onLatency: (pingMs) => latencies.push(pingMs),
    });

    client.connect(
      {
        nickname: 'Alex',
        avatarId: 'gallery:ace-paddle',
        demoModePreference: 'wall',
      },
      'recovery-abc',
    );

    expect(states).toEqual(['CONNECTING']);
    expect(MockWebSocket.instances).toHaveLength(1);
    const socket = MockWebSocket.instances[0];
    expect(socket.url).toBe('wss://arena.local:3000/ws');

    socket.triggerOpen();
    expect(states).toEqual(['CONNECTING', 'CONNECTED']);
    expect(socket.sentMessages).toHaveLength(2);

    const hello = JSON.parse(socket.sentMessages[0]);
    expect(hello.type).toBe('session.hello');
    expect(hello.payload).toEqual({
      protocolVersion: PROTOCOL_VERSION,
      profile: {
        nickname: 'Alex',
        avatarId: 'gallery:ace-paddle',
        demoModePreference: 'wall',
      },
      recoveryToken: 'recovery-abc',
    });

    const initialPing = JSON.parse(socket.sentMessages[1]);
    expect(initialPing.type).toBe('ping');

    vi.advanceTimersByTime(14);
    socket.triggerMessage({
      type: 'pong',
      requestId: initialPing.requestId,
      payload: { clientTime: initialPing.payload.clientTime, serverTime: Date.now() },
    });

    expect(latencies).toEqual([14]);
    // Immediately issues follow-up ping so server learns first measured RTT
    expect(socket.sentMessages).toHaveLength(3);
    const followUpPing = JSON.parse(socket.sentMessages[2]);
    expect(followUpPing.payload.lastPingMs).toBe(14);

    // Non-pong events dispatch to onEvent
    socket.triggerMessage({
      type: 'error',
      payload: { code: 'RATE_LIMITED', message: 'Slow down' },
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');

    client.disconnect();
    expect(states.at(-1)).toBe('DISCONNECTED');
    expect(latencies.at(-1)).toBeNull();
  });

  it('schedules reconnect on unexpected close and stops after manual disconnect', () => {
    const states: ConnectionState[] = [];
    const client = new ArenaClient({
      onConnectionState: (state) => states.push(state),
      onEvent: () => {},
    });

    client.connect({ nickname: 'Alex', avatarId: 'gallery:ace-paddle' });
    const firstSocket = MockWebSocket.instances[0];
    firstSocket.triggerOpen();
    firstSocket.triggerClose();

    expect(states.at(-1)).toBe('RECONNECTING');
    vi.advanceTimersByTime(500);
    expect(MockWebSocket.instances).toHaveLength(2);

    client.disconnect();
    expect(states.at(-1)).toBe('DISCONNECTED');
  });
});

describe('uploadAvatarFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uploads binary file with Bearer token and surfaces server errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        avatarId: 'uploaded:av_1234567890abcdef1234567890abcdef',
        avatarUrl: '/api/avatars/av_1234567890abcdef1234567890abcdef',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const file = new File([new Uint8Array([1, 2, 3])], 'avatar.png', { type: 'image/png' });
    const uploaded = await uploadAvatarFile(file, 'upload-secret');

    expect(fetchMock).toHaveBeenCalledWith('/api/avatars', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer upload-secret',
        'Content-Type': 'image/png',
      },
      body: file,
    });
    expect(uploaded.avatarId).toBe('uploaded:av_1234567890abcdef1234567890abcdef');

    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'File too large' }),
    });
    await expect(uploadAvatarFile(file, 'upload-secret')).rejects.toThrow('File too large');
  });
});
