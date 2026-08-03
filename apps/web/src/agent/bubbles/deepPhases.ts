/**
 * 深度思考模式：阶段定义与类型
 *
 * 从原 AgentMessageBubble.vue 中提取的纯数据模块。
 * 将工具调用按"问题拆解→证据收集→推理分析→创作操作→结论输出"五阶段分组。
 */
import type { ToolCallView } from '../blocks/InlineToolCall.vue'

/** 深度模式阶段定义：工具名→阶段映射 */
export const DEEP_PHASES = [
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

/** 所有已分阶段的工具名集合（用于兜底判断未匹配工具） */
export const ALL_PHASE_TOOLS = new Set<string>(DEEP_PHASES.flatMap(p => [...p.tools]))

/** 深度模式阶段分组结果 */
export interface PhaseGroup {
  label: string
  index: number
  tools: ToolCallView[]
  isActive: boolean
  isDone: boolean
}
