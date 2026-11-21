import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_AVATAR_BYTES } from '../../shared/src/constants.ts';
import { isValidAvatarId, resolveAvatarUrl, sanitizeNickname } from '../../shared/src/validation.ts';
import { AvatarService, AvatarUploadError } from '../../server/src/avatars/avatarService.ts';
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
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lan-pong-avatars-'));
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
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lan-pong-avatars-'));
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
