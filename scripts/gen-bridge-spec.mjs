/**
 * 桥工具契约生成器（T5，2026-09-17）
 *
 * 用途：把前端工具定义（唯一事实源）生成为 Rust 侧桥契约：
 *   packages/agent-runtime（ToolDefinition）→ apps/tauri/src-tauri/src/bridge_tool_specs.json
 *   （Rust `frontend_tool_bridge.rs` 以 include_str! 编译期嵌入）
 *
 * 机制：转换与序列化逻辑在 TS 侧（packages/agent-runtime/src/tools/bridge-spec.ts），
 * 本脚本只负责以「写入模式」启动 vitest 执行对应 spec——复用仓库既有 TS 执行与
 * 路径别名解析能力（vitest 为已声明 devDependency），不引入新依赖。
 *
 * 用法：
 *   node scripts/gen-bridge-spec.mjs                 # 重新生成生成物
 *   npx vitest run packages/agent-runtime/src/tools/__tests__/bridge-spec.spec.ts   # 仅校验漂移
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')

const SPEC_REL = 'packages/agent-runtime/src/tools/__tests__/bridge-spec.spec.ts'
const ARTIFACT_REL = 'apps/tauri/src-tauri/src/bridge_tool_specs.json'

// 直接以 node 运行 vitest 入口：避免 npx / .cmd 在 Windows 上对 shell 的依赖
const vitestEntry = path.resolve(REPO, 'node_modules/vitest/vitest.mjs')

const result = spawnSync(process.execPath, [vitestEntry, 'run', SPEC_REL], {
  cwd: REPO,
  stdio: 'inherit',
  env: { ...process.env, WORLDSEA_BRIDGE_SPEC: 'write' },
})

if (result.status !== 0) {
  console.error(`[gen-bridge-spec] 生成失败（vitest 退出码 ${result.status}），生成物未更新`)
  process.exit(result.status ?? 1)
}

console.log(`[gen-bridge-spec] 已生成 ${ARTIFACT_REL}`)