import crypto from 'node:crypto';
import {
  BALL_INITIAL_SPEED,
  BALL_MAX_SPEED,
  BALL_SPEED_INCREMENT,
  CHALLENGE_EXPIRY_MS,
  DEMO_AUTO_MOVE,
  DEMO_PADDLE_HEIGHT,
  DEMO_PADDLE_SPEED,
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
  MatchRulesConfig,
  PaddleSide,
  PublicArenaConfig,
} from '../../../shared/src/types.ts';
import { ArenaConfigSchema, validateHostIpInput } from '../../../shared/src/validation.ts';

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
    demoPaddleHeight: DEMO_PADDLE_HEIGHT,
    demoAutoMove: DEMO_AUTO_MOVE,
    demoPaddleSpeed: DEMO_PADDLE_SPEED,
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
    return { ...this.config };
  }

  getPublicConfig(): PublicArenaConfig {
    const { hostIp: _hostIp, ...rest } = this.config;
    return rest;
  }

  getHostIp(): string {
    return this.config.hostIp;
  }

  buildMatchRules(demoSide: PaddleSide | null): MatchRulesConfig {
    const isDemoMatch = demoSide !== null;
    const demoAutoMove =
      isDemoMatch && this.config.demoPaddleHeight < 1.0 && this.config.demoAutoMove;
    return {
      paddleHeight: this.config.paddleHeight,
      leftPaddleHeight: demoSide === 'left' ? this.config.demoPaddleHeight : this.config.paddleHeight,
      rightPaddleHeight:
        demoSide === 'right' ? this.config.demoPaddleHeight : this.config.paddleHeight,
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
      demoAutoMove,
      demoPaddleSpeed: this.config.demoPaddleSpeed,
    };
  }

  updateConfig(
    raw: unknown,
  ): { ok: true; config: ArenaConfig } | { ok: false; error: string } {
    let merged: unknown = raw;
    if (typeof raw === 'object' && raw !== null) {
      const incoming = raw as Record<string, unknown>;
      const combined: Record<string, unknown> = { ...this.config, ...incoming };
      if (
        typeof combined.demoPaddleHeight === 'number' &&
        combined.demoPaddleHeight >= 1.0 &&
        incoming.demoAutoMove === undefined
      ) {
        combined.demoAutoMove = false;
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
