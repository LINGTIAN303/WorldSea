/**
 * AgentPreview 预览面板的标签字典与翻译函数
 *
 * 从 AgentPreview.vue 中提取的纯数据模块（无副作用，零依赖）。
 * 包含：工具图标映射、实体类型/参数键/参数值的中文翻译。
 *
 * 工具名中文标签（getToolLabel / TOOL_LABELS）复用自 ../bubbles/toolLabels，
 * 该模块已包含全量工具名映射且对未知工具名提供更友好的兜底翻译。
 */
export { getToolLabel, TOOL_LABELS } from '@worldsmith/shared-ui/agent/bubbles'

/** 工具名 → WsIcon 图标名 映射（兜底为 'settings'） */
export const TOOL_ICONS: Record<string, string> = {
  entity_create: 'edit',
  entity_get: 'search',
  entity_update: 'edit',
  entity_delete: 'delete',
  entity_list: 'outline',
  relation_create: 'link',
  relation_delete: 'link',
  relation_list: 'outline',
  daily_report: 'dashboard',
  web_search: 'globe',
  output_table: 'dashboard',
  output_choice: 'profile',
  output_code: 'manuscript',
  output_entity_card: 'character',
  output_alert: 'warning',
  output_stat: 'dashboard',
  output_list: 'outline',
  output_progress: 'timeline',
  output_comparison: 'link',
  output_timeline: 'timeline',
  output_image: 'globe',
  output_accordion: 'manuscript',
  consistency_check: 'check',
  content_search: 'search',
  memory_store: 'manuscript',
  memory_recall: 'search',
  memory_delete: 'delete',
  project_export: 'outline',
  project_import: 'outline',
  load_skill: 'concept',
  schema_validate: 'check',
  schema_register_entity_type: 'edit',
  schema_unregister_entity_type: 'delete',
  schema_get_entity_type: 'search',
  schema_list_entity_types: 'outline',
  schema_update_entity_type: 'edit',
  schema_register_validation: 'check',
  schema_register_view: 'dashboard',
  schema_export: 'outline',
  algo_graph_analysis: 'dashboard',
  algo_pagerank: 'dashboard',
  algo_community_detection: 'dashboard',
  algo_force_layout: 'dashboard',
  algo_shortest_path: 'link',
  algo_k_shortest_paths: 'link',
  algo_topological_sort: 'outline',
  algo_crdt_lww: 'manuscript',
  algo_crdt_orset: 'manuscript',
  algo_crdt_rga: 'manuscript',
  algo_crdt_vector_clock: 'timeline',
  algo_terrain_noise: 'globe',
  algo_terrain_heightmap: 'globe',
  algo_terrain_contour: 'globe',
  algo_hydraulic_erosion: 'globe',
  algo_viewshed: 'globe',
  algo_constraint_solve: 'check',
  algo_dxf_parse: 'manuscript',
  algo_dxf_generate: 'manuscript',
  algo_dxf_extract_constraints: 'check',
  algo_polygon_boolean: 'dashboard',
  algo_polygon_offset: 'dashboard',
  algo_chaikin_smooth: 'dashboard',
  algo_find_shared_edges: 'search',
  algo_find_line_polygon_intersections: 'search',
  algo_polygon_split: 'dashboard',
  algo_polygon_augment: 'dashboard',
  ui_create_surface: 'dashboard',
  ui_update_components: 'edit',
  ui_update_data: 'edit',
  ui_delete_surface: 'delete',
  plugin_write: 'manuscript',
  file_write: 'manuscript',
  file_list: 'outline',
  file_read: 'search',
  file_analyze: 'search',
  fs_read: 'search',
  fs_write: 'manuscript',
  fs_list: 'outline',
  fs_move: 'edit',
  fs_delete: 'delete',
  fs_search: 'search',
  pkg_install: 'outline',
  pkg_run: 'timeline',
  pkg_info: 'search',
  git_status: 'check',
  git_log: 'timeline',
  git_diff: 'manuscript',
  git_commit: 'edit',
  git_branch: 'outline',
  sys_info: 'dashboard',
  sys_processes: 'dashboard',
  sys_disk: 'dashboard',
  web_search_cli: 'globe',
  web_fetch_cli: 'globe',
  web_qa_cli: 'globe',
  web_dns_cli: 'globe',
  web_ping_cli: 'globe',
  web_fetch: 'globe',
  code_execute: 'timeline',
  notebook_create: 'manuscript',
  notebook_update: 'edit',
  notebook_link: 'link',
  notebook_create_note: 'manuscript',
  notebook_update_note: 'edit',
  notebook_list_notes: 'outline',
  notebook_execute_code: 'timeline',
  notebook_create_backlink: 'link',
  notebook_export_note: 'outline',
  execute_command: 'timeline',
  detect_terminal_mode: 'check',
  start_server: 'timeline',
  list_sub_agent_types: 'outline',
  dispatch_sub_agent: 'profile',
  get_sub_agent_status: 'search',
  cancel_sub_agent: 'delete',
  a2ui_show_entity: 'character',
  a2ui_show_relation: 'link',
  module_builder_add_component: 'edit',
  module_builder_remove_component: 'delete',
  module_builder_update_config: 'edit',
  module_builder_suggest_layout: 'dashboard',
  retrofit_begin_session: 'timeline',
  retrofit_submit_intent: 'edit',
  retrofit_confirm_and_stage: 'check',
  retrofit_apply_next: 'timeline',
  retrofit_verify_and_accept: 'check',
  retrofit_request_repair: 'warning',
  retrofit_redirect: 'link',
  retrofit_rollback_last: 'timeline',
  retrofit_abort: 'delete',
  retrofit_session_phase: 'timeline',
  retrofit_detect_conflicts: 'warning',
  retrofit_end_session: 'check',
  retrofit_patch_diff: 'manuscript',
  retrofit_patch_apply: 'edit',
  retrofit_apply: 'edit',
  retrofit_undo: 'timeline',
  workflow_list: 'outline',
  workflow_run: 'timeline',
  workflow_status: 'search',
  workflow_decision: 'check',
  workflow_cancel: 'delete',
  workflow_create: 'edit',
  timeline_create_event: 'edit',
  timeline_update_event: 'edit',
  timeline_sort_events: 'outline',
  timeline_detect_conflicts: 'warning',
  timeline_get_events: 'search',
  timeline_export_timeline: 'outline',
  graph_get_nodes: 'search',
  graph_get_edges: 'search',
  graph_find_path: 'link',
  graph_cluster_analysis: 'dashboard',
  graph_highlight_nodes: 'dashboard',
  graph_export_snapshot: 'outline',
  mindmap_create_node: 'edit',
  mindmap_update_node: 'edit',
  mindmap_delete_node: 'delete',
  mindmap_get_structure: 'search',
  mindmap_auto_layout: 'dashboard',
  mindmap_export_image: 'outline',
  manuscript_create_chapter: 'edit',
  manuscript_update_chapter: 'edit',
  manuscript_list_chapters: 'outline',
  manuscript_get_chapter_content: 'search',
  manuscript_insert_mention: 'link',
  manuscript_export_document: 'outline',
  outline_create_node: 'edit',
  outline_update_node: 'edit',
  outline_move_node: 'edit',
  outline_get_structure: 'search',
  outline_link_entity: 'link',
  outline_export_outline: 'outline',
  tactical_deploy_unit: 'edit',
  tactical_move_unit: 'edit',
  tactical_get_battle_state: 'search',
  tactical_simulate_turn: 'timeline',
  tactical_export_battle_log: 'outline',
  magic_create_skill_node: 'edit',
  magic_update_skill_node: 'edit',
  magic_get_skill_tree: 'search',
  magic_validate_tree: 'check',
  magic_export_skill_tree: 'outline',
}

/** 实体类型 → 中文标签 */
const TYPE_LABELS: Record<string, string> = {
  character: '角色',
  region: '区域',
  organization: '组织',
  concept: '概念',
  event: '事件',
  item: '物品',
}

/** 参数键 → 中文标签 */
const KEY_LABELS: Record<string, string> = {
  id: '标识',
  name: '名称',
  type: '类型',
  description: '描述',
  results: '结果数',
  query: '查询词',
  total: '总计',
  showing: '显示',
  success: '成功',
  ok: '成功',
  error: '错误',
  hint: '提示',
  action: '操作',
  key: '键',
  message: '消息',
  date: '日期',
  totalEntities: '实体总数',
  totalRelations: '关系总数',
  typeDistribution: '类型分布',
  recentUpdates: '最近更新',
  updatedAt: '更新时间',
  preview: '预览',
  label: '标签',
  progress: '进度',
  status: '状态',
  title: '标题',
  columns: '列定义',
  rows: '行数据',
  mode: '模式',
  options: '选项',
  language: '语言',
  code: '代码',
  runnable: '可运行',
  entityId: '实体ID',
  entityType: '实体类型',
  level: '级别',
  items: '项目',
  events: '事件',
  left: '左侧',
  right: '右侧',
  src: '来源',
  alt: '替代文本',
  caption: '说明',
  sections: '段落',
  content: '内容',
  value: '值',
  icon: '图标',
  trend: '趋势',
  time: '时间',
  tags: '标签',
  properties: '属性',
}

/** 参数值（枚举型）→ 中文标签 */
const VALUE_LABELS: Record<string, string> = {
  single: '单选',
  multi: '多选',
  running: '运行中',
  completed: '已完成',
  failed: '已失败',
  info: '信息',
  success: '成功',
  warning: '警告',
  error: '错误',
  up: '上升',
  down: '下降',
  flat: '持平',
  left: '左',
  right: '右',
  center: '居中',
  true: '是',
  false: '否',
}

/** 获取工具对应的 WsIcon 图标名（兜底 'settings'） */
export function getToolIcon(name: string): string {
  return TOOL_ICONS[name] || 'settings'
}

/** 获取实体类型的中文标签（兜底原值） */
export function getTypeLabel(type: string): string {
  return TYPE_LABELS[type] || type
}

/** 翻译参数值（字符串枚举/布尔 → 中文） */
export function translateValue(val: unknown): string {
  if (typeof val === 'string') return VALUE_LABELS[val] || val
  if (typeof val === 'boolean') return val ? '是' : '否'
  return String(val)
}

/** 翻译参数键（蛇形命名 → 中文） */
export function translateKey(key: string): string {
  return KEY_LABELS[key] || key
}

/** 格式化参数值为展示字符串（含长度截断与对象序列化） */
export function formatVal(val: unknown): string {
  if (val === null || val === undefined) return '—'
  if (typeof val === 'string') {
    const translated = translateValue(val)
    const display = translated !== val ? translated : (val.length > 80 ? val.slice(0, 80) + '…' : val)
    return display
  }
  if (typeof val === 'boolean') return translateValue(val)
  if (typeof val === 'number') return String(val)
  if (typeof val === 'object') {
    const s = JSON.stringify(val)
    return s.length > 80 ? s.slice(0, 80) + '…' : s
  }
  return String(val)
}
