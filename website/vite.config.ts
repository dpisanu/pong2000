import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import type { IncomingMessage, ServerResponse } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, type Plugin } from 'vite';

const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDir, '..');
const multiRoot = path.resolve(repoRoot, 'game/multi');
const avatarsDir = path.resolve(multiRoot, 'assets/avatars');
const videosDir = path.resolve(repoRoot, 'docs/videos');
const screenshotsDir = path.resolve(repoRoot, 'docs/screenshots');
const distDir = path.resolve(configDir, 'dist');

const MIME_TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.md': 'text/markdown; charset=utf-8',
};

function sendStaticFile(req: IncomingMessage, res: ServerResponse, filePath: string): boolean {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return false;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
  const stat = fs.statSync(filePath);
  const total = stat.size;
  const range = req.headers.range;

  if (range && ext === '.mp4') {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      const start = match[1] ? Number.parseInt(match[1], 10) : 0;
      const end = match[2] ? Math.min(Number.parseInt(match[2], 10), total - 1) : total - 1;
      if (start <= end && start < total) {
        res.statusCode = 206;
        res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Length', String(end - start + 1));
        res.setHeader('Content-Type', contentType);
        fs.createReadStream(filePath, { start, end }).pipe(res);
        return true;
      }
    }
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', String(total));
  if (ext === '.mp4') {
    res.setHeader('Accept-Ranges', 'bytes');
  }
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function attachSharedMediaMiddleware(middlewares: {
  use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void;
}) {
  middlewares.use((req, res, next) => {
    const rawUrl = (req.url ?? '/').split('?')[0];
    let targetPath: string | null = null;

    if (rawUrl.startsWith('/avatars/')) {
      const rel = rawUrl.slice('/avatars/'.length);
      const candidate = path.resolve(avatarsDir, rel);
      if (candidate.startsWith(avatarsDir + path.sep)) targetPath = candidate;
    } else if (rawUrl.startsWith('/media/videos/')) {
      const rel = rawUrl.slice('/media/videos/'.length);
      const candidate = path.resolve(videosDir, rel);
      if (candidate.startsWith(videosDir + path.sep)) targetPath = candidate;
    } else if (rawUrl.startsWith('/media/screenshots/')) {
      const rel = rawUrl.slice('/media/screenshots/'.length);
      const candidate = path.resolve(screenshotsDir, rel);
      if (candidate.startsWith(screenshotsDir + path.sep)) targetPath = candidate;
    }

    if (targetPath && sendStaticFile(req, res, targetPath)) {
      return;
    }
    next();
  });
}

function copyMatchingFiles(srcDir: string, destDir: string, allowedExts: Set<string>) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyMatchingFiles(srcPath, destPath, allowedExts);
    } else if (entry.isFile() && allowedExts.has(path.extname(entry.name).toLowerCase())) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function sharedMediaPlugin(): Plugin {
  return {
    name: 'pong2000-shared-media',
    configureServer(server) {
      attachSharedMediaMiddleware(server.middlewares);
    },
    configurePreviewServer(server) {
      attachSharedMediaMiddleware(server.middlewares);
    },
    closeBundle() {
      if (!fs.existsSync(distDir)) return;
      copyMatchingFiles(avatarsDir, path.join(distDir, 'avatars'), new Set(['.svg']));
      copyMatchingFiles(videosDir, path.join(distDir, 'media/videos'), new Set(['.mp4']));
      copyMatchingFiles(
        screenshotsDir,
        path.join(distDir, 'media/screenshots'),
        new Set(['.png', '.gif', '.jpg', '.webp']),
      );
      // Prevent GitHub Pages Jekyll processing so all bundled assets load directly
      fs.writeFileSync(path.join(distDir, '.nojekyll'), '');
    },
  };
}

export default defineConfig(() => {
  return {
    // Relative base ensures GitHub Pages works cleanly for both /<repo>/ and user/org root sites
    base: process.env.VITE_BASE_PATH || './',
    plugins: [react(), tailwindcss(), sharedMediaPlugin()],
    resolve: {
      alias: {
        '@multi': path.resolve(multiRoot, 'src'),
      },
    },
    server: {
      fs: {
        allow: [configDir, multiRoot],
      },
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
