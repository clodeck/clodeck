import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** The backend's dev port — `DEFAULT_PORT` in `server/src/main.ts`. */
const BACKEND_ORIGIN = 'http://127.0.0.1:3001';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Proxy `/api` to the backend so the client develops against the real
    // endpoint with no CORS configuration (and no second origin to reason about).
    proxy: {
      '/api': { target: BACKEND_ORIGIN },
    },
  },
});
