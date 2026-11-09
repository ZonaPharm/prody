import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Unit tests only: pure logic, no database, no network. Browser tests live in
// e2e/ and run under Playwright (npm run test:e2e), so they are kept out of
// this include on purpose.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
  },
})
