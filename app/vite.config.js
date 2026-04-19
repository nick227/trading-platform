import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const appBase = process.env.VITE_APP_BASE || '/'

export default defineConfig({
  base: appBase,
  plugins: [react({
    jsxRuntime: 'automatic'
  })],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      include: ['src/**/*.{js,jsx}']
    }
  }
})
