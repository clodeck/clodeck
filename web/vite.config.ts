/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Where the dev proxy sends `/api` and `/ws`. It follows the backend's `PORT`
 * — the same variable `server/src/main.ts` reads — so `PORT=3300 npm run dev`
 * moves both halves together.
 *
 * Hard-coding 3001 was a trap: on Windows, Hyper-V/WSL reserve themselves
 * dynamic port ranges at boot (2980–3079 on the machine this was found on), and
 * the OS then refuses every bind inside them with `EACCES`. The server dies at
 * startup, nothing reaches its log, and every request through the client is a
 * 502 from this proxy — a symptom that points at the app and not at the port.
 * `netsh interface ipv4 show excludedportrange protocol=tcp` lists the ranges.
 */
const backendPort = process.env['PORT']?.trim();
const BACKEND_ORIGIN = `http://127.0.0.1:${backendPort === undefined || backendPort === '' ? '3001' : backendPort}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Proxy `/api` and `/ws` to the backend so the client develops against the
    // real endpoints with no CORS configuration (and no second origin to reason
    // about). `ws: true` makes this origin carry the chat socket too, so the
    // client opens a relative URL and never needs a host baked in.
    proxy: {
      '/api': { target: BACKEND_ORIGIN },
      '/ws': { target: BACKEND_ORIGIN, ws: true },
    },
  },
  test: {
    // Unit tests are `*.test.*` and live beside what they test; the end-to-end
    // suite is `*.spec.*` under `e2e/` and belongs to Playwright (`npm run e2e`).
    // Vitest's default pattern collects `*.spec.*` too, which would drag the
    // Playwright specs in — and Playwright's `test` does not run under vitest.
    include: ['**/*.test.{ts,tsx}'],
  },
});
