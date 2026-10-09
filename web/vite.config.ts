import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** The backend's dev port — `DEFAULT_PORT` in `server/src/main.ts`. */
const BACKEND_ORIGIN = 'http://127.0.0.1:3001';

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
});
