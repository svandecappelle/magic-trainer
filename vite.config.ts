/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Multiplayer: forward WebSocket traffic to the game server (npm run server).
    proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } },
  },
  test: { environment: 'node' },
});
