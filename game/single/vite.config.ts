import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

const configDir = path.dirname(fileURLToPath(import.meta.url));
const multiRoot = path.resolve(configDir, '../multi');

export default defineConfig(() => {
  return {
    // Reuse bundled SVG avatars directly from game/multi/assets with zero file duplication
    publicDir: path.resolve(multiRoot, 'assets'),
    plugins: [react(), tailwindcss()],
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
