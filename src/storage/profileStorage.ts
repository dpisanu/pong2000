import type { DemoModePreference } from '../../shared/src/types.ts';
import { normalizeDemoModePreference } from '../../shared/src/validation.ts';

const STORAGE_KEY = 'lan_pong_profile_v1';

export interface StoredProfile {
  nickname: string;
  avatarId: string;
  demoModePreference?: DemoModePreference;
  recoveryToken?: string;
}

export function loadStoredProfile(): StoredProfile | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredProfile>;
    if (typeof parsed.nickname !== 'string' || typeof parsed.avatarId !== 'string') {
      return null;
    }
    return {
      nickname: parsed.nickname,
      avatarId: parsed.avatarId,
      demoModePreference: normalizeDemoModePreference(parsed.demoModePreference),
      recoveryToken:
        typeof parsed.recoveryToken === 'string' ? parsed.recoveryToken : undefined,
    };
  } catch {
    return null;
  }
}

export function saveStoredProfile(profile: StoredProfile): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Ignore storage quota / private mode failures
  }
}

export function updateStoredRecoveryToken(recoveryToken: string): void {
  const current = loadStoredProfile();
  if (!current) return;
  saveStoredProfile({
    ...current,
    recoveryToken,
  });
}
