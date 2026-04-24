import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'server/**/*.test.ts'],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:3001", changeOrigin: true },
      "/media": { target: "http://127.0.0.1:3001", changeOrigin: true },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      "/api": { target: "http://127.0.0.1:3001", changeOrigin: true },
      "/media": { target: "http://127.0.0.1:3001", changeOrigin: true },
    },
  },
})
