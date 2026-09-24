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
 * Agent 接线摘除规则：**按导入说明符后缀匹配**——同一模块在旧代码里有多种写法
 * （`@/…` / `./…` / `../…` / 包路径 `@worldsea/shared-composables/agent/…`，逐条 grep 过）。
 * 未列出的 Agent 文件（agent/ 面板、模型面板等）随 `AgentSpace` 摘除后**不可达**，天然不打进产物。
 * `@worldsea/agent-runtime` 的其它导出按构建/运行报错迭代补——stub 保持最小面。
 */
const STUB_RULES: Array<{ match: RegExp; code: string }> = [
  // Agent composables（多写法：@/、./、../、./useAgentRust 同目录）
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
    match: /composables\/useAgentPluginBridge$/,
    code: 'export function useAgentPluginBridge() { return {} }',
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
    code: 'export function useMcpConnections() { return { ensureLoaded: async () => {}, takeAutoReconnectFailed: () => null } }',
  },
  // 启动链硬绑（main.ts / bootstrap.ts / useProjectSwitcher）
  { match: /^@agent\/index$/, code: 'export function registerWorldviewSprout() {}' },
  { match: /^@agent\/session\/manager$/, code: 'export function setAgentCurrentProjectId() {}' },
  { match: /^@worldsea\/agent-runtime$/, code: 'export const internalRegistry = { register() {} }' },
  { match: /mindmap\/agent-descriptor$/, code: 'export const mindmapDescriptor = {}' },
  { match: /agent\/agentDataBridges$/, code: 'export function installAgentDataBridges() {}' },
  // 组件
  {
    match: /space\/AgentSpace\.vue$/,
    code: "import { defineComponent } from 'vue'\nexport default defineComponent({ name: 'AgentSpaceStub', render: () => null })",
  },
]

function agentStubPlugin(): Plugin {
  return {
    name: 'worldsea-workspace-agent-stubs',
    enforce: 'pre',
    resolveId(source) {
      for (let i = 0; i < STUB_RULES.length; i++) {
        if (STUB_RULES[i].match.test(source)) return STUB_PREFIX + i
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
