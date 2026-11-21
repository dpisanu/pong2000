import fs from 'node:fs';
import os from 'node:os';
import express, { type Express, type Request, type Response } from 'express';
import { MAX_AVATAR_BYTES } from '../../../shared/src/constants.ts';
import { AvatarUploadError, type AvatarService } from '../avatars/avatarService.ts';
import { AdminAuthService, ServerConfigService } from '../config/serverConfig.ts';
import type { MatchManager } from '../matches/matchManager.ts';
import type { SessionManager } from '../sessions/sessionManager.ts';
import { isOriginAllowed } from '../ws/wsGateway.ts';

export interface CreateAppOptions {
  avatarService: AvatarService;
  sessions: SessionManager;
  getMatchManager: () => MatchManager;
  port: number;
  publicUrl?: string;
  configService?: ServerConfigService;
  adminAuth?: AdminAuthService;
  onConfigUpdated?: () => void;
  allowedOrigins?: string[];
  startedAt?: number;
}

function isRfc1918Block172(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  return parts.length === 4 && parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
}

function isPrivateLanIpv4(ip: string): boolean {
  return ip.startsWith('192.168.') || ip.startsWith('10.') || isRfc1918Block172(ip);
}

function isLoopbackHost(hostHeader: string): boolean {
  const hostname = hostHeader.replace(/:\d+$/, '').toLowerCase();
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}

export function formatConfiguredHostUrl(rawHost: string, port: number): string {
  const trimmed = rawHost.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  if (trimmed.includes(':')) {
    return `http://${trimmed}`;
  }
  return `http://${trimmed}:${port}`;
}

export function isRunningInContainer(): boolean {
  try {
    return fs.existsSync('/.dockerenv');
  } catch {
    return false;
  }
}

export function getLanUrls(
  port: number,
  explicitPublicUrl?: string,
  requestHost?: string | null,
  requestProtocol = 'http',
  inContainer = isRunningInContainer(),
): string[] {
  const urls: string[] = [];
  if (explicitPublicUrl) {
    const formatted = formatConfiguredHostUrl(explicitPublicUrl, port);
    if (formatted) {
      urls.push(formatted);
    }
  }

  if (requestHost && !isLoopbackHost(requestHost)) {
    const origin = `${requestProtocol}://${requestHost}`.replace(/\/+$/, '');
    if (!urls.includes(origin)) {
      urls.push(origin);
    }
  }

  const preferredLanUrls: string[] = [];
  const otherUrls: string[] = [];
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family !== 'IPv4' || entry.internal || entry.address.startsWith('169.254.')) {
        continue;
      }
      // Inside Docker bridge networking, 172.16.0.0/12 is typically the container's internal bridge IP, not the LAN host IP
      if (inContainer && isRfc1918Block172(entry.address)) {
        continue;
      }
      const candidate = `http://${entry.address}:${port}`;
      if (isPrivateLanIpv4(entry.address)) {
        if (!preferredLanUrls.includes(candidate)) preferredLanUrls.push(candidate);
      } else {
        if (!otherUrls.includes(candidate)) otherUrls.push(candidate);
      }
    }
  }
  for (const candidate of [...preferredLanUrls, ...otherUrls]) {
    if (!urls.includes(candidate)) {
      urls.push(candidate);
    }
  }
  return urls;
}

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice('Bearer '.length).trim() || null;
}

export function createApp(options: CreateAppOptions): Express {
  const app = express();
  const startedAt = options.startedAt ?? Date.now();
  const allowedOrigins = options.allowedOrigins ?? [];
  const configService = options.configService ?? new ServerConfigService(options.publicUrl ?? '');
  const adminAuth = options.adminAuth ?? new AdminAuthService(process.env.ADMIN_PASSCODE);

  app.disable('x-powered-by');

  const resolveServerInfo = (req: Request) => {
    const forwardedProto = req.headers['x-forwarded-proto'];
    const protocol =
      (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto) ||
      req.protocol ||
      'http';
    const forwardedHost = req.headers['x-forwarded-host'];
    const host =
      (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) ||
      req.get('host') ||
      null;
    const inContainer = isRunningInContainer();
    const configuredHost = configService.getHostIp() || options.publicUrl;
    const lanUrls = getLanUrls(options.port, configuredHost, host, protocol, inContainer);
    const requestOrigin = host ? `${protocol}://${host}` : null;
    return {
      lanUrls,
      primaryUrl: lanUrls[0] ?? requestOrigin ?? `http://localhost:${options.port}`,
      port: options.port,
      isContainer: inContainer,
      hasConfiguredHostIp: Boolean(configService.getHostIp()),
      ipDetected: lanUrls.length > 0,
    };
  };

  app.get('/healthz', (_req: Request, res: Response) => {
    const activePlayers = options.sessions.getConnectedHumanCount();
    const activeMatches = options.getMatchManager().getActiveMatchCount();
    res.json({
      status: 'ok',
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      activePlayers,
      activeMatches,
    });
  });

  app.get('/api/server-info', (req: Request, res: Response) => {
    res.json(resolveServerInfo(req));
  });

  app.get('/api/config', (_req: Request, res: Response) => {
    res.json(configService.getPublicConfig());
  });

  // Admin status & authentication endpoints
  app.get('/api/admin/status', (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    res.json({
      needsSetup: adminAuth.needsSetup(),
      usesEnvPasscode: adminAuth.isUsingEnvPasscode(),
      authenticated: adminAuth.verifyToken(token),
    });
  });

  app.post('/api/admin/setup', express.json({ limit: '4kb' }), (req: Request, res: Response) => {
    if (!isOriginAllowed(req, allowedOrigins)) {
      res.status(403).json({ error: 'Cross-origin admin request rejected.' });
      return;
    }
    const result = adminAuth.setupPasscode(req.body?.passcode);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.status(201).json({ token: result.token });
  });

  const loginAttempts = new Map<string, { count: number; resetAt: number }>();

  app.post('/api/admin/login', express.json({ limit: '4kb' }), (req: Request, res: Response) => {
    if (!isOriginAllowed(req, allowedOrigins)) {
      res.status(403).json({ error: 'Cross-origin admin request rejected.' });
      return;
    }
    const clientKey = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const record = loginAttempts.get(clientKey);
    if (record && record.resetAt > now && record.count >= 8) {
      res.status(429).json({ error: 'Too many failed login attempts. Try again in a minute.' });
      return;
    }

    const result = adminAuth.login(req.body?.passcode);
    if (!result.ok) {
      if (!record || record.resetAt <= now) {
        loginAttempts.set(clientKey, { count: 1, resetAt: now + 60_000 });
      } else {
        record.count += 1;
      }
      res.status(result.status).json({ error: result.error });
      return;
    }
    loginAttempts.delete(clientKey);
    res.json({ token: result.token });
  });

  app.post('/api/admin/logout', (req: Request, res: Response) => {
    if (!isOriginAllowed(req, allowedOrigins)) {
      res.status(403).json({ error: 'Cross-origin admin request rejected.' });
      return;
    }
    const token = extractBearerToken(req);
    adminAuth.revokeToken(token);
    res.json({ ok: true });
  });

  const requireAdmin = (req: Request, res: Response): boolean => {
    if (!isOriginAllowed(req, allowedOrigins)) {
      res.status(403).json({ error: 'Cross-origin admin request rejected.' });
      return false;
    }
    const token = extractBearerToken(req);
    if (!adminAuth.verifyToken(token)) {
      res.status(401).json({ error: 'Admin authentication required.' });
      return false;
    }
    return true;
  };

  app.get('/api/admin/config', (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    res.json({
      config: configService.getConfig(),
      serverInfo: resolveServerInfo(req),
    });
  });

  app.put('/api/admin/config', express.json({ limit: '16kb' }), (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const updated = configService.updateConfig(req.body);
    if (!updated.ok) {
      res.status(400).json({ error: updated.error });
      return;
    }
    options.onConfigUpdated?.();
    res.json({
      config: updated.config,
      serverInfo: resolveServerInfo(req),
    });
  });

  app.post('/api/admin/config/reset', (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const config = configService.resetConfig();
    options.onConfigUpdated?.();
    res.json({
      config,
      serverInfo: resolveServerInfo(req),
    });
  });

  app.post(
    '/api/avatars',
    express.raw({
      type: ['image/png', 'image/jpeg', 'image/webp', 'application/octet-stream'],
      limit: MAX_AVATAR_BYTES + 4096,
    }),
    async (req: Request, res: Response) => {
      try {
        if (!isOriginAllowed(req, allowedOrigins)) {
          res.status(403).json({ error: 'Cross-origin avatar upload rejected.' });
          return;
        }

        const token = extractBearerToken(req);
        if (!token) {
          res.status(401).json({ error: 'Missing session authorization header.' });
          return;
        }

        const session = options.sessions.getByUploadToken(token);
        if (!session) {
          res.status(401).json({ error: 'Invalid or expired session upload token.' });
          return;
        }

        if (!Buffer.isBuffer(req.body)) {
          res.status(415).json({ error: 'Upload body must be a PNG, JPEG, or WebP image.' });
          return;
        }

        const result = await options.avatarService.processAndStoreUpload(
          session.playerId,
          req.body,
        );
        res.status(201).json(result);
      } catch (err) {
        if (err instanceof AvatarUploadError) {
          res.status(err.statusCode).json({ error: err.message });
          return;
        }
        res.status(500).json({ error: 'Failed to process uploaded avatar.' });
      }
    },
  );

  // Explicit payload-too-large / JSON error handler for express.raw / express.json
  app.use((err: unknown, _req: Request, res: Response, next: (e?: unknown) => void) => {
    if (
      typeof err === 'object' &&
      err !== null &&
      'type' in err &&
      (err as { type?: string }).type === 'entity.too.large'
    ) {
      res.status(413).json({ error: 'Request payload exceeds the allowed size limit.' });
      return;
    }
    if (err instanceof SyntaxError && 'status' in err && (err as { status?: number }).status === 400) {
      res.status(400).json({ error: 'Malformed JSON body.' });
      return;
    }
    next(err);
  });

  app.get('/api/avatars/:id', async (req: Request, res: Response) => {
    const id = req.params.id;
    if (typeof id !== 'string') {
      res.status(400).end();
      return;
    }
    const buf = await options.avatarService.getAvatarBuffer(id);
    if (!buf) {
      res.status(404).json({ error: 'Avatar not found.' });
      return;
    }
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(buf);
  });

  return app;
}
