/**
 * 工具行语义化模块（ToolRow 用）：按工具名把 tool 行分类为「创建/读取/编辑/删除/搜索/命令/通用」操作段，
 * 并从 args 提取操作对象名、从结果 __meta 提取效果标签。
 *
 * 纯数据 + 纯函数，无副作用、零 UI 依赖。未知工具统一归 'tool'（通用段），不报错。
 * 与后端 agent-commands（fs_tools / terminal）与 frontend_tool_bridge 的工具返回 __meta 约定对齐，
 * 见 docs/details/注释/agent-commands/fs.md 与前端 toolSemantics 注释。
 */

/** 操作分类：create=创建 / read=读取 / edit=编辑 / delete=删除 / search=搜索 / cmd=执行命令 / tool=通用工具 */
export type OpKind = 'create' | 'read' | 'edit' | 'delete' | 'search' | 'cmd' | 'tool'

/**
 * 工具名 → 操作分类静态映射
 *
 * 覆盖文件工具（file_* / coding-agent read_file / fs_*）、实体/关系（entity/relation）、
 * 命令（terminal shell_session_* / git / pkg / code_execute）、搜索（file/content/kb/web/graph）、
 * 以及 notebook / mindmap / outline / timeline / manuscript / magic / ui / schema / plan 等分组。
 * 未知工具经 getOpKind 兜底返回 'tool'。
 */
export const TOOL_OP: Record<string, OpKind> = {
  // ── 创建 create ──
  write_file: 'create', file_write: 'create', fs_write: 'create', file_create: 'create',
  entity_create: 'create', relation_create: 'create',
  notebook_create: 'create', notebook_create_note: 'create', notebook_create_backlink: 'create',
  mindmap_create_node: 'create', timeline_create_event: 'create', outline_create_node: 'create',
  magic_create_skill_node: 'create', ui_create_surface: 'create', plugin_write: 'create',
  workflow_create: 'create',
  // ── 读取 / 获取 / 列出 read ──
  read_file: 'read', file_read: 'read', fs_read: 'read', file_list: 'read', fs_list: 'read', file_analyze: 'read',
  entity_get: 'read', entity_list: 'read', relation_list: 'read',
  notebook_list_notes: 'read', timeline_get_events: 'read',
  graph_get_nodes: 'read', graph_get_edges: 'read',
  mindmap_get_structure: 'read', outline_get_structure: 'read', magic_get_skill_tree: 'read',
  manuscript_list_chapters: 'read', manuscript_get_chapter_content: 'read',
  schema_get_entity_type: 'read', schema_list_entity_types: 'read',
  get_sub_agent_status: 'read', workflow_status: 'read', kb_read: 'read',
  notebook_export_note: 'read',
  // ── 编辑 / 更新 edit ──
  edit_file: 'edit', file_associate: 'edit', file_edit: 'edit',
  entity_update: 'edit', relation_link: 'edit',
  notebook_update: 'edit', notebook_update_note: 'edit',
  mindmap_update_node: 'edit', timeline_update_event: 'edit', outline_update_node: 'edit',
  outline_move_node: 'edit', outline_link_entity: 'edit',
  magic_update_skill_node: 'edit', ui_update_components: 'edit', ui_update_data: 'edit',
  manuscript_update_chapter: 'edit',
  plan_update: 'edit', schema_update_entity_type: 'edit', schema_register_validation: 'edit',
  persona_update: 'edit', workflow_update: 'edit',
  retrofit_patch_apply: 'edit', retrofit_apply: 'edit',
  // ── 删除 delete ──
  file_delete: 'delete', fs_delete: 'delete', file_remove: 'delete',
  entity_delete: 'delete', relation_delete: 'delete',
  mindmap_delete_node: 'delete', memory_delete: 'delete', kb_delete: 'delete',
  ui_delete_surface: 'delete', schema_unregister_entity_type: 'delete',
  notebook_delete_note: 'delete', plan_delete: 'delete',
  // ── 搜索 search ──
  search_files: 'search', file_search: 'search', fs_search: 'search', content_search: 'search',
  kb_search: 'search', web_search: 'search', web_search_cli: 'search', graph_find_path: 'search',
  // ── 命令 cmd ──
  execute_command: 'cmd', shell_session_create: 'cmd', shell_session_exec: 'cmd', shell_session_input: 'cmd',
  shell_session_destroy: 'cmd', shell_session_list: 'cmd', detect_shells: 'cmd', detect_terminal_mode: 'cmd',
  pkg_install: 'cmd', pkg_run: 'cmd', git_status: 'cmd', git_log: 'cmd', git_diff: 'cmd', git_commit: 'cmd',
  git_branch: 'cmd', code_execute: 'cmd', notebook_execute_code: 'cmd', start_server: 'cmd', sys_info: 'cmd',
}

/** 操作分类 → 语义动词（行内主文案） */
export const OP_VERB: Record<OpKind, string> = {
  create: '创建', read: '读取', edit: '编辑', delete: '删除', search: '搜索', cmd: '执行命令', tool: '调用工具',
}

/** 操作分类 → 单字角标（行首弱提示标记） */
export const OP_MARK: Record<OpKind, string> = {
  create: '建', read: '读', edit: '改', delete: '删', search: '搜', cmd: '执', tool: '具',
}

/** 根据工具名取操作分类；未知工具兜底 'tool' */
export function getOpKind(name: string): OpKind {
  return TOOL_OP[name] ?? 'tool'
}

/** 取路径的末段（基名），兼容 / 与 \ 分隔 */
function baseName(p: string): string {
  const norm = p.replace(/\\/g, '/')
  const seg = norm.split('/').filter(Boolean).pop()
  return seg ?? p
}

/** 截断字符串（按字符，避免切在 UTF-8 中间），超长补 … */
function truncateStr(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max) + '…'
}

/**
 * 从 args 提取操作对象名（「对象名」展示片段）
 *
 * - 文件类（create/edit/delete + path 参数）：取基名
 * - 实体/关系（entity_ * / relation_ *）：`实体类型「对象名」`
 * - 搜索（search）：`「查询词」`
 * - 命令（cmd）：`$ 命令摘要`（超长截断）
 * - 其余：空字符串（调用方可回退 args 摘要）
 */
export function extractOperationSubject(op: OpKind, name: string, args: Record<string, unknown>): string {
  const str = (v: unknown): string => (typeof v === 'string' && v ? (v as string) : '')
  // 文件类：create/edit/delete 且带 path 时取基名
  if ((op === 'create' || op === 'edit' || op === 'delete') && str(args.path)) {
    return baseName(str(args.path))
  }
  // 实体/关系类：entityType/type/relationType + name/id
  if (name.startsWith('entity') || name.startsWith('relation')) {
    const type = str(args.entityType) || str(args.type) || str(args.relationType)
    const obj = str(args.name) || str(args.id)
    if (type && obj) return `${type}「${obj}」`
    if (type) return type
    if (obj) return `「${obj}」`
  }
  // 搜索：query/pattern/keyword
  if (op === 'search') {
    const q = str(args.query) || str(args.pattern) || str(args.keyword)
    if (q) return `「${q}」`
  }
  // 命令：command 摘要
  if (op === 'cmd') {
    const c = str(args.command)
    if (c) return `$ ${truncateStr(c, 60)}`
  }
  return ''
}

/** __meta 附加字段类型（与后端工具返回约定对齐） */
export interface ToolMeta {
  op?: string
  path?: string
  name?: string
  id?: string
  entityType?: string
  query?: string
  command?: string
  size?: number
  lines?: number
  additions?: number
  deletions?: number
  hits?: number
  replacements?: number
  exit_code?: number
  duration_ms?: number
}

/** 字节数格式化为可读大小（如 2150 → "+2.1 KB"） */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 基于结果 __meta 生成效果标签（如 "+2.1 KB"、"命中 3"、"exit 0 · 2.4s"）
 *
 * 无对应 __meta 字段时返回空字符串（调用方回退 args 摘要）。
 */
export function extractEffectLabel(meta?: ToolMeta | null): string {
  if (!meta) return ''
  switch (meta.op) {
    case 'create':
      return typeof meta.size === 'number' ? `+${formatBytes(meta.size)}` : ''
    case 'read':
      if (typeof meta.lines === 'number') return `${meta.lines} 行`
      if (typeof meta.size === 'number') return formatBytes(meta.size)
      return ''
    case 'edit': {
      if (typeof meta.additions === 'number' && typeof meta.deletions === 'number')
        return `+${meta.additions}/-${meta.deletions}`
      if (typeof meta.replacements === 'number') return `+${meta.replacements} 处`
      return ''
    }
    case 'search':
      return typeof meta.hits === 'number' ? `命中 ${meta.hits}` : ''
    case 'cmd': {
      const parts: string[] = []
      if (typeof meta.exit_code === 'number') parts.push(`exit ${meta.exit_code}`)
      if (typeof meta.duration_ms === 'number') parts.push(`${(meta.duration_ms / 1000).toFixed(1)}s`)
      return parts.join(' · ')
    }
    default:
      return ''
  }
}