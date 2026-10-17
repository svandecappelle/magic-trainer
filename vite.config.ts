/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Each production build gets an id, compiled into the app (__BUILD__) and written to dist/version.json for the game
 * server: a browser still running an older build is told to reload instead of breaking on newer game states.
 */
function buildId(id: string): Plugin {
  return {
    name: 'magic-trainer-build-id',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify({ build: id })}\n` });
    },
  };
}

export default defineConfig(({ command }) => {
  const id = command === 'build' ? Date.now().toString(36) : 'dev';
  return {
    plugins: [react(), buildId(id)],
    define: { __BUILD__: JSON.stringify(id) },
    server: {
      // Multiplayer and accounts: forward to the server (npm run server).
      proxy: {
        '/ws': { target: 'ws://localhost:8787', ws: true },
        '/api': 'http://localhost:8787',
        '/auth': 'http://localhost:8787',
      },
    },
    // Bot-vs-bot games are CPU-bound: the default 5 s can run out when all test files run in parallel.
    test: { environment: 'node', testTimeout: 20_000 },
  };
});
