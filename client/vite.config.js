import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const rootDir = path.resolve(here, '..');
  const env = loadEnv(mode, rootDir, '');
  const apiPort = env.PORT || 3001;
  return {
    root: here,
    envDir: rootDir,
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: { '/api': { target: `http://localhost:${apiPort}`, changeOrigin: true } },
    },
    build: { outDir: path.join(here, 'dist'), emptyOutDir: true },
  };
});
