import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    pool: 'forks',
    pool: 'forks',
    // 集成测试需要更长时间启动子进程
    testTimeout: 60000,
    hookTimeout: 60000,
  },
})
