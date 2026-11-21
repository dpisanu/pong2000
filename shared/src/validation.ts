import { z } from 'zod';
import {
  BUNDLED_AVATARS,
  DEFAULT_AVATAR_ID,
  DEFAULT_AVATAR_URL,
  MAX_NICKNAME_LENGTH,
  MIN_NICKNAME_LENGTH,
} from './constants.ts';

const BUNDLED_MAP = new Map<string, string>(
  BUNDLED_AVATARS.map((a) => [a.id, a.url]),
);

const UPLOADED_ID_REGEX = /^uploaded:([a-zA-Z0-9_-]{8,64})$/;

export function sanitizeNickname(
  raw: unknown,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Nickname must be a string.' };
  }
  // Remove control characters and collapse runs of whitespace
  const cleaned = raw
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .replace(/\s+/g, ' ');

  const charLength = Array.from(cleaned).length;
  if (charLength < MIN_NICKNAME_LENGTH) {
    return { ok: false, error: 'Nickname must contain at least 1 visible character.' };
  }
  if (charLength > MAX_NICKNAME_LENGTH) {
    return {
      ok: false,
      error: `Nickname must be at most ${MAX_NICKNAME_LENGTH} characters.`,
    };
  }
  return { ok: true, value: cleaned };
}

export function isValidBundledAvatarId(avatarId: string): boolean {
  return BUNDLED_MAP.has(avatarId);
}

export function extractUploadedAvatarKey(avatarId: string): string | null {
  const match = UPLOADED_ID_REGEX.exec(avatarId);
  return match ? match[1] : null;
}

export function isValidAvatarId(avatarId: unknown): avatarId is string {
  if (typeof avatarId !== 'string') return false;
  return isValidBundledAvatarId(avatarId) || UPLOADED_ID_REGEX.test(avatarId);
}

export function resolveAvatarUrl(avatarId: string): string {
  const bundled = BUNDLED_MAP.get(avatarId);
  if (bundled) return bundled;

  const uploadedKey = extractUploadedAvatarKey(avatarId);
  if (uploadedKey) {
    return `/api/avatars/${uploadedKey}`;
  }

  return DEFAULT_AVATAR_URL;
}

export function fallbackAvatarId(): string {
  return DEFAULT_AVATAR_ID;
}

export function validateHostIpInput(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) {
    return { ok: true, value: '' };
  }
  if (/[\s<>"'`\\]/.test(trimmed)) {
    return { ok: false, error: 'Host IP / URL cannot contain spaces or special characters.' };
  }

  const candidateUrl =
    trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? trimmed
      : `http://${trimmed}`;

  try {
    const parsed = new URL(candidateUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: 'Only http:// or https:// host addresses are supported.' };
    }
    if (!parsed.hostname || parsed.username || parsed.password) {
      return { ok: false, error: 'Enter a valid IPv4 address, hostname, or URL.' };
    }
    if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
      return { ok: false, error: 'Host address should not contain paths or query strings.' };
    }
    return { ok: true, value: trimmed };
  } catch {
    return { ok: false, error: 'Enter a valid IPv4 address, hostname, or URL (e.g. 192.168.1.42).' };
  }
}

export const ArenaConfigSchema = z
  .object({
    paddleHeight: z.number().min(0.08).max(0.45),
    paddleSpeed: z.number().min(0.3).max(2.5),
    ballInitialSpeed: z.number().min(0.3).max(1.8),
    ballSpeedIncrement: z.number().min(0).max(0.25),
    ballMaxSpeed: z.number().min(0.5).max(3.0),
    winScore: z.number().int().min(1).max(21),
    initialCountdownMs: z.number().int().min(1000).max(10_000),
    pointCountdownMs: z.number().int().min(500).max(5_000),
    resumeCountdownMs: z.number().int().min(500).max(5_000),
    challengeExpiryMs: z.number().int().min(5_000).max(120_000),
    disconnectGraceMs: z.number().int().min(3_000).max(60_000),
    hostIp: z.string().max(128),
  })
  .superRefine((val, ctx) => {
    if (val.ballMaxSpeed < val.ballInitialSpeed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ballMaxSpeed'],
        message: 'Max ball speed must be greater than or equal to initial ball speed.',
      });
    }
    const hostCheck = validateHostIpInput(val.hostIp);
    if (!hostCheck.ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['hostIp'],
        message: hostCheck.error,
      });
    }
  });

