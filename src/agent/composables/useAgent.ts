import { ref, readonly, computed } from 'vue'
import type { IAgentBackend, AgentEvent, AgentMessage, ImageAttachment, FileAttachment, UsageData, ThinkingLevel, ChatMode, A2UIMessage, SessionUsage } from '@agent/index'
import { getProjectManager, getFileStorageBackend } from '@worldsmith/entity-core/core'
export type { ChatMode }

/** 深度模式虚拟段落类型 */

/** 交互工具分类 */
export type InteractiveToolType = 'choice' | 'display' | 'waiting' | 'confirm' | 'none'

/** 工具调用视图（阶段内嵌） */
export interface ToolCallView {
  id: string
  name: string
  args: Record<string, unknown>
  status: 'running' | 'completed' | 'failed'
  result?: string
  startedAt: number
  endedAt?: number
  /** 交互类型分类（深度模式专用） */
  interactiveType?: InteractiveToolType
  /** 展示型工具的 Block 数据（output_* 工具执行后回填） */
  block?: import('@agent/index').MessageBlock
  /** 确认型工具的权限级别 */
  permissionLevel?: 'safe' | 'moderate' | 'dangerous'
}

/** 阶段内的中间输出 */
export interface PhaseOutput {
  id: string
  content: string
  timestamp: number
  status: 'streaming' | 'complete'
}

/** 最终结论区 */
export interface FinalOutput {
  content: string
  blocks: import('@agent/index').MessageBlock[]
  images: ImageAttachment[]
  files: FileAttachment[]
  status: 'streaming' | 'complete'
}

/**
 * 深度模式段类型：
 * - thinking: 推理过程（保留所有历史推理）
 * - phase: 阶段容器（内嵌工具列表 + 中间输出）
 */
export type DeepSegment =
  | { id: string; type: 'thinking'; thinking: string; timestamp: number; status: 'streaming' | 'complete' }
  | { id: string; type: 'phase'; label: string; index: number; timestamp: number;
      tools: ToolCallView[]; outputs: PhaseOutput[]; status: 'active' | 'done' }

/** 深度模式阶段定义：工具名→阶段映射 */
const DEEP_PHASES = [
  { label: '问题拆解', tools: ['output_list', 'output_choice'] },
  { label: '证据收集', tools: [
    'entity_get', 'entity_list', 'entity_suggest_field', 'entity_smart_fill', 'entity_get_context',
    'content_search', 'relation_list',
    'kb_search', 'kb_list', 'kb_read', 'kb_extract', 'kb_reflect', 'kb_link',
    'web_search', 'web_fetch', 'web_search_cli', 'web_fetch_cli', 'web_qa_cli',
    'vision_analyze', 'list_vision_images',
    'memory_recall',
    'fs_read', 'fs_list', 'fs_search', 'fs_stat',
    'read_file', 'search_files', 'list_directory',
    'file_read', 'file_list', 'file_analyze',
  ] },
  { label: '推理分析', tools: [
    'algo_graph_analysis', 'algo_pagerank', 'algo_community_detection',
    'algo_shortest_path', 'algo_k_shortest_paths', 'algo_topological_sort',
    'algo_force_layout',
    'consistency_check', 'schema_validate',
    'graph_get_nodes', 'graph_get_edges', 'graph_find_path', 'graph_cluster_analysis',
    'graph_highlight_nodes', 'graph_export_snapshot', 'graph_filter_by_type', 'graph_search_subgraph',
  ] },
  { label: '创作操作', tools: [
    'entity_create', 'entity_update', 'entity_delete',
    'relation_create', 'relation_delete',
    'kb_write', 'kb_delete', 'kb_init',
    'memory_store', 'memory_delete',
    'image_generate', 'image_edit', 'image_gen_config', 'image_list', 'image_show',
    'video_generate', 'video_status', 'video_list', 'video_show', 'video_gen_config',
    'persona_apply', 'persona_reset', 'persona_update',
    'load_skill',
    'schema_register_entity_type', 'schema_unregister_entity_type',
    'schema_get_entity_type', 'schema_list_entity_types', 'schema_update_entity_type',
    'schema_register_validation', 'schema_register_view', 'schema_export',
    'ui_create_surface', 'ui_update_components', 'ui_update_data', 'ui_delete_surface',
    'a2ui_show_entity', 'a2ui_show_relation',
    'fs_write', 'fs_move', 'fs_delete', 'fs_mkdir', 'fs_copy',
    'write_file', 'edit_file',
    'file_write', 'file_delete', 'file_associate',
    'plugin_write',
    'project_export', 'project_import',
    'daily_report',
    'plan_create', 'plan_update',
  ] },
  { label: '结论输出', tools: [
    'output_table', 'output_comparison', 'output_accordion', 'output_alert',
    'output_stat', 'output_code', 'output_entity_card', 'output_progress',
    'output_timeline', 'output_image', 'output_manuscript',
  ] },
]

const ALL_PHASE_TOOLS = new Set(DEEP_PHASES.flatMap(p => p.tools))

/** 选择型工具：需要用户点击选项 */
const CHOICE_TOOLS = new Set(['output_choice'])

/** 展示型工具：渲染 Block 组件（只读展示） */
const DISPLAY_TOOLS = new Set([
  'output_table', 'output_comparison', 'output_accordion', 'output_alert',
  'output_stat', 'output_code', 'output_entity_card', 'output_progress',
  'output_timeline', 'output_image', 'output_manuscript', 'output_list',
])

/** 等待型工具：需要用户外部操作（原生弹窗/系统交互） */
const WAITING_TOOLS = new Set([
  'dialog_open', 'dialog_save', 'dialog_message', 'dialog_ask',
  'clipboard_read', 'clipboard_write', 'open_url', 'notify', 'native_fetch',
])

/** 根据工具名和权限级别推断交互类型 */
function classifyInteractive(toolName: string, permission: 'safe' | 'moderate' | 'dangerous'): InteractiveToolType {
  if (CHOICE_TOOLS.has(toolName)) return 'choice'
  if (DISPLAY_TOOLS.has(toolName)) return 'display'
  if (WAITING_TOOLS.has(toolName)) return 'waiting'
  if (permission === 'dangerous' || permission === 'moderate') return 'confirm'
  return 'none'
}

/** 根据工具名推断所属阶段 */
function inferPhase(toolName: string): string {
  for (const phase of DEEP_PHASES) {
    if (phase.tools.includes(toolName)) return phase.label
  }
  return '其他操作'
}
import { createWorldSmithAgent, loadApiKey, setActiveCliAgentConnection } from '@agent/index'
import type { ProviderConfig, CloudProvider } from '@agent/index'
import { useEntityStore, useRelationStore, useFileStore } from '@worldsmith/entity-core'
import { useSettingsStore } from '../../stores/settingsStore'
import { calculateCost, getModelInfo } from '../../agent/modelRegistry'
import { buildContextInjection, invalidateContextCache } from '@agent/context/builder'
import { saveSession, createSession, getSession, listSessions } from '@agent/index'
import { PermissionGuard } from '@worldsmith/agent-core'
import { getToolMeta } from '@agent/tools/tool-meta-registry'
import { useAgentEvents } from './useAgentEvents'
import { generateTitle } from './useTitleGen'
import { useAgentCommands, bindAgentActions } from './useAgentCommands'
import { useConfirm } from '@worldsmith/ui-kit'
import { TerminalLogBridge } from '../TerminalLogBridge'
import { useTerminal } from './useTerminal'
import { useActivityLog } from '../../space/composables/useActivityLog'
import { useSpaceStore } from '../../space/stores/space-store'
import { setFontTool, executeSetFont, type SetFontResult } from '../setFontTool'
import { useFontLibraryStore } from '../../stores/fontLibraryStore'
import { getWebCliAgentConnection } from './cliAgentConnection'
import { getArchiveTools } from '../../memory-archive'
import { useArchiveStore } from '../../stores/archiveStore'
// 创作编排面板不再需要旧的工作流运行时桥接

/** 工具名中文映射 */
const TOOL_ZH_MAP: Record<string, string> = {
  // 图片与视频
  image_generate: '图片生成',
  image_edit: '图片编辑',
  image_gen_config: '图片配置',
  image_list: '图片列表',
  image_show: '图片展示',
  video_generate: '视频生成',
  video_status: '视频状态',
  video_list: '视频列表',
  video_show: '视频展示',
  video_gen_config: '视频配置',
  // 计划
  plan_create: '创建计划',
  plan_update: '更新计划',
  // 知识库
  content_search: '内容搜索',
  kb_write: '知识写入',
  kb_read: '知识读取',
  kb_search: '知识搜索',
  kb_delete: '知识删除',
  kb_list: '知识列表',
  kb_extract: '知识提取',
  kb_reflect: '知识反思',
  kb_link: '知识关联',
  kb_init: '知识初始化',
  // 记忆
  memory_store: '记忆存储',
  memory_recall: '记忆回忆',
  memory_delete: '记忆删除',
  // 联网
  web_search: '联网搜索',
  web_fetch: '网页抓取',
  web_search_cli: '搜索命令',
  web_fetch_cli: '抓取命令',
  web_qa_cli: '问答命令',
  web_dns_cli: 'DNS查询',
  web_ping_cli: 'Ping检测',
  // 文件
  file_read: '文件读取',
  file_write: '文件写入',
  file_list: '文件列表',
  file_delete: '文件删除',
  file_associate: '文件关联',
  file_analyze: '文件分析',
  fs_read: '读取文件',
  fs_write: '写入文件',
  fs_list: '文件列表',
  fs_move: '移动文件',
  fs_delete: '删除文件',
  fs_search: '搜索文件',
  // 系统
  sys_info: '系统信息',
  sys_processes: '进程列表',
  sys_disk: '磁盘信息',
  execute_command: '执行命令',
  detect_terminal_mode: '检测终端',
  start_server: '启动服务',
  launch_terminal: '启动终端',
  launch_terminal_script: '终端脚本',
  detect_shells: '检测Shell',
  shell_session_create: '创建Shell会话',
  shell_session_exec: '执行Shell命令',
  shell_session_input: 'Shell交互输入',
  shell_session_destroy: '销毁Shell会话',
  shell_session_list: 'Shell会话列表',
  // 编码 Agent 标准工具
  read_file: '读取文件',
  write_file: '写入文件',
  edit_file: '编辑文件',
  search_files: '搜索文件',
  list_directory: '列出目录',
  shell_session: 'Shell会话',
  // 人格
  persona_apply: '人格附体',
  persona_reset: '人格重置',
  persona_update: '人格更新',
  // 技能
  load_skill: '加载技能',
  // UI
  ui_create_surface: '创建界面',
  ui_update_components: '更新组件',
  ui_update_data: '更新数据',
  ui_delete_surface: '删除界面',
  a2ui_show_entity: '展示实体',
  a2ui_show_relation: '展示关系',
  // 模块构建
  module_builder_add_component: '添加组件',
  module_builder_remove_component: '移除组件',
  module_builder_update_config: '更新配置',
  module_builder_suggest_layout: '布局建议',
  // 改造
  retrofit_begin_session: '开始改造',
  retrofit_submit_intent: '提交意图',
  retrofit_confirm_and_stage: '确认暂存',
  retrofit_apply_next: '应用下一步',
  retrofit_verify_and_accept: '验证验收',
  retrofit_request_repair: '请求修复',
  retrofit_redirect: '重定向',
  retrofit_rollback_last: '回滚上步',
  retrofit_abort: '中止改造',
  retrofit_session_phase: '改造阶段',
  retrofit_patch_diff: '补丁差异',
  retrofit_patch_apply: '应用补丁',
  retrofit_detect_conflicts: '检测冲突',
  retrofit_end_session: '结束改造',
  retrofit_apply: '应用改造',
  retrofit_undo: '撤销改造',
  // 算法
  algo_run: '算法执行',
  algo_list: '算法列表',
  algo_spatial_insert: '空间插入',
  algo_spatial_query: '空间查询',
  algo_spatial_clear: '空间清除',
  algo_segment_intersect: '线段相交',
  algo_find_intersections: '查找交点',
  algo_point_in_polygon: '点在多边形',
  algo_polygon_metrics: '多边形度量',
  algo_convex_hull: '凸包',
  algo_collision_check: '碰撞检测',
  algo_shortest_path: '最短路径',
  algo_k_shortest_paths: 'K最短路径',
  algo_topological_sort: '拓扑排序',
  algo_graph_analysis: '图分析',
  algo_force_layout: '力导向布局',
  algo_crdt_lww: 'CRDT-LWW',
  algo_crdt_orset: 'CRDT-ORSet',
  algo_crdt_rga: 'CRDT-RGA',
  algo_crdt_vector_clock: '向量时钟',
  algo_terrain_noise: '地形噪声',
  algo_terrain_heightmap: '地形高度图',
  algo_terrain_contour: '地形等高线',
  algo_constraint_solve: '约束求解',
  algo_dxf_parse: 'DXF解析',
  algo_dxf_generate: 'DXF生成',
  algo_dxf_extract_constraints: 'DXF约束',
  algo_polygon_boolean: '多边形布尔',
  algo_polygon_offset: '多边形偏移',
  algo_pagerank: 'PageRank',
  algo_community_detection: '社区发现',
  algo_hydraulic_erosion: '水力侵蚀',
  algo_viewshed: '可视域',
  algo_chaikin_smooth: 'Chaikin平滑',
  algo_find_shared_edges: '共享边',
  algo_find_line_polygon_intersections: '线面交点',
  algo_polygon_split: '多边形分割',
  algo_polygon_augment: '多边形增强',
  // 实体与关系
  entity_create: '创建实体',
  entity_get: '获取实体',
  entity_update: '更新实体',
  entity_delete: '删除实体',
  entity_list: '实体列表',
  entity_get_context: '获取实体上下文',
  entity_suggest_field: '字段智能建议',
  entity_smart_fill: '一键智能填充',
  relation_create: '创建关系',
  relation_list: '关系列表',
  relation_delete: '删除关系',
  relation_update: '更新关系',
  // Schema
  schema_register_entity_type: '注册实体类型',
  schema_unregister_entity_type: '注销实体类型',
  schema_get_entity_type: '获取实体类型',
  schema_list_entity_types: '实体类型列表',
  schema_update_entity_type: '更新实体类型',
  schema_register_validation: '注册校验',
  schema_register_view: '注册视图',
  schema_validate: '校验',
  schema_export: '导出Schema',
  // 插件后端
  timeline_create_event: '创建时间线事件',
  timeline_update_event: '更新时间线事件',
  timeline_sort_events: '排序事件',
  timeline_detect_conflicts: '检测冲突',
  timeline_get_events: '获取事件',
  timeline_export_timeline: '导出时间线',
  graph_get_nodes: '获取图节点',
  graph_get_edges: '获取图边',
  graph_find_path: '查找路径',
  graph_cluster_analysis: '聚类分析',
  graph_highlight_nodes: '高亮节点',
  graph_export_snapshot: '导出快照',
  mindmap_create_node: '创建思维节点',
  mindmap_update_node: '更新思维节点',
  mindmap_delete_node: '删除思维节点',
  mindmap_get_structure: '获取结构',
  mindmap_auto_layout: '自动布局',
  mindmap_export_image: '导出思维图',
  manuscript_create_chapter: '创建章节',
  manuscript_update_chapter: '更新章节',
  manuscript_list_chapters: '章节列表',
  manuscript_get_chapter_content: '获取章节内容',
  manuscript_insert_mention: '插入引用',
  manuscript_export_document: '导出文档',
  outline_create_node: '创建大纲节点',
  outline_update_node: '更新大纲节点',
  outline_move_node: '移动大纲节点',
  outline_get_structure: '获取大纲',
  outline_link_entity: '关联实体',
  outline_export_outline: '导出大纲',
  notebook_create_note: '创建笔记',
  notebook_update_note: '更新笔记',
  notebook_list_notes: '笔记列表',
  notebook_execute_code: '执行代码',
  notebook_create_backlink: '创建反向链接',
  notebook_export_note: '导出笔记',
  tactical_deploy_unit: '部署单位',
  tactical_move_unit: '移动单位',
  tactical_get_battle_state: '获取战斗状态',
  tactical_simulate_turn: '模拟回合',
  tactical_export_battle_log: '导出战斗日志',
  magic_create_skill_node: '创建技能节点',
  magic_update_skill_node: '更新技能节点',
  magic_get_skill_tree: '获取技能树',
  magic_validate_tree: '验证技能树',
  magic_export_skill_tree: '导出技能树',
  // 插件
  plugin_write: '写入插件',
  notebook_create: '创建笔记本',
  notebook_update: '更新笔记本',
  notebook_link: '关联笔记本',
  code_execute: '执行代码',
  // 工作流
  workflow_list: '工作流列表',
  workflow_get: '获取工作流',
  workflow_create: '创建工作流',
  workflow_update: '更新工作流',
  workflow_delete: '删除工作流',
  workflow_export: '导出工作流',
  workflow_import: '导入工作流',
  workflow_dry_run: '试运行',
  workflow_run: '运行工作流',
  workflow_run_sync: '同步运行',
  workflow_status: '工作流状态',
  workflow_list_runs: '运行列表',
  workflow_get_run: '获取运行',
  workflow_cancel: '取消工作流',
  workflow_pause: '暂停工作流',
  workflow_resume: '恢复工作流',
  workflow_list_node_types: '节点类型列表',
  workflow_get_node_schema: '节点Schema',
  // 编排
  list_sub_agent_types: '子代理类型',
  dispatch_sub_agent: '派发子代理',
  get_sub_agent_status: '子代理状态',
  cancel_sub_agent: '取消子代理',
  // 创作编排
  pipeline_list: '计划列表',
  pipeline_get: '计划详情',
  pipeline_create: '创建计划',
  pipeline_update: '更新计划',
  pipeline_delete: '删除计划',
  pipeline_run_step: '执行步骤',
  pipeline_propose: '提议计划',
  pipeline_template_list: '模板列表',
  pipeline_template_apply: '套用模板',
  // 项目
  project_export: '项目导出',
  project_import: '项目导入',
  // 日常任务
  daily_report: '日报',
  consistency_check: '一致性检查',
  // 输出
  output_table: '输出表格',
  output_choice: '输出选择',
  output_code: '输出代码',
  output_entity_card: '输出实体卡',
  output_alert: '输出警告',
  output_stat: '输出统计',
  output_list: '输出列表',
  output_progress: '输出进度',
  output_comparison: '输出对比',
  output_timeline: '输出时间线',
  output_image: '输出图片',
  output_accordion: '输出折叠',
  output_manuscript: '输出文境',
  manuscript_clone: '克隆文境',
  // 视觉
  vision_analyze: '视觉分析',
  list_vision_images: '视觉图片列表',
  // Git
  git_status: 'Git状态',
  git_log: 'Git日志',
  git_diff: 'Git差异',
  git_commit: 'Git提交',
  git_branch: 'Git分支',
  // 包管理
  pkg_install: '安装包',
  pkg_run: '运行包',
  pkg_info: '包信息',
}

function toolNameZh(name: string): string {
  return TOOL_ZH_MAP[name] || name.replace(/^algo_/, '算法:').replace(/^retrofit_/, '改造:').replace(/^sys_/, '系统:').replace(/^kb_/, '知识库:').replace(/^memory_/, '记忆:').replace(/^web_/, '网络:').replace(/^file_/, '文件:').replace(/^image_/, '图片:').replace(/^video_/, '视频:').replace(/^plan_/, '计划:')
}

const backend = ref<IAgentBackend | null>(null)
const isVisible = ref(false)
const isInitialized = ref(false)
const messages = ref<AgentMessage[]>([])
const isStreaming = ref(false)
const currentSessionId = ref<string | null>(null)
const initError = ref<string | null>(null)
const isPinned = ref(true)
const activeChatMode = ref<ChatMode>('normal')
const lockedChatMode = ref<ChatMode | null>(null)
/** 会话级别的模式锁定：首条消息发送后锁定，切换会话时从会话恢复 */
const sessionChatMode = ref<ChatMode | null>(null)

/** 深度模式虚拟段落列表 */
const deepSegments = ref<DeepSegment[]>([])
/** 最终结论区（Agent 结束后的最后输出） */
const finalOutput = ref<FinalOutput | null>(null)
/** 当前深度段落所属的阶段ID */
let currentPhaseId: string | null = null
let currentPhaseLabel: string | null = null
let phaseCounter = 0
/** 追踪是否已有工具调用（用于区分中间输出和最终输出） */
let hasToolCallsInCurrentTurn = false
const toolCallNameMap = new Map<string, string>()
/** 深度模式内联确认：等待用户确认的工具 Promise 解析器 */
const pendingConfirmations = new Map<string, { resolve: (approved: boolean) => void; _resolved?: boolean; _approved?: boolean }>()
const totalUsage = ref<{
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalCost: number
  savedByCache: number
  requestCount: number
}>({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalCost: 0,
  savedByCache: 0,
  requestCount: 0,
})

const lastRequestUsage = ref<{
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}>({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
})

const EMPTY_USAGE: SessionUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalCost: 0,
  savedByCache: 0,
  requestCount: 0,
}

const CUMULATIVE_STORAGE_KEY = 'worldsmith_cumulative_usage'

function loadCumulativeUsage(): SessionUsage {
  try {
    const raw = localStorage.getItem(CUMULATIVE_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        inputTokens: parsed.inputTokens || 0,
        outputTokens: parsed.outputTokens || 0,
        cacheReadTokens: parsed.cacheReadTokens || 0,
        cacheWriteTokens: parsed.cacheWriteTokens || 0,
        totalCost: parsed.totalCost || 0,
        savedByCache: parsed.savedByCache || 0,
        requestCount: parsed.requestCount || 0,
      }
    }
  } catch { }
  return { ...EMPTY_USAGE }
}

function saveCumulativeUsage(usage: SessionUsage): void {
  try {
    localStorage.setItem(CUMULATIVE_STORAGE_KEY, JSON.stringify(usage))
  } catch { }
}

const cumulativeUsage = ref<SessionUsage>(loadCumulativeUsage())

const cacheHitRate = readonly(computed(() => {
  const totalInput = totalUsage.value.inputTokens + totalUsage.value.cacheReadTokens + totalUsage.value.cacheWriteTokens
  if (totalInput === 0) return 0
  return Math.round((totalUsage.value.cacheReadTokens / totalInput) * 100)
}))
let toolContext: any = null
let searchConfigCache: { engine?: string; apiKey?: string } = {}
let providerConfig: ProviderConfig | null = null
let contentBase = ''
let hasAssistantInCurrentRun = false

interface A2UISurface {
  surfaceId: string
  catalogId: string
  theme?: Record<string, unknown>
  components: Record<string, any>
  rootIds: string[]
  dataModel: Record<string, unknown>
}

const a2uiSurfaces = ref<Record<string, A2UISurface>>({})

function findRootIds(components: Record<string, any>): string[] {
  if (components['root']) return ['root']
  const childIds = new Set<string>()
  for (const comp of Object.values(components)) {
    const ch = comp.children
    if (Array.isArray(ch)) {
      for (const id of ch) childIds.add(id)
    }
  }
  const roots: string[] = []
  for (const id of Object.keys(components)) {
    if (!childIds.has(id)) roots.push(id)
  }
  return roots
}

function handleA2UIEvent(surfaceId: string, message: A2UIMessage): void {
  if ('createSurface' in message) {
    a2uiSurfaces.value = {
      ...a2uiSurfaces.value,
      [surfaceId]: {
        surfaceId,
        catalogId: message.createSurface.catalogId,
        theme: message.createSurface.theme,
        components: {},
        rootIds: [],
        dataModel: {},
      },
    }
  } else if ('updateComponents' in message) {
    const surface = a2uiSurfaces.value[surfaceId]
    if (!surface) return
    const newComponents = { ...surface.components }
    for (const comp of message.updateComponents.components) {
      newComponents[comp.id] = { ...comp }
    }
    const newRootIds = findRootIds(newComponents)
    a2uiSurfaces.value = {
      ...a2uiSurfaces.value,
      [surfaceId]: { ...surface, components: newComponents, rootIds: newRootIds },
    }
  } else if ('updateDataModel' in message) {
    const surface = a2uiSurfaces.value[surfaceId]
    if (!surface) return
    const newDataModel = JSON.parse(JSON.stringify(surface.dataModel))
    setNestedValue(newDataModel, message.updateDataModel.path, message.updateDataModel.value)
    a2uiSurfaces.value = {
      ...a2uiSurfaces.value,
      [surfaceId]: { ...surface, dataModel: newDataModel },
    }
  } else if ('deleteSurface' in message) {
    const newSurfaces = { ...a2uiSurfaces.value }
    delete newSurfaces[surfaceId]
    a2uiSurfaces.value = newSurfaces
  }
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('/').filter(Boolean)
  if (parts.length === 0) {
    if (typeof value === 'object' && value !== null) Object.assign(obj, value as Record<string, unknown>)
    return
  }
  let current: any = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in current)) current[parts[i]] = {}
    current = current[parts[i]]
  }
  current[parts[parts.length - 1]] = value
}

function resolveDataBinding(binding: any, dataModel: Record<string, unknown>): any {
  if (binding && typeof binding === 'object' && 'path' in binding) {
    const parts = (binding.path as string).split('/').filter(Boolean)
    let current: any = dataModel
    for (const part of parts) {
      if (current == null || typeof current !== 'object') return undefined
      current = current[part]
    }
    return current
  }
  return binding
}

async function refreshSearchConfig(): Promise<void> {
  try {
    const raw = localStorage.getItem('agent_search_config')
    const cfg = raw ? JSON.parse(raw) : {}
    const engine = cfg.engine || 'tavily'
    const apiKey = await loadApiKey('search_' + engine)
    searchConfigCache = { engine, apiKey: apiKey || '' }
  } catch {
    searchConfigCache = {}
  }
}

function applySavedAgentSettings(): void {
  if (!providerConfig) return
  try {
    const raw = localStorage.getItem('agent_settings')
    if (raw) {
      const s = JSON.parse(raw)
      if (s.temperature !== undefined) (providerConfig as any).temperature = s.temperature / 100
      if (s.maxTokens !== undefined) (providerConfig as any).maxTokens = s.maxTokens
    }
  } catch { }
}

/**
 * 工具权限守卫
 *
 * 基于 @worldsmith/agent-core 的 PermissionGuard，
 * 从工具元数据自动解析权限级别，取代硬编码列表。
 * 新增工具时只需在 ToolMeta 中声明权限，自动传播到所有消费方。
 */
function createPermissionGuard(): PermissionGuard {
  const settingsStore = useSettingsStore()
  return new PermissionGuard(getToolMeta, {
    confirmModerate: settingsStore.aiDangerConfirm,
    confirmDangerous: true,
  })
}

const { handleEvent: handlePreviewEvent } = useAgentEvents()

let _pendingPluginPrompt: string | null = null
let _pendingPluginChatMode: ChatMode = 'deep'
let _pluginActionListenerBound = false
let _sendRef: ((text: string, images?: ImageAttachment[], files?: FileAttachment[], chatMode?: ChatMode) => Promise<void>) | null = null

function _bindPluginActionListener() {
  if (_pluginActionListenerBound || typeof window === 'undefined') return
  _pluginActionListenerBound = true
  window.addEventListener('worldsmith:agent:plugin-action', ((e: CustomEvent) => {
    const detail = e.detail
    if (!detail?.payload?.prompt) return
    if (_sendRef) {
      _sendRef(String(detail.payload.prompt), undefined, undefined, 'deep')
        ; (detail as Record<string, unknown>).__consumed = true
    } else {
      _pendingPluginPrompt = String(detail.payload.prompt)
    }
  }) as EventListener)
}

_bindPluginActionListener()

// ── Smart Fill 事件桥接 ──────────────────────────────────────────────────
// Smart Fill 使用独立 subBackend，不与主聊天共享状态，避免并发冲突。

let _smartFillListenerBound = false
let _smartFillBackend: IAgentBackend | null = null
let _smartFillBusy = false
let _smartFillRequestHandler: ((e: Event) => void) | null = null

/** 从 Agent 文本回复中解析字段建议值 */
function _parseSuggestionFromReply(content: string): string {
  // 尝试提取 JSON 中的值
  const jsonMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1])
      if (typeof parsed === 'string') return parsed
      if (parsed.suggestion) return String(parsed.suggestion)
      if (parsed.value) return String(parsed.value)
    } catch {}
  }
  // 尝试提取行内 JSON
  try {
    const parsed = JSON.parse(content.trim())
    if (typeof parsed === 'string') return parsed
    if (parsed.suggestion) return String(parsed.suggestion)
  } catch {}
  // 去除 markdown 标记后直接返回
  return content
    .replace(/```[\s\S]*?\n/g, '')
    .replace(/```/g, '')
    .replace(/\{\/?font[^}]*\}/g, '')
    .trim()
}

/** 从 Agent 文本回复中解析一键填充的 JSON 建议 */
function _parseSmartFillFromReply(content: string): Record<string, string> {
  // 尝试提取 JSON 代码块
  const jsonMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1])
      if (typeof parsed === 'object' && !Array.isArray(parsed)) {
        return Object.fromEntries(
          Object.entries(parsed).map(([k, v]) => [k, String(v)])
        )
      }
    } catch {}
  }
  // 尝试直接解析整个内容
  try {
    const parsed = JSON.parse(content.trim())
    if (typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed).map(([k, v]) => [k, String(v)])
      )
    }
  } catch {}
  // 尝试提取 "key: value" 格式
  const result: Record<string, string> = {}
  const lines = content.split('\n')
  for (const line of lines) {
    const kvMatch = line.match(/^[-*]?\s*(\w+)\s*[:：]\s*(.+)$/)
    if (kvMatch) {
      result[kvMatch[1]] = kvMatch[2].trim()
    }
  }
  return result
}

/** 获取或创建 Smart Fill 专用 subBackend */
async function _ensureSmartFillBackend(): Promise<IAgentBackend | null> {
  if (_smartFillBackend) return _smartFillBackend
  if (!providerConfig || !toolContext) return null

  try {
    const { getToolsForSkills } = await import('@agent/index')
    const tools = getToolsForSkills(['smart-fill'])
    const fontLibrary = useFontLibraryStore()
    tools.push({
      ...setFontTool,
      execute: async (args: Record<string, unknown>) => {
        const result = await executeSetFont(args as any)
        return JSON.stringify(result)
      },
    } as any)

    const agent = await createWorldSmithAgent({
      providerConfig,
      toolContext,
      tools,
      projectName: 'WorldSmith-SmartFill',
      availableFontFamilies: fontLibrary.entries.map(e => e.family),
    })

    // 追踪当前 Smart Fill 请求的类型，用于解析回复
    let _currentRequestType: 'suggest_field' | 'smart_fill' | null = null
    let _currentFieldKey: string | null = null
    let _currentFieldLabel: string | null = null
    let _currentMode: 'continue' | 'suggest' | null = null

    agent.subscribe((event: AgentEvent) => {
      if (event.type === 'agent_end') {
        _smartFillBusy = false
        // 从最终消息中解析建议值
        const lastMsg = event.messages?.filter((m: any) => m.role === 'assistant').pop()
        const content = lastMsg?.content || ''

        if (_currentRequestType === 'suggest_field' && content) {
          // 字段级建议：Agent 文本回复就是建议值
          const suggestion = _parseSuggestionFromReply(content)
          window.dispatchEvent(new CustomEvent('worldsmith:smart-fill:result', {
            detail: {
              type: 'field_suggestion',
              fieldKey: _currentFieldKey,
              fieldLabel: _currentFieldLabel,
              suggestion,
              mode: _currentMode || 'suggest',
              confidence: 0.8,
            },
          }))
        } else if (_currentRequestType === 'smart_fill' && content) {
          // 一键填充：Agent 文本回复中应包含 JSON 格式的建议
          const suggestions = _parseSmartFillFromReply(content)
          window.dispatchEvent(new CustomEvent('worldsmith:smart-fill:result', {
            detail: {
              type: 'smart_fill_result',
              suggestions,
              notes: [],
            },
          }))
        }

        // Layer D chat-reply 已移至 useSmartFillChat composable 的独立 Agent 后端
      }
      if (event.type === 'error') {
        _smartFillBusy = false
      }
    })

    // 拦截 request 事件来记录当前请求类型
    // 注：请求类型在 _bindSmartFillListener 中通过闭包传递
    // 此处通过 CustomEvent 携带元数据
    // 先移除旧监听器（防止重复注册）
    if (_smartFillRequestHandler) {
      window.removeEventListener('worldsmith:smart-fill:request', _smartFillRequestHandler)
    }
    _smartFillRequestHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.type === 'suggest_field') {
        _currentRequestType = 'suggest_field'
        _currentFieldKey = detail.fieldKey || null
        _currentFieldLabel = detail.fieldLabel || null
        _currentMode = detail.mode || 'suggest'
      } else if (detail?.type === 'smart_fill') {
        _currentRequestType = 'smart_fill'
      }
    }
    window.addEventListener('worldsmith:smart-fill:request', _smartFillRequestHandler)

    _smartFillBackend = agent
    return agent
  } catch (err) {
    console.error('[SmartFill] subBackend 创建失败:', err)
    return null
  }
}

/** Layer A/B: smart-fill:request → Smart Fill subBackend prompt */
async function _onSmartFillRequest(e: Event) {
  const detail = (e as CustomEvent).detail
  if (!detail) return
  if (_smartFillBusy) return // 防止并发

  const backend = await _ensureSmartFillBackend()
  if (!backend) return
  _smartFillBusy = true

  let prompt = ''
  if (detail.type === 'suggest_field') {
    // V2: 根据 isEditing 选择不同的上下文 scope
    const contextHint = detail.isEditing
      ? '这是编辑已有实体，请先调用 entity_get_context(scope=\'relations_only\') 获取关联实体上下文。'
      : '这是新建实体，请先调用 entity_get_context(scope=\'same_type_entities\') 获取同类型实体参考。'
    prompt = [
      `/skill:smart-fill`,
      `请为类型「${detail.entityType}」的实体的「${detail.fieldLabel || detail.fieldKey}」(${detail.fieldKey})字段生成${detail.mode === 'continue' ? '接续预览' : '独立建议'}。`,
      detail.currentText ? `当前已输入：${detail.currentText}` : '',
      detail.entityId ? `实体ID：${detail.entityId}` : '',
      contextHint,
      `请使用 entity_suggest_field 工具，mode 为 ${detail.mode || 'suggest'}。`,
      detail.mode === 'continue'
        ? '只输出接续的文本部分，不要重复已有内容。'
        : '输出完整的建议值。',
    ].filter(Boolean).join('\n')
  } else if (detail.type === 'smart_fill') {
    const emptyFields = detail.emptyFields || []
    // V2: includeExisting 模式
    const includeExistingHint = detail.includeExisting
      ? '请同时为已有内容的字段提供优化/改写建议。'
      : ''
    const toolCallHint = detail.includeExisting
      ? '请使用 entity_smart_fill 工具(includeExisting=true)，然后以 JSON 格式输出所有建议值。'
      : '请使用 entity_smart_fill 工具，然后以 JSON 格式输出所有建议值。'
    prompt = [
      `/skill:smart-fill`,
      `请为类型「${detail.entityType}」的实体执行一键智能填充。`,
      detail.entityId ? `实体ID：${detail.entityId}` : '',
      emptyFields.length > 0 ? `空字段：${emptyFields.join('、')}` : '请识别并填充所有空字段',
      includeExistingHint,
      toolCallHint,
      `输出格式：{"fieldKey": "建议值", ...}`,
    ].filter(Boolean).join('\n')
  }

  if (prompt) {
    try {
      await backend.prompt(prompt)
    } catch (err) {
      _smartFillBusy = false
      console.error('[SmartFill] prompt 失败:', err)
    }
  }
}

function _bindSmartFillListener() {
  if (_smartFillListenerBound || typeof window === 'undefined') return
  _smartFillListenerBound = true

  // Layer A/B: smart-fill:request → Smart Fill subBackend prompt
  window.addEventListener('worldsmith:smart-fill:request', _onSmartFillRequest as EventListener)

  // Layer D 事件监听已移至 useSmartFillChat composable 的独立 Agent 后端
}

_bindSmartFillListener()

export function useAgent() {
  const entityStore = useEntityStore()
  const relationStore = useRelationStore()
  const settingsStore = useSettingsStore()
  const fileStore = useFileStore()

  // 设置 CLI Agent 连接到全局，使 createWorldSmithAgent 能感知
  const cliConnection = getWebCliAgentConnection()
  setActiveCliAgentConnection(cliConnection)

  const { openSettings: _cmdOpenSettings } = useAgentCommands()
  bindAgentActions(sendMessage, _cmdOpenSettings)

  _sendRef = sendMessage
  // Smart Fill 使用独立 subBackend，不再绑定 _smartFillSendRef
  if (_pendingPluginPrompt) {
    const prompt = _pendingPluginPrompt
    _pendingPluginPrompt = null
    sendMessage(prompt, undefined, undefined, _pendingPluginChatMode)
  }

  const { terminalVisible, ptyId, ptyReady, spawnPty, writeToPty, resizePty, killPty, showTerminal, hideTerminal } = useTerminal()
  const logBridge = new TerminalLogBridge()

  async function buildProviderConfig(): Promise<ProviderConfig> {
    const mode = settingsStore.aiProviderMode as 'cloud' | 'local' | 'custom'

    if (mode === 'cloud') {
      const provider = settingsStore.aiCloudProvider as CloudProvider
      const apiKey = await loadApiKey(provider)
      const info = getModelInfo(settingsStore.aiCloudModel)
      return {
        mode: 'cloud',
        provider,
        modelId: settingsStore.aiCloudModel,
        apiKey,
        supportsVision: info?.supportsVision ?? false,
        contextWindow: info?.contextLength,
        maxTokens: info?.maxOutputTokens,
      } as any
    }

    if (mode === 'local') {
      return {
        mode: 'local',
        endpoint: settingsStore.aiLocalEndpoint,
        apiType: settingsStore.aiLocalType as any,
        modelId: settingsStore.aiLocalModel,
      }
    }

    const apiKey = await loadApiKey(settingsStore.getCustomKeyStoreId(settingsStore.aiCustomBaseUrl))
    const cfg: ProviderConfig = {
      mode: 'custom',
      baseUrl: settingsStore.aiCustomBaseUrl,
      apiType: settingsStore.aiCustomType as any,
      modelId: settingsStore.aiCustomModel,
      apiKey,
    }
    if (providerConfig && 'contextWindow' in providerConfig) {
      (cfg as any).contextWindow = (providerConfig as any).contextWindow
    }
    if (providerConfig && 'maxTokens' in providerConfig) {
      (cfg as any).maxTokens = (providerConfig as any).maxTokens
    }
    return cfg
  }

  const { confirm } = useConfirm()

  async function ensureInitialized(): Promise<boolean> {
    if (isInitialized.value && backend.value) return true

    initError.value = null
    await refreshSearchConfig()

    try {
      providerConfig = await buildProviderConfig()
      applySavedAgentSettings()

      if (!currentSessionId.value) {
        const existing = await listSessions()
        if (existing.length > 0) {
          currentSessionId.value = existing[0].id
        } else {
          const session = await createSession(providerConfig.mode, providerConfig.modelId)
          currentSessionId.value = session.id
        }
      }

      toolContext = {
        stores: {
          entity: entityStore,
          relation: relationStore,
          file: fileStore,
          settings: {
            getProviderConfig: () => providerConfig,
            getSearchConfig: () => searchConfigCache,
          },
          ui: {
            confirm: async (title: string, message: string) => {
              return confirm({ type: 'warning', title, description: message })
            },
          },
        },
        projectInfo: {
          get name() {
            try {
              const pm = getProjectManager()
              const id = pm.getCurrentProjectId()
              return id ? `Project-${id.slice(0, 8)}` : 'WorldSmith'
            } catch {
              return 'WorldSmith'
            }
          },
          entityTypes: entityStore.types.map(t => t.type),
          relationTypes: [],
          get dirPath() {
            try {
              const fsb = getFileStorageBackend()
              return fsb?.projectDir ?? null
            } catch {
              return null
            }
          },
        },
        platform: 'web' as const,
        appendBlock: (block: import('@agent/index').MessageBlock) => {
          const last = findLastAssistant()
          if (last) {
            // 文境单例：如果追加的是 manuscript block，先从旧消息中移除已有的 manuscript
            if (block.type === 'manuscript') {
              removeExistingManuscript(block.id)
            }
            console.log('[Agent] appendBlock:', block.type, block.id, '→ msg:', last.id)
            last.blocks = [...(last.blocks || []), block]
            // 深度模式：将 Block 关联到对应的 ToolCallView
            if (activeChatMode.value === 'deep') {
              deepSegments.value = deepSegments.value.map(s => {
                if (s.type === 'phase') {
                  const toolIdx = s.tools.findIndex(t =>
                    (t.interactiveType === 'display' || t.interactiveType === 'choice') && !t.block
                  )
                  if (toolIdx !== -1) {
                    const updatedTools = [...s.tools]
                    updatedTools[toolIdx] = { ...updatedTools[toolIdx], block }
                    return { ...s, tools: updatedTools }
                  }
                }
                return s
              })
            }
          } else {
            console.warn('[Agent] appendBlock: no assistant message found')
          }
        },
        findManuscriptInSession: async (sessionId: string): Promise<import('@agent/index').ManuscriptBlock | null> => {
          try {
            const session = await getSession(sessionId)
            if (!session?.messages) return null
            for (const msg of session.messages) {
              if (!msg.blocks) continue
              const ms = msg.blocks.find((b: any) => b.type === 'manuscript')
              if (ms && ms.type === 'manuscript') return ms as import('@agent/index').ManuscriptBlock
            }
            return null
          } catch {
            return null
          }
        },
        currentSessionId: currentSessionId.value || '',
        getSessionInfo: async (sessionId: string) => {
          try {
            const session = await getSession(sessionId)
            if (!session) return null
            return {
              id: session.id,
              name: session.name,
              createdAt: session.createdAt,
              updatedAt: session.updatedAt,
              messageCount: session.messages.length,
              pinned: session.pinned,
            }
          } catch {
            return null
          }
        },
        listSessions: async (query?: string) => {
          try {
            const all = await listSessions()
            const filtered = query ? all.filter(s => s.name.includes(query)) : all
            return filtered.map(s => ({
              id: s.id,
              name: s.name,
              createdAt: s.createdAt,
              updatedAt: s.updatedAt,
              messageCount: s.messages.length,
              pinned: s.pinned,
            }))
          } catch {
            return []
          }
        },
        readSessionMessages: async (sessionId: string) => {
          try {
            const session = await getSession(sessionId)
            if (!session?.messages) return null
            return session.messages.map(m => ({
              role: m.role,
              content: m.content,
              timestamp: m.timestamp,
            }))
          } catch {
            return null
          }
        },
        /** 深度模式下等待用户确认工具执行（由 bridge.ts execute 调用） */
        waitForConfirmation: (toolCallId: string): Promise<boolean> => {
          // 非深度模式直接放行
          if (activeChatMode.value !== 'deep') return Promise.resolve(true)
          // 如果该工具不在 pendingConfirmations 中（不需要确认），直接放行
          if (!pendingConfirmations.has(toolCallId)) return Promise.resolve(true)
          // 已有 pending 条目且已 resolved（用户在 waitForConfirmation 调用前就点了确认）
          const existing = pendingConfirmations.get(toolCallId)
          if (existing?._resolved) {
            pendingConfirmations.delete(toolCallId)
            return Promise.resolve(existing._approved!)
          }
          // 创建 Promise 等待用户确认，替换占位条目的 resolve
          return new Promise<boolean>((resolve) => {
            pendingConfirmations.set(toolCallId, { resolve, _resolved: false, _approved: undefined })
          })
        },
      }

      const fontLibrary = useFontLibraryStore()
      const { ALL_TOOLS } = await import('@agent/index')
      const mainTools = [...ALL_TOOLS, {
        ...setFontTool,
        execute: async (args: Record<string, unknown>) => {
          const result = await executeSetFont(args as any)
          return JSON.stringify(result)
        },
      } as any, ...getArchiveTools()]
      const agent = await createWorldSmithAgent({
        providerConfig,
        toolContext,
        tools: mainTools,
        projectName: 'WorldSmith',
        availableFontFamilies: fontLibrary.entries.map(e => e.family),
        beforeToolCall: async ({ toolCall }) => {
          const toolName = toolCall.name
          const result = createPermissionGuard().check(toolName, toolCall.args)

          // SAFE: 无需确认
          if (!result.needsConfirm) return void 0

          // 构建确认弹窗内容
          const displayName = result.displayName || toolName
          const argSummary = Object.entries(toolCall.args || {})
            .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
            .join(', ')

          // 深度模式：不在 beforeToolCall 中阻塞（会死锁，因为 tool_execution_start 事件
          // 在 beforeToolCall 返回后才发射，UI 无法渲染确认按钮）。
          // 改为在 tool_execution_start 事件中创建 pendingConfirmation，
          // 在 bridge.ts 的 execute 中通过 toolContext.waitForConfirmation 等待确认。
          if (activeChatMode.value === 'deep') {
            return void 0
          }

          // 非深度模式：使用全局确认弹窗
          if (result.level === 'dangerous') {
            const confirmed = await confirm({
              type: 'warning',
              title: 'AI 请求执行危险操作',
              description: `工具: ${displayName}\n参数: ${argSummary}${result.reason ? '\n\n⚠️ ' + result.reason : ''}\n\n⚠️ 此操作不可逆，是否允许？`,
            })
            if (!confirmed) return { block: true, reason: '用户拒绝' }
            return void 0
          }

          // MODERATE: 仅在开启安全确认时需确认
          if (settingsStore.aiDangerConfirm) {
            const confirmed = await confirm({
              type: 'warning',
              title: 'AI 请求执行操作',
              description: `工具: ${displayName}\n参数: ${argSummary}\n\n是否允许？`,
            })
            if (!confirmed) return { block: true, reason: '用户拒绝' }
          }
          return void 0
        },
      })

      agent.subscribe((event: AgentEvent) => {
        handleAgentEvent(event)
      })

      backend.value = agent
      isInitialized.value = true

      // P12 决策：agent 初始化成功后恢复归档边界（从 sessionStorage）
      try {
        useArchiveStore().restoreBoundary()
      } catch (err) {
        console.warn('[Agent] ensureInitialized: 恢复归档边界失败:', err)
      }

      // 创作编排面板通过 Agent Skill 执行步骤，不再需要旧的运行时桥接

      registerDefaultCommands()
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      initError.value = msg
      console.error('[Agent Init Error]', msg)
      return false
    }
  }

  function registerDefaultCommands(): void {
    const { register: registerCmd } = useAgentCommands()

    registerCmd({
      id: 'cmd.worldbuilding',
      label: '世界观构建',
      icon: 'globe',
      description: '协助构建世界观',
      category: 'skill',
      handler: () => sendMessageWithSkill('/skill:worldbuilding', ['worldbuilding']),
    })
    registerCmd({
      id: 'cmd.roleplay',
      label: '角色推演',
      icon: 'sparkles',
      description: '基于角色属性推演行为',
      category: 'skill',
      handler: () => sendMessageWithSkill('/skill:roleplay', ['roleplay']),
    })
    registerCmd({
      id: 'cmd.generate',
      label: '内容生成',
      icon: '✨',
      description: '批量生成实体和内容',
      category: 'skill',
      handler: () => sendMessageWithSkill('/skill:content-craft', ['content-craft']),
    })
    registerCmd({
      id: 'cmd.analysis',
      label: '算法分析',
      icon: '🔬',
      description: '运行图/几何/地形算法',
      category: 'skill',
      handler: () => sendMessageWithSkill('/skill:analysis-engine', ['analysis-engine']),
    })
    registerCmd({
      id: 'cmd.retrofit',
      label: '安全改造',
      icon: '🔧',
      description: '修改项目结构和Schema',
      category: 'skill',
      handler: () => sendMessageWithSkill('/skill:retrofit-architect', ['retrofit-architect']),
    })
    registerCmd({
      id: 'cmd.webscout',
      label: '联网搜索',
      icon: '🌐',
      description: '搜索互联网获取信息',
      category: 'skill',
      handler: () => sendMessageWithSkill('/skill:web-scout', ['web-scout']),
    })
    registerCmd({
      id: 'cmd.output',
      label: '输出编排',
      icon: 'target',
      description: '智能选择输出形式',
      category: 'skill',
      handler: () => sendMessageWithSkill('/skill:output-orchestrator', ['output-orchestrator']),
    })
    registerCmd({
      id: 'cmd.search',
      label: '搜索项目',
      icon: 'search',
      description: '搜索项目内容',
      category: 'action',
      handler: () => sendMessage('请搜索项目中的相关内容'),
    })
    registerCmd({
      id: 'cmd.report',
      label: '每日报告',
      icon: 'chart',
      description: '生成项目状态报告',
      category: 'action',
      handler: () => sendMessage('请生成今日项目状态报告'),
    })
    registerCmd({
      id: 'cmd.consistency',
      label: '一致性检查',
      icon: 'search',
      description: '检查数据一致性',
      category: 'action',
      handler: () => sendMessage('请检查项目数据一致性'),
    })
  }

  const { addLog } = useActivityLog()

  function handleAgentEvent(event: AgentEvent): void {
    handlePreviewEvent(event)

    switch (event.type) {
      case 'agent_start':
        isStreaming.value = true
        contentBase = ''
        hasAssistantInCurrentRun = false
        if (event.chatMode && lockedChatMode.value === null) activeChatMode.value = event.chatMode
        addLog('info', `开始响应（模式: ${{ normal: '快问快答', deep: '深度思考', explore: '知识探索' }[event.chatMode] || event.chatMode}）`)
        // 深度模式：重置段落状态
        if (activeChatMode.value === 'deep') {
          deepSegments.value = []
          finalOutput.value = null
          currentPhaseId = null
          currentPhaseLabel = null
          phaseCounter = 0
          hasToolCallsInCurrentTurn = false
        }
        break
      case 'agent_end':
        isStreaming.value = false
        // 闭合最后一个未闭合的字体标记
        const lastAssistant = findLastAssistant()
        if (lastAssistant?.content) {
          const openCount = (lastAssistant.content.match(/\{font:/g) || []).length
          const closeCount = (lastAssistant.content.match(/\{\/font\}/g) || []).length
          if (openCount > closeCount) {
            lastAssistant.content += '{/font}'
          }
        }
        hasAssistantInCurrentRun = false
        lockedChatMode.value = null
        // 深度模式：标记所有段落为完成
        if (activeChatMode.value === 'deep') {
          deepSegments.value = deepSegments.value.map(s => {
            if (s.type === 'thinking' && s.status === 'streaming') return { ...s, status: 'complete' as const }
            if (s.type === 'phase') {
              const needsUpdate = s.status === 'active' || s.outputs.some(o => o.status === 'streaming')
              if (needsUpdate) {
                return {
                  ...s,
                  status: 'done' as const,
                  outputs: s.outputs.map(o => o.status === 'streaming' ? { ...o, status: 'complete' as const } : o),
                }
              }
            }
            return s
          })
          if (finalOutput.value && finalOutput.value.status === 'streaming') {
            finalOutput.value = { ...finalOutput.value, status: 'complete' }
          }
        }
        if (event.messages?.length) {
          const existing = findLastAssistant()
          if (!existing) {
            const lastMsg = event.messages[event.messages.length - 1]
            if (lastMsg && lastMsg.role === 'assistant' && (lastMsg.content || lastMsg.thinking)) {
              messages.value.push(lastMsg)
            }
          }
        }
        generateTitleIfNeeded()
        autoSaveSession()
        // Smart Fill 回复路由：如果当前会话由 Smart Fill 触发，将最终回复转发给小窗
        break
      case 'turn_end':
        if (event.message && event.message.role !== 'user') {
          if (!event.message.metadata) event.message.metadata = {}
          if (!event.message.metadata.chatMode) event.message.metadata.chatMode = activeChatMode.value
          if (hasAssistantInCurrentRun) {
            const last = findLastAssistant()
            if (last) {
              contentBase = last.content ? last.content + '\n' : ''
            }
          } else {
            messages.value.push(event.message)
            hasAssistantInCurrentRun = true
          }
        }
        break
      case 'message_start':
        if (event.message?.role === 'assistant' && !hasAssistantInCurrentRun) {
          messages.value.push(event.message)
          hasAssistantInCurrentRun = true
        }
        break
      case 'message_update':
        const updateTarget = findLastAssistant()
        if (updateTarget) {
          if (event.content) updateTarget.content = contentBase + event.content
          if (event.thinking) updateTarget.thinking = event.thinking
        }
        // 深度模式：构建虚拟段落
        if (activeChatMode.value === 'deep') {
          if (event.thinking) {
            // thinking 段：更新当前 streaming 的，或创建新的
            const existingThinking = deepSegments.value.find(s => s.type === 'thinking' && s.status === 'streaming')
            if (existingThinking && existingThinking.type === 'thinking') {
              existingThinking.thinking = event.thinking
            } else {
              deepSegments.value = [...deepSegments.value, {
                id: crypto.randomUUID(),
                type: 'thinking',
                thinking: event.thinking,
                timestamp: Date.now(),
                status: 'streaming',
              }]
            }
          }
          if (event.content) {
            const contentText = contentBase + event.content
            if (hasToolCallsInCurrentTurn && currentPhaseId) {
              // 有工具调用时：输出归入当前阶段的中间输出
              const updated = deepSegments.value.map(s => {
                if (s.type === 'phase' && s.id === currentPhaseId) {
                  const existingOut = s.outputs.find(o => o.status === 'streaming')
                  if (existingOut) {
                    return { ...s, outputs: s.outputs.map(o => o.id === existingOut.id ? { ...o, content: contentText } : o) }
                  } else {
                    return { ...s, outputs: [...s.outputs, { id: crypto.randomUUID(), content: contentText, timestamp: Date.now(), status: 'streaming' as const }] }
                  }
                }
                return s
              })
              deepSegments.value = updated
              // 同时更新 finalOutput，让用户在"结论"卡片中实时看到 Agent 输出
              if (finalOutput.value && finalOutput.value.status === 'streaming') {
                finalOutput.value = { ...finalOutput.value, content: contentText }
              } else {
                finalOutput.value = {
                  content: contentText,
                  blocks: [],
                  images: [],
                  files: [],
                  status: 'streaming',
                }
              }
            } else {
              // 无工具调用时：输出归入最终结论区
              if (finalOutput.value && finalOutput.value.status === 'streaming') {
                finalOutput.value = { ...finalOutput.value, content: contentText }
              } else {
                finalOutput.value = {
                  content: contentText,
                  blocks: [],
                  images: [],
                  files: [],
                  status: 'streaming',
                }
              }
            }
          }
        }
        break
      case 'message_end':
        const endMsg = findLastAssistant()
        if (endMsg) {
          if (event.content) endMsg.content = contentBase + event.content
          if (event.thinking) endMsg.thinking = event.thinking
          contentBase = endMsg.content ? endMsg.content + '\n' : ''
        }
        if (event.usage) {
          accumulateUsage(event.usage)
        }
        // 深度模式：将阶段内的 streaming output 标记为 complete
        if (activeChatMode.value === 'deep') {
          deepSegments.value = deepSegments.value.map(s => {
            if (s.type === 'phase' && s.outputs.some(o => o.status === 'streaming')) {
              return { ...s, outputs: s.outputs.map(o => o.status === 'streaming' ? { ...o, status: 'complete' as const } : o) }
            }
            return s
          })
          // 将 finalOutput 标记为 complete
          if (finalOutput.value && finalOutput.value.status === 'streaming') {
            finalOutput.value = { ...finalOutput.value, status: 'complete' as const }
          }
          // 从最后一个 phase 段中移除与 finalOutput 重复的 output
          // （content 已同时写入 phase.outputs 和 finalOutput，避免重复显示）
          if (finalOutput.value) {
            const lastPhase = [...deepSegments.value].reverse().find(s => s.type === 'phase')
            if (lastPhase && lastPhase.type === 'phase' && lastPhase.outputs.length > 0) {
              const lastOutput = lastPhase.outputs[lastPhase.outputs.length - 1]
              // 如果最后一个 output 的内容与 finalOutput 相同，移除它
              if (lastOutput && lastOutput.content === finalOutput.value.content) {
                deepSegments.value = deepSegments.value.map(s => {
                  if (s.type === 'phase' && s.id === lastPhase.id) {
                    return { ...s, outputs: s.outputs.filter(o => o.id !== lastOutput.id) }
                  }
                  return s
                })
              }
            }
          }
        }
        break
      case 'tool_execution_start':
        const tcTarget = findLastAssistant()
        if (tcTarget) {
          const existing = tcTarget.toolCalls || []
          const dupIdx = existing.findIndex(t => t.id === event.toolCall.id)
          if (dupIdx !== -1) {
            const updated = [...existing]
            updated[dupIdx] = { ...updated[dupIdx], status: 'running', startedAt: Date.now() }
            tcTarget.toolCalls = updated
          } else {
            tcTarget.toolCalls = [...existing, {
              id: event.toolCall.id,
              name: event.toolCall.name,
              args: event.toolCall.args as Record<string, unknown>,
              status: 'running',
              startedAt: Date.now(),
            }]
          }
        }
        addLog('tool', `调用工具: ${toolNameZh(event.toolCall.name)}`, JSON.stringify(event.toolCall.args))
        toolCallNameMap.set(event.toolCall.id, event.toolCall.name)
        // 深度模式：将工具调用内嵌到阶段容器
        if (activeChatMode.value === 'deep') {
          hasToolCallsInCurrentTurn = true
          // 先将当前 streaming 的 thinking 段标记为 complete
          deepSegments.value = deepSegments.value.map(s => {
            if (s.type === 'thinking' && s.status === 'streaming') return { ...s, status: 'complete' as const }
            return s
          })
          const phaseLabel = inferPhase(event.toolCall.name)
          // 获取工具权限级别和交互分类
          const toolPermission = getToolMeta(event.toolCall.name).permission as 'safe' | 'moderate' | 'dangerous'
          // moderate 权限且未开启安全确认时，视为普通工具
          const effectivePermission = (toolPermission === 'moderate' && !settingsStore.aiDangerConfirm) ? 'safe' : toolPermission
          const interactiveType = classifyInteractive(event.toolCall.name, effectivePermission)
          // 深度模式下需要确认的工具：创建 pendingConfirmation 占位条目
          // waitForConfirmation 会在 bridge.ts execute 中被调用，届时替换 resolve
          if (interactiveType === 'confirm') {
            pendingConfirmations.set(event.toolCall.id, { resolve: () => {}, _resolved: false, _approved: undefined })
          }
          const newTool: ToolCallView = {
            id: event.toolCall.id,
            name: event.toolCall.name,
            args: event.toolCall.args as Record<string, unknown>,
            status: 'running',
            startedAt: Date.now(),
            interactiveType,
            permissionLevel: toolPermission,
          }
          // 如果阶段变化，创建新的阶段容器
          if (phaseLabel !== currentPhaseLabel) {
            // 将旧阶段标记为 done
            if (currentPhaseId) {
              deepSegments.value = deepSegments.value.map(s => {
                if (s.type === 'phase' && s.id === currentPhaseId && s.status === 'active') return { ...s, status: 'done' as const }
                return s
              })
            }
            currentPhaseId = crypto.randomUUID()
            currentPhaseLabel = phaseLabel
            deepSegments.value = [...deepSegments.value, {
              id: currentPhaseId,
              type: 'phase',
              label: phaseLabel,
              index: phaseCounter++,
              timestamp: Date.now(),
              tools: [newTool],
              outputs: [],
              status: 'active',
            }]
          } else if (currentPhaseId) {
            // 同阶段：将工具追加到当前阶段容器
            deepSegments.value = deepSegments.value.map(s => {
              if (s.type === 'phase' && s.id === currentPhaseId) {
                return { ...s, tools: [...s.tools, newTool] }
              }
              return s
            })
          }
        }
        break
      case 'tool_execution_end':
        const tcEndTarget = findLastAssistant()
        if (tcEndTarget?.toolCalls) {
          const idx = tcEndTarget.toolCalls.findIndex(t => t.id === event.toolCallId)
          if (idx !== -1) {
            const updated = [...tcEndTarget.toolCalls]
            updated[idx] = {
              ...updated[idx],
              status: event.success ? 'completed' : 'failed',
              result: event.result,
              endedAt: Date.now(),
            }
            tcEndTarget.toolCalls = updated
          }
        }
        // 深度模式：更新阶段容器内的工具状态
        if (activeChatMode.value === 'deep') {
          deepSegments.value = deepSegments.value.map(s => {
            if (s.type === 'phase') {
              const toolIdx = s.tools.findIndex(t => t.id === event.toolCallId)
              if (toolIdx !== -1) {
                const updatedTools = [...s.tools]
                updatedTools[toolIdx] = {
                  ...updatedTools[toolIdx],
                  status: event.success ? 'completed' : 'failed',
                  result: event.result,
                  endedAt: Date.now(),
                }
                return { ...s, tools: updatedTools }
              }
            }
            return s
          })
        }
        if (!event.success) {
          addLog('error', `工具失败: ${event.toolCallId}`)
        }
        const tcName = toolCallNameMap.get(event.toolCallId)
        toolCallNameMap.delete(event.toolCallId)
        if (event.success && tcName === 'persona_update') {
          try {
            const result = JSON.parse(event.result || '{}')
            if (result.success) {
              const spaceStore = useSpaceStore()
              const patch: { name?: string; avatar?: string } = {}
              if (result.name) patch.name = result.name
              if (result.avatar) patch.avatar = result.avatar
              if (patch.name || patch.avatar) {
                spaceStore.updatePersona(patch)
                addLog('info', `人格更新: ${result.updates?.join(', ') || '已更新'}`)
              }
            }
          } catch { }
        }
        if (event.success && tcName === 'set_font') {
          try {
            const result: SetFontResult = JSON.parse(event.result || '{}')
            if (result.status === 'applied') {
              const last = findLastAssistant()
              if (last) {
                // 如果之前有未闭合的字体标记，先闭合
                if (last.content) {
                  const openCount = (last.content.match(/\{font:/g) || []).length
                  const closeCount = (last.content.match(/\{\/font\}/g) || []).length
                  if (openCount > closeCount) {
                    last.content += '{/font}'
                  }
                }
                // 插入新字体标记
                last.content += `{font:${result.family},${result.weight},${result.style}}`
                contentBase = last.content ? last.content + '\n' : ''
              }
            }
          } catch {}
        }
        break
      case 'usage':
        accumulateUsage(event.usage)
        break
      case 'a2ui':
        handleA2UIEvent(event.surfaceId, event.message)
        break
      case 'block_append':
        const blockTarget = findLastAssistant()
        if (blockTarget) {
          console.log('[Agent] block_append event:', event.block.type, event.block.id)
          // 文境单例：如果追加的是 manuscript block，先从旧消息中移除已有的 manuscript
          if (event.block.type === 'manuscript') {
            removeExistingManuscript(event.block.id)
          }
          blockTarget.blocks = [...(blockTarget.blocks || []), event.block]
        } else {
          console.warn('[Agent] block_append event: no assistant message found')
        }
        break
      case 'error':
        console.error('[Agent Error]', event.error)
        isStreaming.value = false
        messages.value.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `错误: ${event.error?.message || String(event.error)}`,
          timestamp: Date.now(),
        })
        addLog('error', `错误: ${event.error?.message || String(event.error)}`)
        break
    }

    logBridge.handleEvent(event as any)
  }

  function findLastAssistant(): AgentMessage | undefined {
    for (let i = messages.value.length - 1; i >= 0; i--) {
      if (messages.value[i].role === 'assistant') return messages.value[i]
    }
    return undefined
  }

  /** 文境单例：从所有消息中移除已有的 manuscript block（排除新 block 自身） */
  function removeExistingManuscript(newBlockId: string): void {
    for (const msg of messages.value) {
      if (!msg.blocks || msg.blocks.length === 0) continue
      const hadManuscript = msg.blocks.some(b => b.type === 'manuscript' && b.id !== newBlockId)
      if (hadManuscript) {
        msg.blocks = msg.blocks.filter(b => !(b.type === 'manuscript' && b.id !== newBlockId))
      }
    }
  }

  function accumulateUsage(usage: UsageData): void {
    totalUsage.value.inputTokens += usage.inputTokens || 0
    totalUsage.value.outputTokens += usage.outputTokens || 0
    totalUsage.value.cacheReadTokens += usage.cacheReadTokens || 0
    totalUsage.value.cacheWriteTokens += usage.cacheWriteTokens || 0
    totalUsage.value.requestCount += 1

    lastRequestUsage.value = {
      inputTokens: usage.inputTokens || 0,
      outputTokens: usage.outputTokens || 0,
      cacheReadTokens: usage.cacheReadTokens || 0,
      cacheWriteTokens: usage.cacheWriteTokens || 0,
    }

    if (providerConfig) {
      const modelId = (providerConfig as any).modelId || ''
      const breakdown = calculateCost(
        modelId,
        usage.inputTokens || 0,
        usage.outputTokens || 0,
        usage.cacheReadTokens || 0,
        usage.cacheWriteTokens || 0,
      )
      totalUsage.value.totalCost += breakdown.total
      totalUsage.value.savedByCache += breakdown.savedByCache
    }

    cumulativeUsage.value.inputTokens += usage.inputTokens || 0
    cumulativeUsage.value.outputTokens += usage.outputTokens || 0
    cumulativeUsage.value.cacheReadTokens += usage.cacheReadTokens || 0
    cumulativeUsage.value.cacheWriteTokens += usage.cacheWriteTokens || 0
    cumulativeUsage.value.requestCount += 1
    if (providerConfig) {
      const modelId = (providerConfig as any).modelId || ''
      const breakdown = calculateCost(
        modelId,
        usage.inputTokens || 0,
        usage.outputTokens || 0,
        usage.cacheReadTokens || 0,
        usage.cacheWriteTokens || 0,
      )
      cumulativeUsage.value.totalCost += breakdown.total
      cumulativeUsage.value.savedByCache += breakdown.savedByCache
    }
    saveCumulativeUsage(cumulativeUsage.value)
  }

  function updateThinkingLevel(level: ThinkingLevel): void {
    if (backend.value) {
      backend.value.updateThinkingLevel(level)
    }
  }

  async function sendMessage(text: string, images?: ImageAttachment[], files?: FileAttachment[], chatMode?: ChatMode): Promise<void> {
    const skillMatch = text.match(/^\/skill:(\S+)/)
    const skillNames = skillMatch ? [skillMatch[1]] : undefined
    const displayText = skillMatch ? `请使用 ${skillMatch[1]} 技能` : text
    await sendMessageInternal(displayText, skillNames, images, files, chatMode)
  }

  async function sendMessageWithSkill(text: string, skillNames: string[]): Promise<void> {
    const skillMatch = text.match(/^\/skill:(\S+)/)
    const displayText = skillMatch ? `请使用 ${skillMatch[1]} 技能` : text
    await sendMessageInternal(displayText, skillNames)
  }

  async function sendMessageInternal(text: string, skillNames?: string[], images?: ImageAttachment[], files?: FileAttachment[], chatMode?: ChatMode): Promise<void> {
    const ok = await ensureInitialized()
    if (!ok || !backend.value) {
      messages.value.push({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: initError.value
          ? `初始化失败: ${initError.value}\n\n请检查设置中的 AI 助手配置。`
          : 'AI 助手未就绪',
        timestamp: Date.now(),
      })
      return
    }

    const effectiveMode = chatMode ?? activeChatMode.value
    if (lockedChatMode.value === null) {
      lockedChatMode.value = effectiveMode
      activeChatMode.value = effectiveMode
    }
    // 首条消息时锁定会话模式
    if (sessionChatMode.value === null) {
      sessionChatMode.value = effectiveMode
    }

    messages.value.push({
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      images: images && images.length > 0 ? images : undefined,
      files: files && files.length > 0 ? files : undefined,
      timestamp: Date.now(),
    })

    invalidateContextCache()
    const contextInjection = toolContext ? await buildContextInjection(toolContext) : ''
    let personaPreset: string | undefined
    try {
      const raw = localStorage.getItem('agent_settings')
      if (raw) { const s = JSON.parse(raw); if (s.personaPreset) personaPreset = s.personaPreset }
    } catch { }
    await backend.value.prompt(text, { contextOverride: contextInjection, images, files, skillNames, personaPreset, chatMode: lockedChatMode.value })
  }

  async function abort(): Promise<void> {
    // 清理所有等待中的内联确认（拒绝）
    for (const [id, pending] of pendingConfirmations) {
      pending.resolve(false)
    }
    pendingConfirmations.clear()

    if (backend.value) {
      try {
        await backend.value.abort()
      } catch (err) {
        console.warn('[Agent] abort error:', err)
      }
    }
    // 确保 isStreaming 被重置，即使后端没有触发 agent_end 事件
    isStreaming.value = false
    hasAssistantInCurrentRun = false
    lockedChatMode.value = null
    contentBase = ''
    // 深度模式：标记所有 streaming 段为 complete
    deepSegments.value = deepSegments.value.map(s => {
      if (s.type === 'thinking' && s.status === 'streaming') return { ...s, status: 'complete' as const }
      if (s.type === 'phase') {
        const needsUpdate = s.status === 'active' || s.outputs.some(o => o.status === 'streaming')
        if (needsUpdate) {
          return {
            ...s,
            status: 'done' as const,
            outputs: s.outputs.map(o => o.status === 'streaming' ? { ...o, status: 'complete' as const } : o),
          }
        }
      }
      return s
    })
    if (finalOutput.value && finalOutput.value.status === 'streaming') {
      finalOutput.value = { ...finalOutput.value, status: 'complete' }
    }
    // P12 决策：abort 后恢复归档边界（agent 内部可能已重建，需从 sessionStorage 恢复）
    try {
      useArchiveStore().restoreBoundary()
    } catch (err) {
      console.warn('[Agent] abort: 恢复归档边界失败:', err)
    }
  }

  async function steer(text: string): Promise<void> {
    if (backend.value) await backend.value.steer(text)
  }

  async function sendBlockAction(steerText: string, displayText: string): Promise<void> {
    if (isStreaming.value) {
      if (backend.value) await backend.value.steer(steerText)
    } else {
      const ok = await ensureInitialized()
      if (!ok || !backend.value) return
      if (lockedChatMode.value === null) {
        lockedChatMode.value = activeChatMode.value
      }
      messages.value.push({
        id: crypto.randomUUID(),
        role: 'user',
        content: displayText,
        timestamp: Date.now(),
      })
      invalidateContextCache()
      const contextInjection = toolContext ? await buildContextInjection(toolContext) : ''
      await backend.value.prompt(steerText, { contextOverride: contextInjection, chatMode: lockedChatMode.value })
    }
  }

  function toggleVisibility(): void {
    isVisible.value = !isVisible.value
  }

  function show(): void {
    isVisible.value = true
  }

  function hide(): void {
    isVisible.value = false
  }

  async function autoSaveSession(): Promise<void> {
    if (!currentSessionId.value) return
    const session = await getSession(currentSessionId.value)
    if (!session) return
    session.messages = JSON.parse(JSON.stringify(messages.value))
    session.metadata.usage = { ...totalUsage.value }
    session.metadata.totalTokens = totalUsage.value.inputTokens + totalUsage.value.cacheReadTokens + totalUsage.value.cacheWriteTokens + totalUsage.value.outputTokens
    session.metadata.totalCost = totalUsage.value.totalCost
    session.metadata.toolCallCount = totalUsage.value.requestCount
    if (sessionChatMode.value) session.chatMode = sessionChatMode.value
    // 持久化深度模式虚拟段落
    if (deepSegments.value.length > 0) {
      session.deepSegments = JSON.parse(JSON.stringify(deepSegments.value))
    } else {
      session.deepSegments = undefined
    }
    if (finalOutput.value) {
      session.finalOutput = JSON.parse(JSON.stringify(finalOutput.value))
    } else {
      session.finalOutput = undefined
    }
    await saveSession(session)
  }

  async function generateTitleIfNeeded(): Promise<void> {
    if (!currentSessionId.value || !providerConfig) return
    let session = await getSession(currentSessionId.value)
    const isNew = !session
    if (isNew) {
      session = {
        id: currentSessionId.value,
        name: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        providerMode: providerConfig.mode as any,
        modelId: providerConfig.modelId,
        messages: JSON.parse(JSON.stringify(messages.value)),
        metadata: { totalTokens: totalUsage.value.totalTokens || 0, totalCost: totalUsage.value.totalCost || 0, toolCallCount: totalUsage.value.requestCount || 0 },
      }
    }
    if (session.name !== '' && session.name !== '新会话') return
    const userMsgs = messages.value.filter(m => m.role === 'user')
    const assistantMsgs = messages.value.filter(m => m.role === 'assistant')
    if (userMsgs.length === 0 || assistantMsgs.length === 0) return
    const firstUser = userMsgs[0].content
    const firstAssistant = assistantMsgs[0].content
    try {
      const title = await generateTitle(providerConfig, firstUser, firstAssistant)
      if (title) {
        session.name = title
      } else if (isNew) {
        session.name = '新会话'
      } else {
        return
      }
    } catch {
      if (isNew) session.name = '新会话'
      else return
    }
    await saveSession(session)
    window.dispatchEvent(new CustomEvent('ws-session-title-updated'))
  }

  async function newSession(): Promise<void> {
    await autoSaveSession()
    // 清理所有等待中的内联确认
    for (const [, pending] of pendingConfirmations) {
      pending.resolve(false)
    }
    pendingConfirmations.clear()
    if (backend.value) {
      backend.value.dispose()
      backend.value = null
    }
    isInitialized.value = false
    messages.value = []
    deepSegments.value = []
    finalOutput.value = null
    currentPhaseId = null
    currentPhaseLabel = null
    phaseCounter = 0
    hasToolCallsInCurrentTurn = false
    a2uiSurfaces.value = {}
    activeChatMode.value = 'normal'
    lockedChatMode.value = null
    sessionChatMode.value = null
    totalUsage.value = { ...EMPTY_USAGE }
    lastRequestUsage.value = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }
    // P12 决策：新会话重置归档边界
    try {
      useArchiveStore().resetBoundary()
    } catch (err) {
      console.warn('[Agent] newSession: 重置归档边界失败:', err)
    }
    try {
      const providerConfig = await buildProviderConfig()
      const session = await createSession(providerConfig.mode, providerConfig.modelId)
      currentSessionId.value = session.id
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      initError.value = `创建会话失败: ${msg}`
      console.error('[Agent] newSession error:', msg)
    }
  }

  async function switchSession(sessionId: string): Promise<void> {
    if (sessionId === currentSessionId.value) return
    await autoSaveSession()
    const session = await getSession(sessionId)
    if (!session) return
    if (backend.value) {
      backend.value.dispose()
      backend.value = null
    }
    isInitialized.value = false
    messages.value = session.messages || []
    deepSegments.value = (session.deepSegments as DeepSegment[]) || []
    finalOutput.value = (session.finalOutput as FinalOutput | null) || null
    a2uiSurfaces.value = {}
    // 从会话恢复模式：已锁定则恢复，未锁定则重置为 normal
    const restoredMode = session.chatMode || 'normal'
    activeChatMode.value = restoredMode
    lockedChatMode.value = null
    sessionChatMode.value = session.chatMode || null
    // 同步 spaceStore 的 chatMode
    try {
      const spaceStore = useSpaceStore()
      spaceStore.setChatMode(restoredMode)
    } catch {}
    totalUsage.value = session.metadata.usage
      ? { ...session.metadata.usage }
      : { ...EMPTY_USAGE }
    lastRequestUsage.value = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }
    currentSessionId.value = session.id
  }

  function clearInitError(): void {
    initError.value = null
  }

  function dispose(): void {
    // 清理所有等待中的内联确认
    for (const [, pending] of pendingConfirmations) {
      pending.resolve(false)
    }
    pendingConfirmations.clear()
    if (backend.value) {
      backend.value.dispose()
      backend.value = null
    }
    isInitialized.value = false
    messages.value = []
    deepSegments.value = []
    finalOutput.value = null
    currentPhaseId = null
    currentPhaseLabel = null
    phaseCounter = 0
    hasToolCallsInCurrentTurn = false
    currentSessionId.value = null
    sessionChatMode.value = null
    // P12 决策：销毁时重置归档边界
    try {
      useArchiveStore().resetBoundary()
    } catch (err) {
      console.warn('[Agent] dispose: 重置归档边界失败:', err)
    }
    killPty()
  }

  function getMCPManager(): import('@agent/mcp/mcp-manager').MCPManager | null {
    return (backend.value as any)?.getMCPManager?.() ?? null
  }

  async function addMCPConnection(config: import('@agent/index').MCPConnectionConfig): Promise<void> {
    const mgr = getMCPManager()
    if (!mgr) return
    await mgr.addConnection(config)
  }

  async function removeMCPConnection(serverId: string): Promise<void> {
    const mgr = getMCPManager()
    if (!mgr) return
    await mgr.removeConnection(serverId)
  }

  function getMCPConnections(): import('@agent/index').MCPConnectionState[] {
    return getMCPManager()?.getConnectionStates() ?? []
  }

  return {
    isVisible: readonly(isVisible),
    isInitialized: readonly(isInitialized),
    messages,
    isStreaming: readonly(isStreaming),
    currentSessionId: readonly(currentSessionId),
    initError: readonly(initError),
    isPinned,
    activeChatMode: readonly(activeChatMode),
    lockedChatMode: readonly(lockedChatMode),
    sessionChatMode: readonly(sessionChatMode),
    deepSegments: readonly(deepSegments),
    finalOutput: readonly(finalOutput),
    lastAssistantHasContent: computed(() => {
      const msgs = messages.value
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'assistant') return (msgs[i].content || '').length > 0
      }
      return false
    }),
    lastAssistantHasThinking: computed(() => {
      const msgs = messages.value
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'assistant') return (msgs[i].thinking || '').length > 0
      }
      return false
    }),
    setChatMode: (mode: ChatMode) => { if (sessionChatMode.value === null && lockedChatMode.value === null) activeChatMode.value = mode },
    totalUsage: readonly(totalUsage),
    lastRequestUsage: readonly(lastRequestUsage),
    cumulativeUsage: readonly(cumulativeUsage),
    cacheHitRate,
    a2uiSurfaces: readonly(a2uiSurfaces),
    resolveDataBinding,
    updateThinkingLevel,
    refreshSearchConfig,
    getMCPManager,
    addMCPConnection,
    removeMCPConnection,
    getMCPConnections,
    updateModel: async (provider: string, modelId: string, baseUrl?: string, apiKey?: string, temperature?: number, maxTokens?: number, contextWindow?: number, _maxOut?: number) => {
      try {
        if (backend.value) {
          await backend.value.updateModel(provider, modelId, baseUrl, apiKey, contextWindow, maxTokens, temperature !== undefined ? temperature / 100 : undefined)
        }
      } catch (err: any) {
        console.error('[useAgent] updateModel backend call failed:', err?.message || String(err), { provider, modelId })
      }
      try {
        if (providerConfig) {
          if (providerConfig.mode === 'cloud') {
            const cloudCfg = providerConfig as { provider: string; modelId: string; apiKey?: string }
            cloudCfg.provider = provider
            cloudCfg.modelId = modelId
            if (apiKey !== undefined) cloudCfg.apiKey = apiKey
          }
          const cfg = providerConfig as unknown as Record<string, unknown>
          if (temperature !== undefined) {
            cfg.temperature = temperature / 100
          }
          if (maxTokens !== undefined) {
            cfg.maxTokens = maxTokens
          }
          if (contextWindow !== undefined) {
            cfg.contextWindow = contextWindow
          }
        }
      } catch (err: any) {
        console.error('[useAgent] updateModel providerConfig sync failed:', err?.message || String(err), { provider, modelId })
      }
    },
    ensureInitialized,
    sendMessage,
    steer,
    sendBlockAction,
    abort,
    /**
     * H1.2 新增：清理 PI Agent 内部上下文消息
     *
     * 供记忆库 AgentBridgeImpl.advanceBoundary 调用，
     * 只清理 Agent 内部 state.messages，不影响前端 messages 显示。
     */
    trimContext: (upToIndex: number) => {
      if (backend.value && typeof (backend.value as any).trimContext === 'function') {
        (backend.value as any).trimContext(upToIndex)
      }
    },
    newSession,
    switchSession,
    clearInitError,
    toggleVisibility,
    show,
    hide,
    dispose,
    terminalVisible,
    ptyId,
    ptyReady,
    logBridge,
    openTerminal: async () => {
      showTerminal()
      if (!ptyReady.value) {
        try {
          await spawnPty()
        } catch (err) {
          hideTerminal()
          const { toastWarn } = await import('../../composables/useToast')
          toastWarn(err instanceof Error ? err.message : '终端功能不可用')
        }
      }
    },
    closeTerminal: hideTerminal,
    writePtyInput: writeToPty,
    resizePty,
    createSubBackend: async (skillIds: string[], visionProviderConfig?: any) => {
      if (!providerConfig || !toolContext) {
        throw new Error('主 Agent 未初始化')
      }
      const { getToolsForSkills } = await import('@agent/index')
      const tools = getToolsForSkills(skillIds)
      const fontLibrary = useFontLibraryStore()
      // 注册 set_font 工具（单聊模式）
      tools.push({
        ...setFontTool,
        execute: async (args: Record<string, unknown>) => {
          const result = await executeSetFont(args as any)
          return JSON.stringify(result)
        },
      } as any)
      return createWorldSmithAgent({
        providerConfig: visionProviderConfig || providerConfig,
        toolContext,
        tools,
        projectName: 'WorldSmith-SubAgent',
        availableFontFamilies: fontLibrary.entries.map(e => e.family),
      })
    },
    getProviderConfig: () => providerConfig,
    getToolContext: () => toolContext,
    /** 深度模式内联确认：解析等待中的工具确认 */
    resolveToolConfirmation: (toolId: string, approved: boolean) => {
      const pending = pendingConfirmations.get(toolId)
      if (pending) {
        pending._resolved = true
        pending._approved = approved
        pending.resolve(approved)
        pendingConfirmations.delete(toolId)
      }
    },
  }
}
