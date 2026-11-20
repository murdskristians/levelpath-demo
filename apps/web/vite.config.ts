import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/** Dev proxy: `/api/me` in the browser reaches `/me` on the API. */
export function apiProxy(apiPort: string | undefined) {
  return {
    '/api': {
      target: `http://localhost:${apiPort || 3000}`,
      rewrite: (path: string) => path.replace(/^\/api/, ''),
    },
  };
}

export default defineConfig({
  plugins: [react()],
  server: { proxy: apiProxy(process.env.API_PORT) },
  test: {
    environment: 'jsdom',
  },
});
