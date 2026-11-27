import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadStoredProfile,
  saveStoredProfile,
  updateStoredRecoveryToken,
} from '../../src/client/storage/profileStorage.ts';

function createMemoryLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

describe('profileStorage', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      localStorage: createMemoryLocalStorage(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null when storage is empty or malformed', () => {
    expect(loadStoredProfile()).toBeNull();

    window.localStorage.setItem('lan_pong_profile_v1', '{not-json');
    expect(loadStoredProfile()).toBeNull();

    window.localStorage.setItem('lan_pong_profile_v1', JSON.stringify({ nickname: 123 }));
    expect(loadStoredProfile()).toBeNull();
  });

  it('saves and loads profile data while normalizing unknown demoModePreference values', () => {
    saveStoredProfile({
      nickname: 'NeonPaddle',
      avatarId: 'gallery:ace-paddle',
      demoModePreference: 'honing',
      recoveryToken: 'token-123',
    });

    expect(loadStoredProfile()).toEqual({
      nickname: 'NeonPaddle',
      avatarId: 'gallery:ace-paddle',
      demoModePreference: 'honing',
      recoveryToken: 'token-123',
    });

    window.localStorage.setItem(
      'lan_pong_profile_v1',
      JSON.stringify({
        nickname: 'FallbackPlayer',
        avatarId: 'gallery:rally-fox',
        demoModePreference: 'unknown-mode',
      }),
    );

    expect(loadStoredProfile()).toEqual({
      nickname: 'FallbackPlayer',
      avatarId: 'gallery:rally-fox',
      demoModePreference: 'default',
      recoveryToken: undefined,
    });
  });

  it('updates recoveryToken without overwriting existing profile fields', () => {
    updateStoredRecoveryToken('orphan-token');
    expect(loadStoredProfile()).toBeNull();

    saveStoredProfile({
      nickname: 'SpinMaster',
      avatarId: 'gallery:spin-owl',
      demoModePreference: 'swipe',
      recoveryToken: 'old-token',
    });

    updateStoredRecoveryToken('new-token');
    expect(loadStoredProfile()).toEqual({
      nickname: 'SpinMaster',
      avatarId: 'gallery:spin-owl',
      demoModePreference: 'swipe',
      recoveryToken: 'new-token',
    });
  });
});
