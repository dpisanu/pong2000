import { describe, expect, it } from 'vitest';
import {
  DEMO_ERRATIC_ENABLED,
  DEMO_ERRATIC_PADDLE_HEIGHT,
  DEMO_ERRATIC_SPEED,
  DEMO_GAP_ENABLED,
  DEMO_GAP_PADDLE_HEIGHT,
  DEMO_HONING_ENABLED,
  DEMO_HONING_PADDLE_HEIGHT,
  DEMO_HONING_SPEED,
  DEMO_SWIPE_ENABLED,
  DEMO_SWIPE_PADDLE_HEIGHT,
  DEMO_SWIPE_SPEED,
  DEMO_WALL_ENABLED,
} from '../../src/shared/constants.ts';
import {
  ArenaConfigSchema,
  isValidAvatarId,
  isValidDemoModePreference,
  normalizeDemoModePreference,
  resolveAvatarUrl,
  sanitizeNickname,
  validateHostIpInput,
} from '../../src/shared/validation.ts';

describe('shared validation helpers', () => {
  it('sanitizes and bounds nicknames properly', () => {
    expect(sanitizeNickname('  Alex  Rivera \n')).toEqual({ ok: true, value: 'Alex Rivera' });
    expect(sanitizeNickname('   ').ok).toBe(false);
    expect(sanitizeNickname('A'.repeat(25)).ok).toBe(false);
    expect(sanitizeNickname('A'.repeat(24))).toEqual({ ok: true, value: 'A'.repeat(24) });
  });

  it('validates and resolves bundled and uploaded avatar IDs', () => {
    expect(isValidAvatarId('gallery:ace-paddle')).toBe(true);
    expect(resolveAvatarUrl('gallery:ace-paddle')).toBe('/avatars/ace-paddle.svg');
    expect(isValidAvatarId('uploaded:av_0123456789abcdef0123456789abcdef')).toBe(true);
    expect(resolveAvatarUrl('uploaded:av_0123456789abcdef0123456789abcdef')).toBe(
      '/api/avatars/av_0123456789abcdef0123456789abcdef',
    );
    expect(isValidAvatarId('uploaded:../etc/passwd')).toBe(false);
    expect(resolveAvatarUrl('invalid')).toBe('/avatars/default.svg');
  });

  it('validates and normalizes per-player Demo Mode preferences', () => {
    expect(isValidDemoModePreference('default')).toBe(true);
    expect(isValidDemoModePreference('wall')).toBe(true);
    expect(isValidDemoModePreference('gap')).toBe(true);
    expect(isValidDemoModePreference('honing')).toBe(true);
    expect(isValidDemoModePreference('swipe')).toBe(true);
    expect(isValidDemoModePreference('erratic')).toBe(true);
    expect(isValidDemoModePreference('unknown')).toBe(false);

    expect(normalizeDemoModePreference(undefined)).toBe('default');
    expect(normalizeDemoModePreference('bogus')).toBe('default');
    expect(normalizeDemoModePreference('erratic')).toBe('erratic');
  });

  it('validates hostIp inputs and rejects malformed paths or invalid characters', () => {
    expect(validateHostIpInput('192.168.1.42')).toEqual({ ok: true, value: '192.168.1.42' });
    expect(validateHostIpInput('http://10.0.0.12:3000/')).toEqual({
      ok: true,
      value: 'http://10.0.0.12:3000',
    });
    expect(validateHostIpInput('   ')).toEqual({ ok: true, value: '' });
    expect(validateHostIpInput('http://bad/path').ok).toBe(false);
    expect(validateHostIpInput('bad host <script>').ok).toBe(false);
  });

  it('validates ArenaConfigSchema bounds and demo mode constraints', () => {
    const valid = ArenaConfigSchema.safeParse({
      paddleHeight: 0.19,
      paddleSpeed: 0.92,
      ballInitialSpeed: 0.72,
      ballSpeedIncrement: 0.045,
      ballMaxSpeed: 1.48,
      winScore: 5,
      initialCountdownMs: 3000,
      pointCountdownMs: 1500,
      resumeCountdownMs: 2000,
      challengeExpiryMs: 30000,
      disconnectGraceMs: 10000,
      demoModes: {
        wall: { enabled: DEMO_WALL_ENABLED },
        gap: { enabled: DEMO_GAP_ENABLED, paddleHeight: DEMO_GAP_PADDLE_HEIGHT },
        honing: {
          enabled: DEMO_HONING_ENABLED,
          paddleHeight: DEMO_HONING_PADDLE_HEIGHT,
          speed: DEMO_HONING_SPEED,
        },
        swipe: {
          enabled: DEMO_SWIPE_ENABLED,
          paddleHeight: DEMO_SWIPE_PADDLE_HEIGHT,
          speed: DEMO_SWIPE_SPEED,
        },
        erratic: {
          enabled: DEMO_ERRATIC_ENABLED,
          paddleHeight: DEMO_ERRATIC_PADDLE_HEIGHT,
          speed: DEMO_ERRATIC_SPEED,
        },
      },
      hostIp: '192.168.1.10',
    });
    expect(valid.success).toBe(true);

    const noDemoMode = ArenaConfigSchema.safeParse({
      ...(valid.success ? valid.data : {}),
      demoModes: {
        wall: { enabled: false },
        gap: { enabled: false, paddleHeight: 0.9 },
        honing: { enabled: false, paddleHeight: 0.2, speed: 0.7 },
        swipe: { enabled: false, paddleHeight: 0.2, speed: 0.7 },
        erratic: { enabled: false, paddleHeight: 0.3, speed: 1.0 },
      },
    });
    expect(noDemoMode.success).toBe(false);
  });
});
