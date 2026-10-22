import { defineConfig } from 'vitest/config'

// one vitest run covers every package: unit tests beside the source and the places client's test/ folder, and scripts/esm-load.test.ts
// (builds, then loads each package's dist in plain Node)
export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'packages/*/test/**/*.test.ts', 'scripts/*.test.ts'],
    environment: 'node',
  },
})
