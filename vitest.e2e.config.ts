import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts', 'tests/e2e/**/*.e2e.ts'],
    pool: 'forks',
    testTimeout: 60000,
    hookTimeout: 60000,
    // 集成测试串行执行，避免端口冲突
    sequence: { concurrent: false },
  },
})
