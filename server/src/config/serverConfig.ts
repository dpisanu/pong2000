import crypto from 'node:crypto';
import {
  BALL_INITIAL_SPEED,
  BALL_MAX_SPEED,
  BALL_SPEED_INCREMENT,
  CHALLENGE_EXPIRY_MS,
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
  DISCONNECT_GRACE_MS,
  INITIAL_COUNTDOWN_MS,
  PADDLE_HEIGHT,
  PADDLE_SPEED,
  POINT_COUNTDOWN_MS,
  RESUME_COUNTDOWN_MS,
  WIN_SCORE,
} from '../../../shared/src/constants.ts';
import type {
  ArenaConfig,
  DemoBehaviorMode,
  DemoModesConfig,
  MatchRulesConfig,
  PaddleSide,
  PublicArenaConfig,
} from '../../../shared/src/types.ts';
import { ArenaConfigSchema, validateHostIpInput } from '../../../shared/src/validation.ts';

function cloneDemoModes(modes: DemoModesConfig): DemoModesConfig {
  return {
    wall: { ...modes.wall },
    gap: { ...modes.gap },
    honing: { ...modes.honing },
    swipe: { ...modes.swipe },
    erratic: { ...modes.erratic },
  };
}

export function buildDefaultDemoModes(): DemoModesConfig {
  return {
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
  };
}

export function getEnabledDemoModes(demoModes: DemoModesConfig): DemoBehaviorMode[] {
  const enabled: DemoBehaviorMode[] = [];
  if (demoModes.wall.enabled) enabled.push('wall');
  if (demoModes.gap.enabled) enabled.push('gap');
  if (demoModes.honing.enabled) enabled.push('honing');
  if (demoModes.swipe.enabled) enabled.push('swipe');
  if (demoModes.erratic.enabled) enabled.push('erratic');
  return enabled.length > 0 ? enabled : ['wall'];
}

export function buildDefaultArenaConfig(initialHostIp = ''): ArenaConfig {
  return {
    paddleHeight: PADDLE_HEIGHT,
    paddleSpeed: PADDLE_SPEED,
    ballInitialSpeed: BALL_INITIAL_SPEED,
    ballSpeedIncrement: BALL_SPEED_INCREMENT,
    ballMaxSpeed: BALL_MAX_SPEED,
    winScore: WIN_SCORE,
    initialCountdownMs: INITIAL_COUNTDOWN_MS,
    pointCountdownMs: POINT_COUNTDOWN_MS,
    resumeCountdownMs: RESUME_COUNTDOWN_MS,
    challengeExpiryMs: CHALLENGE_EXPIRY_MS,
    disconnectGraceMs: DISCONNECT_GRACE_MS,
    demoModes: buildDefaultDemoModes(),
    hostIp: initialHostIp,
  };
}

export class ServerConfigService {
  private config: ArenaConfig;
  private readonly initialHostIp: string;

  constructor(initialHostIp = '') {
    const validated = validateHostIpInput(initialHostIp);
    this.initialHostIp = validated.ok ? validated.value : '';
    this.config = buildDefaultArenaConfig(this.initialHostIp);
  }

  getConfig(): ArenaConfig {
    return {
      ...this.config,
      demoModes: cloneDemoModes(this.config.demoModes),
    };
  }

  getPublicConfig(): PublicArenaConfig {
    const { hostIp: _hostIp, ...rest } = this.config;
    return {
      ...rest,
      demoModes: cloneDemoModes(this.config.demoModes),
    };
  }

  getHostIp(): string {
    return this.config.hostIp;
  }

  buildMatchRules(
    demoSide: PaddleSide | null,
    rng: () => number = Math.random,
  ): MatchRulesConfig {
    const isDemoMatch = demoSide !== null;
    let demoMode: DemoBehaviorMode | null = null;
    let demoHeight = this.config.paddleHeight;
    let demoSpeed = 0;

    if (isDemoMatch) {
      const enabledModes = getEnabledDemoModes(this.config.demoModes);
      const idx = Math.min(enabledModes.length - 1, Math.floor(rng() * enabledModes.length));
      demoMode = enabledModes[idx] ?? 'wall';

      switch (demoMode) {
        case 'wall':
          demoHeight = 1.0;
          demoSpeed = 0;
          break;
        case 'gap':
          demoHeight = this.config.demoModes.gap.paddleHeight;
          demoSpeed = 0;
          break;
        case 'honing':
          demoHeight = this.config.demoModes.honing.paddleHeight;
          demoSpeed = this.config.demoModes.honing.speed;
          break;
        case 'swipe':
          demoHeight = this.config.demoModes.swipe.paddleHeight;
          demoSpeed = this.config.demoModes.swipe.speed;
          break;
        case 'erratic':
          demoHeight = this.config.demoModes.erratic.paddleHeight;
          demoSpeed = this.config.demoModes.erratic.speed;
          break;
      }
    }

    return {
      paddleHeight: this.config.paddleHeight,
      leftPaddleHeight: demoSide === 'left' ? demoHeight : this.config.paddleHeight,
      rightPaddleHeight: demoSide === 'right' ? demoHeight : this.config.paddleHeight,
      paddleSpeed: this.config.paddleSpeed,
      ballInitialSpeed: this.config.ballInitialSpeed,
      ballSpeedIncrement: this.config.ballSpeedIncrement,
      ballMaxSpeed: this.config.ballMaxSpeed,
      winScore: this.config.winScore,
      initialCountdownMs: this.config.initialCountdownMs,
      pointCountdownMs: this.config.pointCountdownMs,
      resumeCountdownMs: this.config.resumeCountdownMs,
      isDemoMatch,
      demoSide,
      demoMode,
      demoPaddleSpeed: demoSpeed,
    };
  }

  updateConfig(
    raw: unknown,
  ): { ok: true; config: ArenaConfig } | { ok: false; error: string } {
    let merged: unknown = raw;
    if (typeof raw === 'object' && raw !== null) {
      const incoming = raw as Record<string, unknown>;
      const combined: Record<string, unknown> = { ...this.config, ...incoming };
      if (typeof incoming.demoModes === 'object' && incoming.demoModes !== null) {
        const incDemo = incoming.demoModes as Record<string, unknown>;
        combined.demoModes = {
          wall: {
            ...this.config.demoModes.wall,
            ...(typeof incDemo.wall === 'object' && incDemo.wall !== null
              ? (incDemo.wall as Record<string, unknown>)
              : {}),
          },
          gap: {
            ...this.config.demoModes.gap,
            ...(typeof incDemo.gap === 'object' && incDemo.gap !== null
              ? (incDemo.gap as Record<string, unknown>)
              : {}),
          },
          honing: {
            ...this.config.demoModes.honing,
            ...(typeof incDemo.honing === 'object' && incDemo.honing !== null
              ? (incDemo.honing as Record<string, unknown>)
              : {}),
          },
          swipe: {
            ...this.config.demoModes.swipe,
            ...(typeof incDemo.swipe === 'object' && incDemo.swipe !== null
              ? (incDemo.swipe as Record<string, unknown>)
              : {}),
          },
          erratic: {
            ...this.config.demoModes.erratic,
            ...(typeof incDemo.erratic === 'object' && incDemo.erratic !== null
              ? (incDemo.erratic as Record<string, unknown>)
              : {}),
          },
        };
      }
      merged = combined;
    }

    const parsed = ArenaConfigSchema.safeParse(merged);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      return {
        ok: false,
        error: firstIssue?.message || 'Invalid configuration payload.',
      };
    }

    const hostNormalized = validateHostIpInput(parsed.data.hostIp);
    if (!hostNormalized.ok) {
      return { ok: false, error: hostNormalized.error };
    }

    this.config = {
      ...parsed.data,
      demoModes: cloneDemoModes(parsed.data.demoModes),
      hostIp: hostNormalized.value,
    };
    return { ok: true, config: this.getConfig() };
  }

  resetConfig(): ArenaConfig {
    this.config = buildDefaultArenaConfig(this.initialHostIp);
    return this.getConfig();
  }
}

interface AdminSessionRecord {
  expiresAt: number;
}

const ADMIN_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

export class AdminAuthService {
  private readonly envPasscode: string | null;
  private claimedHash: { salt: Buffer; hash: Buffer } | null = null;
  private readonly tokens = new Map<string, AdminSessionRecord>();

  constructor(envPasscode?: string) {
    const trimmed = envPasscode?.trim() ?? '';
    this.envPasscode = trimmed.length > 0 ? trimmed : null;
  }

  needsSetup(): boolean {
    return this.envPasscode === null && this.claimedHash === null;
  }

  isUsingEnvPasscode(): boolean {
    return this.envPasscode !== null;
  }

  private issueToken(): string {
    this.pruneExpired();
    const token = `ad_${crypto.randomBytes(32).toString('base64url')}`;
    this.tokens.set(token, { expiresAt: Date.now() + ADMIN_TOKEN_TTL_MS });
    return token;
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [token, rec] of this.tokens.entries()) {
      if (rec.expiresAt <= now) {
        this.tokens.delete(token);
      }
    }
  }

  setupPasscode(passcode: unknown): { ok: true; token: string } | { ok: false; status: number; error: string } {
    if (this.envPasscode !== null) {
      return {
        ok: false,
        status: 409,
        error: 'Admin passcode is already configured via ADMIN_PASSCODE.',
      };
    }
    if (this.claimedHash !== null) {
      return {
        ok: false,
        status: 409,
        error: 'Admin passcode has already been claimed. Sign in instead.',
      };
    }
    if (typeof passcode !== 'string' || passcode.trim().length < 6 || passcode.length > 128) {
      return {
        ok: false,
        status: 400,
        error: 'Passcode must be between 6 and 128 characters.',
      };
    }

    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(passcode, salt, 64);
    this.claimedHash = { salt, hash };
    return { ok: true, token: this.issueToken() };
  }

  login(passcode: unknown): { ok: true; token: string } | { ok: false; status: number; error: string } {
    if (this.needsSetup()) {
      return {
        ok: false,
        status: 409,
        error: 'Admin passcode has not been set up yet.',
      };
    }
    if (typeof passcode !== 'string' || passcode.length === 0 || passcode.length > 128) {
      return { ok: false, status: 400, error: 'Passcode is required.' };
    }

    if (this.envPasscode !== null) {
      const providedDigest = crypto.createHash('sha256').update(passcode).digest();
      const expectedDigest = crypto.createHash('sha256').update(this.envPasscode).digest();
      if (!crypto.timingSafeEqual(providedDigest, expectedDigest)) {
        return { ok: false, status: 401, error: 'Incorrect admin passcode.' };
      }
      return { ok: true, token: this.issueToken() };
    }

    if (!this.claimedHash) {
      return { ok: false, status: 401, error: 'Admin passcode not initialized.' };
    }

    const derived = crypto.scryptSync(passcode, this.claimedHash.salt, 64);
    if (!crypto.timingSafeEqual(derived, this.claimedHash.hash)) {
      return { ok: false, status: 401, error: 'Incorrect admin passcode.' };
    }
    return { ok: true, token: this.issueToken() };
  }

  verifyToken(token: string | undefined | null): boolean {
    if (!token) return false;
    this.pruneExpired();
    const record = this.tokens.get(token);
    if (!record) return false;
    if (record.expiresAt <= Date.now()) {
      this.tokens.delete(token);
      return false;
    }
    return true;
  }

  revokeToken(token: string | undefined | null): void {
    if (token) {
      this.tokens.delete(token);
    }
  }
}
