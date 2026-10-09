import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Ticket 04 adds the `/api` dev proxy to the backend; ticket 05 wires the
  // dev loop that starts this server alongside the backend one.
});
