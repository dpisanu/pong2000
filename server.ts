import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { AvatarService } from './server/src/avatars/avatarService.ts';
import { AdminAuthService, ServerConfigService } from './server/src/config/serverConfig.ts';
import { createApp, getLanUrls } from './server/src/http/createApp.ts';
import { LeaderboardService } from './server/src/leaderboard/leaderboardService.ts';
import { SessionManager } from './server/src/sessions/sessionManager.ts';
import { WsGateway } from './server/src/ws/wsGateway.ts';

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '0.0.0.0';
  const avatarStorageDir =
    process.env.AVATAR_STORAGE_DIR ?? path.resolve(process.cwd(), 'data/avatars');
  const publicUrl = process.env.PUBLIC_URL?.trim() || undefined;
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const avatarService = new AvatarService(avatarStorageDir);
  await avatarService.init();

  const configService = new ServerConfigService(publicUrl ?? '');
  const adminAuth = new AdminAuthService(process.env.ADMIN_PASSCODE);
  const leaderboard = new LeaderboardService();
  const sessions = new SessionManager();
  let gateway: WsGateway | null = null;

  const app = createApp({
    avatarService,
    sessions,
    getMatchManager: () => {
      if (!gateway) {
        throw new Error('Gateway not initialized');
      }
      return gateway.matches;
    },
    port,
    publicUrl,
    configService,
    adminAuth,
    leaderboard,
    onConfigUpdated: () => {
      gateway?.applyRuntimeConfigUpdate();
    },
    allowedOrigins,
  });

  const server = http.createServer(app);
  gateway = new WsGateway({
    server,
    sessions,
    avatarService,
    configService,
    leaderboard,
    allowedOrigins,
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('/{*path}', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path === '/ws' || req.path === '/healthz') {
        next();
        return;
      }
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(port, host, () => {
    const urls = getLanUrls(port, publicUrl);
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'server.listening',
        host,
        port,
        urls,
      }),
    );
  });

  const shutdown = (signal: string) => {
    console.log(JSON.stringify({ level: 'info', event: 'server.shutdown', signal }));
    gateway?.closeAll('Arena server is shutting down.');
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
