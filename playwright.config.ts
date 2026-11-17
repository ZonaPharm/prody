import { defineConfig, devices } from '@playwright/test'
import { loadEnvConfig } from '@next/env'

// Browser tests drive a real `next dev` server, so they read and write whatever
// database that server points at. They must never point at production.
//
// The env files are loaded here exactly the way `next dev` loads them, so the
// URL checked below is the URL the server will actually use. CLAUDE.md long
// described local development as running against the production project; a
// .env.local left over from that would otherwise send these tests there.
const PRODUCTION_REF = 'ocvmqlbfkloskabicxuw'

loadEnvConfig(process.cwd(), true)

// In a cloud session the staging keys come as STAGING_* secrets instead of a
// .env.local; hand them to the dev server under the names the app reads.
if (!process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.STAGING_SUPABASE_URL) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.STAGING_SUPABASE_URL
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= process.env.STAGING_SUPABASE_ANON_KEY
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
if (!supabaseUrl) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set. Point it at prody-staging (in .env.local) before running e2e tests.')
}
if (supabaseUrl.includes(PRODUCTION_REF)) {
  throw new Error(`Refusing to run e2e tests: NEXT_PUBLIC_SUPABASE_URL points at production (${PRODUCTION_REF}). Use prody-staging.`)
}

const PORT = Number(process.env.E2E_PORT || 3100)

// Only string values can be handed to the server process.
const serverEnv: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string'),
)
// The cron routes refuse to run without CRON_SECRET at all. A placeholder lets
// the tests check that they turn away a request lacking it.
serverEnv.CRON_SECRET ||= 'e2e-placeholder-secret'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    env: serverEnv,
    reuseExistingServer: true,
    timeout: 180_000,
  },
})
