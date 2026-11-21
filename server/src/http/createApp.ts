import os from 'node:os';
import express, { type Express, type Request, type Response } from 'express';
import { MAX_AVATAR_BYTES } from '../../../shared/src/constants.ts';
import { AvatarUploadError, type AvatarService } from '../avatars/avatarService.ts';
import type { MatchManager } from '../matches/matchManager.ts';
import type { SessionManager } from '../sessions/sessionManager.ts';
import { isOriginAllowed } from '../ws/wsGateway.ts';

export interface CreateAppOptions {
  avatarService: AvatarService;
  sessions: SessionManager;
  getMatchManager: () => MatchManager;
  port: number;
  publicUrl?: string;
  allowedOrigins?: string[];
  startedAt?: number;
}

function isPrivateLanIpv4(ip: string): boolean {
  if (ip.startsWith('192.168.') || ip.startsWith('10.')) return true;
  const parts = ip.split('.').map(Number);
  return parts.length === 4 && parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
}

export function getLanUrls(port: number, explicitPublicUrl?: string): string[] {
  const urls: string[] = [];
  if (explicitPublicUrl) {
    urls.push(explicitPublicUrl.replace(/\/+$/, ''));
  }

  const privateUrls: string[] = [];
  const otherUrls: string[] = [];
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.')) {
        const candidate = `http://${entry.address}:${port}`;
        if (isPrivateLanIpv4(entry.address)) {
          if (!privateUrls.includes(candidate)) privateUrls.push(candidate);
        } else {
          if (!otherUrls.includes(candidate)) otherUrls.push(candidate);
        }
      }
    }
  }
  for (const candidate of [...privateUrls, ...otherUrls]) {
    if (!urls.includes(candidate)) {
      urls.push(candidate);
    }
  }
  return urls;
}

export function createApp(options: CreateAppOptions): Express {
  const app = express();
  const startedAt = options.startedAt ?? Date.now();
  const allowedOrigins = options.allowedOrigins ?? [];

  app.disable('x-powered-by');

  app.get('/healthz', (_req: Request, res: Response) => {
    const activePlayers = options.sessions
      .getAllSessions()
      .filter((s) => s.connected).length;
    const activeMatches = options.getMatchManager().getActiveMatchCount();
    res.json({
      status: 'ok',
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      activePlayers,
      activeMatches,
    });
  });

  app.get('/api/server-info', (req: Request, res: Response) => {
    const protocol = req.protocol || 'http';
    const host = req.get('host');
    const requestOrigin = host ? `${protocol}://${host}` : null;
    const lanUrls = getLanUrls(options.port, options.publicUrl);
    res.json({
      lanUrls,
      primaryUrl: lanUrls[0] ?? requestOrigin ?? `http://localhost:${options.port}`,
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

        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          res.status(401).json({ error: 'Missing session authorization header.' });
          return;
        }

        const token = authHeader.slice('Bearer '.length).trim();
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

  // Explicit payload-too-large / JSON error handler for express.raw
  app.use((err: unknown, _req: Request, res: Response, next: (e?: unknown) => void) => {
    if (
      typeof err === 'object' &&
      err !== null &&
      'type' in err &&
      (err as { type?: string }).type === 'entity.too.large'
    ) {
      res.status(413).json({ error: 'Image exceeds the 1 MiB upload limit.' });
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
