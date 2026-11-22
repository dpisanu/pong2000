import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_AVATAR_BYTES } from '../../shared/src/constants.ts';
import {
  ArenaConfigSchema,
  isValidAvatarId,
  isValidDemoModePreference,
  normalizeDemoModePreference,
  resolveAvatarUrl,
  sanitizeNickname,
  validateHostIpInput,
} from '../../shared/src/validation.ts';
import { AvatarService, AvatarUploadError } from '../../server/src/avatars/avatarService.ts';
import { AdminAuthService, ServerConfigService } from '../../server/src/config/serverConfig.ts';
import { getLanUrls } from '../../server/src/http/createApp.ts';

describe('validation helpers', () => {
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
});

describe('AvatarService', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs) {
      await fs.rm(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('re-encodes valid PNG uploads to bounded 256x256 WebP and enforces per-session cap', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pong2000-avatars-'));
    tempDirs.push(dir);
    const service = new AvatarService(dir);
    await service.init();

    const pngBuf = await sharp({
      create: {
        width: 400,
        height: 300,
        channels: 4,
        background: { r: 16, g: 185, b: 129, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const r1 = await service.processAndStoreUpload('session-1', pngBuf);
    const r2 = await service.processAndStoreUpload('session-1', pngBuf);
    const r3 = await service.processAndStoreUpload('session-1', pngBuf);

    // r1 should have been pruned by MAX_STORED_AVATARS_PER_SESSION = 2
    expect(await service.avatarExists(r1.key)).toBe(false);
    expect(await service.avatarExists(r2.key)).toBe(true);
    expect(await service.avatarExists(r3.key)).toBe(true);

    const savedBuf = await service.getAvatarBuffer(r3.key);
    expect(savedBuf).not.toBeNull();
    const meta = await sharp(savedBuf!).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(256);
    expect(meta.height).toBe(256);
  });

  it('rejects SVG payloads and oversized buffers', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pong2000-avatars-'));
    tempDirs.push(dir);
    const service = new AvatarService(dir);
    await service.init();

    await expect(
      service.processAndStoreUpload('session-1', Buffer.from('<svg><script>alert(1)</script></svg>')),
    ).rejects.toThrow(AvatarUploadError);

    const huge = Buffer.alloc(MAX_AVATAR_BYTES + 10);
    await expect(service.processAndStoreUpload('session-1', huge)).rejects.toThrow(AvatarUploadError);
  });
});

describe('getLanUrls', () => {
  it('prioritizes explicit PUBLIC_URL and non-loopback request host and skips container bridge IPs', () => {
    const urls = getLanUrls(3000, undefined, '192.168.1.42:3000', 'http', true);
    expect(urls[0]).toBe('http://192.168.1.42:3000');
    expect(urls.some((u) => /^http:\/\/172\.(1[6-9]|2\d|3[01])\./.test(u))).toBe(false);

    const withPublic = getLanUrls(
      3000,
      'http://10.0.0.5:3000/',
      '192.168.1.42:3000',
      'http',
      true,
    );
    expect(withPublic[0]).toBe('http://10.0.0.5:3000');
    expect(withPublic[1]).toBe('http://192.168.1.42:3000');
  });
});

describe('ServerConfigService & ArenaConfigSchema', () => {
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

  it('updates, validates bounds, builds demo rules, and resets ServerConfigService', () => {
    const svc = new ServerConfigService('192.168.1.50');
    expect(svc.getHostIp()).toBe('192.168.1.50');

    const badSpeed = svc.updateConfig({ ballInitialSpeed: 1.5, ballMaxSpeed: 0.9 });
    expect(badSpeed.ok).toBe(false);

    const updated = svc.updateConfig({
      paddleHeight: 0.25,
      paddleSpeed: 1.2,
      winScore: 7,
      hostIp: '10.10.0.8',
    });
    expect(updated.ok).toBe(true);
    expect(svc.getConfig().winScore).toBe(7);
    expect(svc.getHostIp()).toBe('10.10.0.8');

    const demoRules = svc.buildMatchRules('right');
    expect(demoRules.isDemoMatch).toBe(true);
    expect(demoRules.leftPaddleHeight).toBe(0.25);
    expect(demoRules.rightPaddleHeight).toBe(1.0);
    expect(demoRules.demoMode).toBe('wall');
    expect(demoRules.demoPaddleSpeed).toBe(0);
    expect(demoRules.winScore).toBe(7);

    // Rejects disabling all five Demo User modes
    const allDisabled = svc.updateConfig({
      demoModes: {
        wall: { enabled: false },
        gap: { enabled: false },
        honing: { enabled: false },
        swipe: { enabled: false },
        erratic: { enabled: false },
      },
    });
    expect(allDisabled.ok).toBe(false);

    // Enable Gap (0.90), Honing (0.25, 1.15), and Swipe (0.20, 0.85) with Wall disabled
    const multiDemo = svc.updateConfig({
      demoModes: {
        wall: { enabled: false },
        gap: { enabled: true, paddleHeight: 0.9 },
        honing: { enabled: true, paddleHeight: 0.25, speed: 1.15 },
        swipe: { enabled: true, paddleHeight: 0.2, speed: 0.85 },
      },
    });
    expect(multiDemo.ok).toBe(true);

    // Deterministic RNG selects across enabled modes in order [gap, honing, swipe]
    const gapPick = svc.buildMatchRules('right', () => 0.05);
    expect(gapPick.demoMode).toBe('gap');
    expect(gapPick.rightPaddleHeight).toBe(0.9);
    expect(gapPick.demoPaddleSpeed).toBe(0);

    const honingPick = svc.buildMatchRules('right', () => 0.5);
    expect(honingPick.demoMode).toBe('honing');
    expect(honingPick.rightPaddleHeight).toBe(0.25);
    expect(honingPick.demoPaddleSpeed).toBe(1.15);

    const swipePick = svc.buildMatchRules('right', () => 0.9);
    expect(swipePick.demoMode).toBe('swipe');
    expect(swipePick.rightPaddleHeight).toBe(0.2);
    expect(swipePick.demoPaddleSpeed).toBe(0.85);

    // Player preference overrides global enabled pool while using Admin-configured geometry/speed
    const overrideErratic = svc.buildMatchRules('right', () => 0.05, 'erratic');
    expect(overrideErratic.demoMode).toBe('erratic');
    expect(overrideErratic.rightPaddleHeight).toBe(0.3);
    expect(overrideErratic.demoPaddleSpeed).toBe(1.0);

    const overrideWall = svc.buildMatchRules('left', () => 0.95, 'wall');
    expect(overrideWall.demoMode).toBe('wall');
    expect(overrideWall.leftPaddleHeight).toBe(1.0);
    expect(overrideWall.demoPaddleSpeed).toBe(0);

    const defaultPool = svc.buildMatchRules('right', () => 0.05, 'default');
    expect(defaultPool.demoMode).toBe('gap');

    const reset = svc.resetConfig();
    expect(reset.hostIp).toBe('192.168.1.50');
    expect(reset.demoModes.wall.enabled).toBe(true);
    expect(reset.demoModes.gap.paddleHeight).toBe(0.9);
    expect(reset.demoModes.honing.paddleHeight).toBe(0.2);
    expect(reset.demoModes.honing.speed).toBe(0.7);
    expect(reset.demoModes.erratic.paddleHeight).toBe(0.3);
    expect(reset.demoModes.erratic.speed).toBe(1.0);
    expect(ArenaConfigSchema.safeParse(reset).success).toBe(true);
  });
});

describe('AdminAuthService', () => {
  it('supports one-time passcode setup, login verification, and token revocation', () => {
    const auth = new AdminAuthService();
    expect(auth.needsSetup()).toBe(true);

    expect(auth.setupPasscode('short').ok).toBe(false);
    const setupRes = auth.setupPasscode('super-secret-pass');
    expect(setupRes.ok).toBe(true);
    if (!setupRes.ok) return;

    expect(auth.needsSetup()).toBe(false);
    expect(auth.verifyToken(setupRes.token)).toBe(true);
    expect(auth.setupPasscode('another-pass').ok).toBe(false);

    expect(auth.login('wrong-pass').ok).toBe(false);
    const loginRes = auth.login('super-secret-pass');
    expect(loginRes.ok).toBe(true);
    if (!loginRes.ok) return;
    expect(auth.verifyToken(loginRes.token)).toBe(true);

    auth.revokeToken(loginRes.token);
    expect(auth.verifyToken(loginRes.token)).toBe(false);
  });

  it('uses ADMIN_PASSCODE when configured via environment', () => {
    const auth = new AdminAuthService('env-passcode-123');
    expect(auth.needsSetup()).toBe(false);
    expect(auth.isUsingEnvPasscode()).toBe(true);
    expect(auth.setupPasscode('override').ok).toBe(false);
    expect(auth.login('wrong').ok).toBe(false);
    const res = auth.login('env-passcode-123');
    expect(res.ok).toBe(true);
  });
});
