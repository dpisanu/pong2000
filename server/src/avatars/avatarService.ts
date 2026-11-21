import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { AVATAR_OUTPUT_SIZE, MAX_AVATAR_BYTES } from '../../../shared/src/constants.ts';

const VALID_KEY_REGEX = /^av_[a-f0-9]{32}$/;
const ALLOWED_FORMATS = new Set(['png', 'jpeg', 'webp']);
const MAX_UPLOAD_TIMESTAMPS_PER_WINDOW = 6;
const UPLOAD_RATE_WINDOW_MS = 60_000;
const MAX_STORED_AVATARS_PER_SESSION = 2;

export class AvatarUploadError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export class AvatarService {
  readonly storageDir: string;
  private readonly sessionRateMap = new Map<string, number[]>();
  private readonly sessionOwnedKeys = new Map<string, string[]>();

  constructor(storageDir: string) {
    this.storageDir = path.resolve(storageDir);
  }

  async init(): Promise<void> {
    await fs.mkdir(this.storageDir, { recursive: true });
  }

  private resolveSafePath(key: string): string | null {
    if (!VALID_KEY_REGEX.test(key)) return null;
    const resolved = path.resolve(this.storageDir, `${key}.webp`);
    if (!resolved.startsWith(this.storageDir + path.sep)) {
      return null;
    }
    return resolved;
  }

  async avatarExists(key: string): Promise<boolean> {
    const filePath = this.resolveSafePath(key);
    if (!filePath) return false;
    try {
      const stat = await fs.stat(filePath);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  async getAvatarBuffer(key: string): Promise<Buffer | null> {
    const filePath = this.resolveSafePath(key);
    if (!filePath) return null;
    try {
      return await fs.readFile(filePath);
    } catch {
      return null;
    }
  }

  async deleteAvatar(key: string): Promise<void> {
    const filePath = this.resolveSafePath(key);
    if (!filePath) return;
    try {
      await fs.unlink(filePath);
    } catch {
      // Ignore already-deleted files
    }
  }

  private checkRateLimit(sessionId: string, now: number): void {
    const existing = this.sessionRateMap.get(sessionId) ?? [];
    const recent = existing.filter((ts) => now - ts < UPLOAD_RATE_WINDOW_MS);
    if (recent.length >= MAX_UPLOAD_TIMESTAMPS_PER_WINDOW) {
      this.sessionRateMap.set(sessionId, recent);
      throw new AvatarUploadError(
        429,
        'Too many avatar uploads. Please wait a minute before uploading again.',
      );
    }
    recent.push(now);
    this.sessionRateMap.set(sessionId, recent);
  }

  async processAndStoreUpload(
    sessionId: string,
    rawBuffer: Buffer,
  ): Promise<{ key: string; avatarId: string; avatarUrl: string }> {
    const now = Date.now();
    this.checkRateLimit(sessionId, now);

    if (!Buffer.isBuffer(rawBuffer) || rawBuffer.length === 0) {
      throw new AvatarUploadError(400, 'Uploaded image is empty.');
    }
    if (rawBuffer.length > MAX_AVATAR_BYTES) {
      throw new AvatarUploadError(413, 'Image exceeds the 1 MiB upload limit.');
    }

    // Quick rejection for SVG/XML payloads before invoking native decoder
    const headText = rawBuffer.subarray(0, 256).toString('utf8').trimStart().toLowerCase();
    if (headText.startsWith('<svg') || headText.startsWith('<?xml')) {
      throw new AvatarUploadError(415, 'SVG files are not allowed. Upload PNG, JPEG, or WebP.');
    }

    let processed: Buffer;
    try {
      const pipeline = sharp(rawBuffer, {
        failOn: 'error',
        limitInputPixels: 16_777_216, // 4096 x 4096 max input
      });
      const metadata = await pipeline.metadata();
      if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) {
        throw new AvatarUploadError(
          415,
          'Unsupported image format. Please upload a valid PNG, JPEG, or WebP file.',
        );
      }
      if (!metadata.width || !metadata.height || metadata.width < 16 || metadata.height < 16) {
        throw new AvatarUploadError(400, 'Image dimensions are too small (minimum 16x16 px).');
      }

      processed = await pipeline
        .rotate()
        .resize(AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE, {
          fit: 'cover',
          position: 'centre',
        })
        .webp({ quality: 84 })
        .toBuffer();
    } catch (err) {
      if (err instanceof AvatarUploadError) throw err;
      throw new AvatarUploadError(
        400,
        'Could not decode image. Ensure it is a valid PNG, JPEG, or WebP file.',
      );
    }

    const key = `av_${crypto.randomBytes(16).toString('hex')}`;
    const targetPath = this.resolveSafePath(key);
    if (!targetPath) {
      throw new AvatarUploadError(500, 'Failed to allocate avatar storage path.');
    }

    await fs.writeFile(targetPath, processed);

    // Enforce bounded per-session avatar count, removing obsolete files
    const owned = this.sessionOwnedKeys.get(sessionId) ?? [];
    owned.push(key);
    while (owned.length > MAX_STORED_AVATARS_PER_SESSION) {
      const oldest = owned.shift();
      if (oldest) {
        await this.deleteAvatar(oldest);
      }
    }
    this.sessionOwnedKeys.set(sessionId, owned);

    return {
      key,
      avatarId: `uploaded:${key}`,
      avatarUrl: `/api/avatars/${key}`,
    };
  }

  releaseSessionTracking(sessionId: string): void {
    this.sessionRateMap.delete(sessionId);
    this.sessionOwnedKeys.delete(sessionId);
  }
}
