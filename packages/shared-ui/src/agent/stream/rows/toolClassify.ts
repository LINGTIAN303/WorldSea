/**
 * 行段能力类分派（R 批 · R-0 分派基座）
 *
 * 三层分派中的第 ② 层（精确形态）+ 第 ① 层的消费口：
 *   ① Rust 工具目录（`cmd_agent_tool_catalog`：category / readOnly / mcpServer）→ 类归属兜底
 *   ② 本模块静态规则（工具名精确表 + 前缀规则）→ 精确形态
 *   ③ 工具结果 `__meta` → 内容结构（由行段详情组件消费，不在此处）
 *
 * 对齐 dsh：**类由客户端判**（静态枚举 + 前缀），未命中一律稳定降级为 `generic`——
 * 不允许「静默消失」。纯数据 + 纯函数，零 UI / 零 Tauri 依赖，可单测。
 *
 * 设计依据：docs/plans/2026-09-21-ZCode能力内化方向探究/18-对话区行段渲染批草案.md §三之二 / §5.1。
 */

/** 能力类（行段形态的最小分派单位；与草案 §四 的 13 组一一对应） */
export type ToolClass =
  | 'terminal'
  | 'file-read'
  | 'file-write'
  | 'file-edit'
  | 'file-list'
  | 'search'
  | 'web'
  | 'mcp'
  | 'skill'
  | 'subagent'
  | 'plan'
  | 'memory'
  | 'interaction'
  | 'domain'
  | 'generic'

/** Rust 工具目录条目（`cmd_agent_tool_catalog`；serde camelCase） */
export interface ToolCatalogEntryView {
  name: string
  category: string
  aliases: string[]
  readOnly: boolean
  destructive: boolean
  mcpServer?: string
}

/**
 * 工具名精确表（显式列举的「一类工具」；前缀规则之后命中优先于目录兜底）。
 * 含少量历史别名（回源老会话消息里可能出现旧名，别名解析只发生在 Rust 调用面）。
 */
export const TOOL_CLASS_EXACT: Readonly<Record<string, ToolClass>> = {
  // ── A 终端与进程 ──
  bash: 'terminal',
  powershell: 'terminal',
  detect_shells: 'terminal',
  execute_command: 'terminal',
  // ── B 文件 ──
  read_file: 'file-read',
  file_read: 'file-read',
  fs_read: 'file-read',
  list_directory: 'file-list',
  write_file: 'file-write',
  file_write: 'file-write',
  fs_write: 'file-write',
  edit_file: 'file-edit',
  file_edit: 'file-edit',
  fs_edit: 'file-edit',
  edit_diff: 'file-edit',
  // ── C 搜索与检索 ──
  grep: 'search',
  find: 'search',
  search_files: 'search',
  workspace_search: 'search',
  content_search: 'search',
  // ── D 网络 ──
  web_search: 'web',
  web_fetch: 'web',
  // ── E MCP（枢纽级工具；`mcp__*` 走前缀规则）──
  list_mcp_resources: 'mcp',
  list_mcp_resource_templates: 'mcp',
  read_mcp_resource: 'mcp',
  // ── G 子代理 ──
  delegate_to_sub_agent: 'subagent',
  list_sub_agents: 'subagent',
  // ── H 计划 ──
  todo_write: 'plan',
  // ── J 交互 ──
  ask_user_question: 'interaction',
  // ── K 域内业务（显式名；族前缀见 PREFIX_RULES）──
  worldview: 'domain',
  consistency_check: 'domain',
  list_vision_images: 'domain',
  set_timer: 'domain',
  list_timers: 'domain',
  cancel_timer: 'domain',
}

/** 前缀规则（顺序求值，先命中先返回） */
const PREFIX_RULES: ReadonlyArray<readonly [RegExp, ToolClass]> = [
  [/^mcp__/, 'mcp'],
  [/^load_skill/, 'skill'],
  [/^shell_session_/, 'terminal'],
  [/^memory_/, 'memory'],
  [/^entity_/, 'domain'],
  [/^kb_/, 'domain'],
  [/^ui_/, 'domain'],
  [/^project_/, 'domain'],
  [/^vision_/, 'domain'],
]

/** Rust category → 能力类（目录兜底：新工具无需改前端也能落到正确行段族） */
const CATEGORY_RULES: Readonly<Record<string, ToolClass>> = {
  dev: 'terminal',
  search: 'search',
  memory: 'memory',
  mcp: 'mcp',
  orchestrator: 'subagent',
  plan: 'plan',
}

/** 目录条目兜底：`file` 按读写语义细分；其余未登记 category 归域内业务 */
function classFromCatalog(entry: ToolCatalogEntryView): ToolClass {
  if (entry.category === 'file') return entry.readOnly ? 'file-read' : 'file-edit'
  return CATEGORY_RULES[entry.category] ?? 'domain'
}

/**
 * 工具名 → 能力类。
 *
 * @param name   工具名（canonical；历史别名已在精确表内覆盖常见项）
 * @param entry  工具目录条目（可缺省：目录未就绪 / 测试 / 独立预览 → 纯静态规则）
 */
export function classifyTool(name: string, entry?: ToolCatalogEntryView | null): ToolClass {
  const exact = TOOL_CLASS_EXACT[name]
  if (exact) return exact
  for (const [re, cls] of PREFIX_RULES) {
    if (re.test(name)) return cls
  }
  if (entry) return classFromCatalog(entry)
  return 'generic'
}
