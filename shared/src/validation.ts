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
