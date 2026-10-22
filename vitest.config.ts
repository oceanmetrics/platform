import { defineConfig } from 'vitest/config'

// one vitest run covers every package: unit tests beside the source and the places client's test/ folder
export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    environment: 'node',
  },
})
