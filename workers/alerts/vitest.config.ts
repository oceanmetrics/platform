import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

// the tests run in workerd (miniflare) over the real local KV of wrangler.toml; the network, the clock, Analytics
// Engine and the provider are fakes passed in (test/helpers.ts)
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.toml' } })],
})
