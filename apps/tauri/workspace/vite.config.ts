import path from 'node:path'

import vue from '@vitejs/plugin-vue'
import { defineConfig, type Plugin, type UserConfig } from 'vite'
import wasm from 'vite-plugin-wasm'

import baseConfig from '../vite.config'

/**
 * 工作台（产品域）专用构建：入口 = 本目录，产出 = `../workspace-dist/`（壳协议 /workspace 前缀伺服）。
 * 主体复用旧前端（`../src/main`）与旧配置的全部 alias/define；**Agent 接线经下方插件在构建期摘除**。
 *
 * 用法（从 apps/tauri 目录）：`node node_modules/vite/bin/vite.js build --config workspace/vite.config.ts`
 * 注意：D1-a 起产物由壳协议运行时读取（不嵌入二进制），构建后需重启壳生效。
 */

const base = baseConfig as UserConfig
const STUB_PREFIX = '\0ws-stub:'

/**
 * 说明符归一（D1-a 补正，2026-09-24）：`resolve.alias` 在插件 resolveId **之前**生效，故同一模块
 * 到本插件时有多种写法——裸包名（`@worldsea/agent-runtime`）、`@agent/…`、以及 alias 后的
 * **绝对路径**（`D:\…\packages\agent-runtime\src\…`）。首版只按裸名写规则 → 大多数规则静默不命中
 * （实测：真 agent-runtime 注册表仍在产物里且启动即抛）。故规则一律按**归一体**写，三形态同判。
 */
function canonical(source: string): string {
  return source
    .replace(/\\/g, '/')
    .split('?')[0]
    .replace(/^.*\/packages\/agent-runtime\/src$/, '@worldsea/agent-runtime')
    .replace(/^.*\/packages\/agent-runtime\/src\//, '@agent/')
    .replace(/^.*\/packages\/shared-composables\/src\//, '@worldsea/shared-composables/')
    .replace(/^.*\/apps\/tauri\/src\//, '@/')
}

/** 空渲染组件桩（Agent 面板类：新壳里 Agent 面在 dsh 窗口，旧面板属 D2 重做范围） */
const STUB_COMPONENT =
  "import { defineComponent } from 'vue'\nexport default defineComponent({ name: 'WsAgentStub', render: () => null })"

/**
 * Agent 接线摘除规则：**按归一体后缀匹配**（见 `canonical`）。
 * 未列出的 Agent 文件（agent/ 其余面板、模型面板等）随 `AgentSpace`/`Agent 设置面板` 摘除后
 * **不可达**，天然不打进产物。`@worldsea/agent-runtime` 的其它导出按构建/运行报错迭代补——stub 保持最小面。
 */
const STUB_RULES: Array<{ match: RegExp; code: string }> = [
  // ★ 有意**不桩**（2026-09-24 实测校准）：
  //   `@worldsea/agent-runtime` 根与 `@agent/index`——桩掉它们会让「谁 import 谁缺导出」连锁报错，
  //   而真体（真注册表 + 真 descriptor）本身自洽：mindmap 硬绑点传的是**真 descriptor**（仍在产物内），
  //   注册不抛。Agent 内核留在产物里属 D1 已知边界（批计划 R2「Agent 接线后置」），
  //   对工作台窗**不可达也不可达命令面**（ACL 按窗口隔离，见 permissions/worldsea-product.toml）。
  // 旧 Agent 设置面板（新壳里 Agent 面在 dsh 窗口；这些面板属 D2 重做范围）→ 空渲染组件
  { match: /^@\/agent\/.*\.vue$/, code: STUB_COMPONENT },
  // Agent composables（多写法：@/、./、../、包路径）——以下均为**叶级**模块，导出面小、桩得住
  { match: /agent\/composables\/useAgent$/, code: 'export function useAgent() { return {} }' },
  {
    match: /^@worldsea\/shared-composables\/agent\/useAgent$/,
    code: 'export function useAgent() { return {} }',
  },
  {
    match: /agent\/composables\/useAgentRust$/,
    // 规则文件体系（H5 八文件）是**产品域**能力（RulesPanel 读写）——保留常量与全局目录解析，
    // 仅摘除 Agent 会话逻辑（registerProjectSwitchListener）。与真实现逐字对齐（useAgentRust.ts:2681+）。
    code: `export function registerProjectSwitchListener() {}
export function useAgentRust() { return {} }
export const AGENTS_RULES_FILE = 'AGENTS.md'
export const RULES_RULES_FILE = 'RULES.md'
export const WORLD_RULES_FILE = 'WORLD.md'
export const WRITING_RULES_FILE = 'WRITING.md'
export const DESIGN_RULES_FILE = 'DESIGN.md'
export const TOOLS_RULES_FILE = 'TOOLS.md'
export const MEMORY_RULES_FILE = 'MEMORY.md'
export async function getGlobalRulesDir() {
  try {
    const { homeDir, appDataDir } = await import('@tauri-apps/api/path')
    try {
      const h = await homeDir()
      if (h) return h + '/.WorldSea/rules'
    } catch { /* homeDir 不可用则退应用数据目录 */ }
    const d = await appDataDir()
    return d ? d + '/worldsea/rules' : null
  } catch {
    return null
  }
}`,
  },
  {
    match: /agent\/composables\/worldRulesInjector$/,
    // 阈值读写是**产品域**能力（RulesPanel 的「世界规则阈值」）；注入器本身属 Agent 会话链 → 只留读写。
    // 常量与收敛规则与真实现逐字对齐（world-rules.ts:13-22，localStorage 键同真实现）。
    code: `const KEY = 'ws_world_rules_threshold'
export const WORLD_RULES_TRIGGER_DEFAULT = 20
export const WORLD_RULES_TRIGGER_MIN = 1
export const WORLD_RULES_TRIGGER_MAX = 150
export function clampTriggerThreshold(raw) {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n)) return WORLD_RULES_TRIGGER_DEFAULT
  return Math.min(WORLD_RULES_TRIGGER_MAX, Math.max(WORLD_RULES_TRIGGER_MIN, n))
}
export function getWorldRulesThreshold() {
  try { return clampTriggerThreshold(localStorage.getItem(KEY)) } catch { return WORLD_RULES_TRIGGER_DEFAULT }
}
export function setWorldRulesThreshold(n) {
  try { localStorage.setItem(KEY, String(clampTriggerThreshold(n))) } catch { /* 存储不可用时阈值回落默认 */ }
}
export async function attachWorldRulesIfTriggered() {}`,
  },
  { match: /agent\/composables\/useOrchestrator$/, code: 'export function useOrchestrator() { return {} }' },
  {
    match: /agent\/composables\/preloadModels$/,
    code: 'export async function preloadSupportingModels() {}',
  },
  {
    match: /agent\/composables\/useModelFetchWatcher$/,
    code: 'export function installModelFetchWatcher() {}',
  },
  {
    match: /agent\/composables\/useActivityLog$/,
    code: 'export function useActivityLog() { return { items: { value: [] }, push() {}, clear() {} } }',
  },
  {
    match: /shared-composables\/agent\/useMcpConnections$/,
    code: 'export function useMcpConnections() { return { ensureLoaded: async () => {}, takeAutoReconnectFailed: () => [], getMCPConnections: () => [] } }',
  },
  // 组件（相对与别名两种写法归一到同一判定）
  { match: /space\/AgentSpace\.vue$/, code: STUB_COMPONENT },
]

function agentStubPlugin(): Plugin {
  return {
    name: 'worldsea-workspace-agent-stubs',
    enforce: 'pre',
    resolveId(source) {
      const id = canonical(source)
      for (let i = 0; i < STUB_RULES.length; i++) {
        if (STUB_RULES[i].match.test(id)) return STUB_PREFIX + i
      }
      return null
    },
    load(id) {
      if (!id.startsWith(STUB_PREFIX)) return null
      const index = Number(id.slice(STUB_PREFIX.length))
      return STUB_RULES[index]?.code ?? null
    },
  }
}

export default defineConfig({
  ...base,
  root: __dirname,
  base: './',
  plugins: [agentStubPlugin(), vue(), wasm()],
  resolve: { ...(base.resolve ?? {}) },
  build: {
    ...(base.build ?? {}),
    outDir: path.resolve(__dirname, '../workspace-dist'),
    emptyOutDir: true,
    target: 'chrome120',
  },
})
