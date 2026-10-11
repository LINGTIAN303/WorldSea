/**
 * C1 性能门禁专用 vitest 配置（与常规测试套件隔离）
 *
 * 常规套件只收 __tests__ 目录下的 spec 测试；本配置只收 benchmarks 目录下的
 * bench 门禁用例，两者互不干扰。运行命令：pnpm bench:gate
 */
import { defineConfig } from 'vitest/config'
import base from './vitest.config'

export default defineConfig({
  ...base,
  test: {
    ...(base.test ?? {}),
    include: ['benchmarks/**/*.bench.ts'],
    // 门禁依赖计时：放宽超时，并禁止文件级并发（避免 CPU 抢占污染基线）
    testTimeout: 120_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
})
