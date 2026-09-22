/**
 * 工具目录跨栈契约守卫（R 批 R-0，2026-09-23）
 *
 * 守的是「类表漏项 / 装配掉链」这类**单侧恒绿**的断裂：分派纯函数单测自证、
 * Rust 目录单测自证，但两端中间的「命令名 / 宿主注册 / HTTP 桥接 / 前端消费」
 * 无人核对——摘任一处即静默退化到 generic（行段失去专属形态）。
 *
 * 【结构约束】纯源码扫描 + 只导入**零依赖纯函数**模块（`toolClassify`），
 * 不在 jsdom 下拉起 Tauri / Vue 运行时。
 *
 * 反证口径：删 Rust 注册行 / 删桥接注册 / 摘前端 provide / 从类表删一条桥工具名，
 * 任一动作都应让本 spec 报红。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { classifyTool } from '@worldsea/shared-ui/agent/stream/rows/toolClassify'

const ROOT = path.resolve(__dirname, '../../../../..')

const CMD_MODULE = 'crates/agent-commands/src/tool_catalog.rs'
const CMD_LIB = 'crates/agent-commands/src/lib.rs'
const TAURI_CMD = 'apps/tauri/src-tauri/src/tool_catalog_commands.rs'
const TAURI_LIB = 'apps/tauri/src-tauri/src/lib.rs'
const RPC_BRIDGE = 'apps/tauri/src-tauri/src/http_bridge/rpc.rs'
const USE_TOOL_CATALOG = 'apps/tauri/src/agent/composables/useToolCatalog.ts'
const AGENT_SPACE = 'apps/tauri/src/space/AgentSpace.vue'
const TOOL_ROW = 'packages/shared-ui/src/agent/stream/rows/ToolRow.vue'
const ROWS_INDEX = 'packages/shared-ui/src/agent/stream/rows/index.ts'
const BRIDGE_SPECS = 'apps/tauri/src-tauri/src/bridge_tool_specs.json'

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf-8')
}

/**
 * 去注释行后的源码（R-0 反证注入 01 实测暴露的盲区）：
 * 朴素的 `toContain` 会被「注释掉的那一行」骗过——原样保留接线文本即恒绿。
 * 本函数剔除整行注释（`//` / `*` / `/*` / `<!--` 开头）后再供断言使用。
 */
function readCode(rel: string): string {
  return read(rel)
    .split('\n')
    .filter((l) => {
      const t = l.trim()
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('<!--'))
    })
    .join('\n')
}

/** Rust 原生工具面（2026-09-23 工具面盘点口径；桥工具清单另从生成物读取） */
const NATIVE_TOOLS = [
  // A 终端与进程
  'bash', 'powershell', 'detect_shells',
  'shell_session_create', 'shell_session_exec', 'shell_session_input',
  'shell_session_destroy', 'shell_session_list',
  // B 文件
  'read_file', 'write_file', 'edit_file', 'edit_diff', 'list_directory',
  // C 搜索与检索
  'search_files', 'grep', 'find', 'workspace_search',
  // D 网络（src-tauri extra）
  'web_search', 'web_fetch',
  // I 记忆
  'memory_recall', 'memory_store', 'memory_update', 'memory_delete', 'memory_pin', 'memory_read_raw',
  // H 计划 / J 交互 / K 定时
  'todo_write', 'ask_user_question', 'set_timer', 'list_timers', 'cancel_timer',
  // G 子代理
  'delegate_to_sub_agent', 'list_sub_agents',
  // E MCP（前缀命名 + 枢纽三件）
  'mcp__filesystem__read_file', 'list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource',
  // K 实体（宿主 extra）
  'entity_list', 'entity_get',
]

describe('R-0 工具目录：Rust 侧链路（模块 → 命令 → 宿主注册 → HTTP 桥接）', () => {
  it('目录构建模块存在且暴露服务方法与纯函数', () => {
    const src = readCode(CMD_MODULE)
    expect(src).toContain('pub async fn build_tool_catalog')
    expect(src).toContain('pub async fn tool_catalog(')
    // MCP 归属从描述前缀派生（不反解析工具名——名会被清洗/截断）
    expect(src).toContain('const MCP_DESC_PREFIX: &str = "[MCP:"')
  })

  it('agent-commands 已登记模块', () => {
    expect(readCode(CMD_LIB)).toContain('mod tool_catalog;')
  })

  it('Tauri 命令已定义并注册进 invoke_handler', () => {
    const cmd = readCode(TAURI_CMD)
    expect(cmd).toContain('#[tauri::command]')
    expect(cmd).toContain('pub async fn cmd_agent_tool_catalog')
    expect(readCode(TAURI_LIB)).toContain('tool_catalog_commands::cmd_agent_tool_catalog,')
  })

  it('HTTP 桥接层已登记（硬约束：新命令必须同步桥接层）', () => {
    expect(readCode(RPC_BRIDGE)).toContain('"cmd_agent_tool_catalog"')
  })
})

describe('R-0 工具目录：前端链路（拉取 → provide → 行段消费）', () => {
  it('目录 composable 拉取命令并 provide 上下文', () => {
    const src = readCode(USE_TOOL_CATALOG)
    expect(src).toContain("invoke<ToolCatalogEntryView[]>('cmd_agent_tool_catalog'")
    expect(src).toContain('provide(TOOL_CATALOG_KEY, catalog)')
    // 刷新时机：会话切换 + MCP 工具集变化
    expect(src).toContain("listen('mcp:status'")
  })

  it('应用壳已挂载 provideToolCatalog()', () => {
    expect(readCode(AGENT_SPACE)).toContain('useToolCatalog().provideToolCatalog()')
  })

  it('行段组件消费分类并按类取图标', () => {
    const src = readCode(TOOL_ROW)
    expect(src).toContain('useToolClass()')
    expect(src).toContain('const CLASS_ICONS: Record<ToolClass, Component>')
    expect(src).toContain(':is="markIcon"')
  })

  it('rows/index 导出分派模块（供 apps 侧复用）', () => {
    const src = readCode(ROWS_INDEX)
    expect(src).toContain("export * from './toolClassify'")
    expect(src).toContain("export * from './toolCatalogContext'")
  })
})

describe('R-0 工具目录：类表覆盖（防漏项静默退化）', () => {
  it('桥工具清单（构建期生成物）全部有类归属', () => {
    const specs = JSON.parse(read(BRIDGE_SPECS)) as { tools: Array<{ name: string }> }
    const missing = specs.tools
      .map((t) => t.name)
      .filter((name) => classifyTool(name) === 'generic')
    expect(missing, `桥工具缺类归属：${missing.join(', ')}`).toEqual([])
  })

  it('Rust 原生工具面全部有类归属', () => {
    const missing = NATIVE_TOOLS.filter((name) => classifyTool(name) === 'generic')
    expect(missing, `原生工具缺类归属：${missing.join(', ')}`).toEqual([])
  })

  it('fallback 必达：未知工具归 generic（不抛错、不消失）', () => {
    expect(classifyTool('totally_unknown_tool')).toBe('generic')
  })
})
