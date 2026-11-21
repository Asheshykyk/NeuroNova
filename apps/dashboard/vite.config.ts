import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const proxy = { '/api/v1': 'http://localhost:3000' };

export default defineConfig({
  server: { proxy },
  preview: { proxy },
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts'
  }
});
