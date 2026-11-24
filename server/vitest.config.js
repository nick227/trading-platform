import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      BROKER_MODE: '',
      WORKER_ORDER_PROCESSING: ''
    },
    include: ['test/**/*.test.js', 'src/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      include: ['src/**/*.js']
    }
  }
})
