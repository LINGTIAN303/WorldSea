/**
 * @worldsmith/agent-core 库描述符
 *
 * 遵循项目 LibraryDescriptor 约定，供 InternalChainRegistry 注册。
 * 当前阶段 agent-core 作为纯类型/接口库，不提供 CapabilityDeclaration，
 * 工具能力由 worldsmith-agent 的各工具文件注册。
 *
 * 后续 Phase 2 工具去重后，编码工具集的 CapabilityDeclaration
 * 将迁移至此描述符中。
 */

import type { ToolCategoryMeta } from './types'

/** 工具分类元数据表 */
export const TOOL_CATEGORIES: ToolCategoryMeta[] = [
  { id: 'entity', label: '实体管理', icon: 'database' },
  { id: 'relation', label: '关系管理', icon: 'link' },
  { id: 'search', label: '搜索与检索', icon: 'search' },
  { id: 'output', label: '输出渲染', icon: 'layout' },
  { id: 'a2ui', label: 'A2UI 界面', icon: 'monitor' },
  { id: 'memory', label: '记忆系统', icon: 'brain' },
  { id: 'project', label: '项目管理', icon: 'folder' },
  { id: 'schema', label: 'Schema 管理', icon: 'file-code' },
  { id: 'retrofit', label: '改造工具', icon: 'wrench' },
  { id: 'algo', label: '算法工具', icon: 'cpu' },
  { id: 'file', label: '文件操作', icon: 'file' },
  { id: 'dev', label: '开发工具', icon: 'terminal' },
  { id: 'plugin', label: '插件系统', icon: 'puzzle' },
  { id: 'orchestrator', label: '编排与流水线', icon: 'workflow' },
  { id: 'vision', label: '视觉与生成', icon: 'image' },
  { id: 'plan', label: '规划与知识', icon: 'map' },
  { id: 'persona', label: '人格与任务', icon: 'user' },
  { id: 'session', label: '会话管理', icon: 'message-square' },
  { id: 'coding', label: '编码 Agent', icon: 'code' },
]

/** 旧工具名 → 编码 Agent 标准工具名的映射 */
export const LEGACY_TO_CODING_MAP: Record<string, string> = {
  fs_read: 'read_file',
  fs_write: 'write_file',
  fs_list: 'list_directory',
  fs_search: 'search_files',
  fs_stat: 'read_file',
  fs_mkdir: 'write_file',
  fs_copy: 'execute_command',
  fs_move: 'execute_command',
  fs_delete: 'execute_command',
  detect_shells: 'shell_session',
  shell_session_create: 'shell_session',
  shell_session_exec: 'shell_session',
  shell_session_input: 'shell_session',
  shell_session_destroy: 'shell_session',
  shell_session_list: 'shell_session',
  content_search: 'search_files',
  file_read: 'read_file',
  file_write: 'write_file',
  file_list: 'list_directory',
  file_delete: 'execute_command',
}

/** 编码 Agent 标准工具名列表 */
export const CODING_AGENT_TOOL_NAMES = [
  'read_file',
  'write_file',
  'edit_file',
  'search_files',
  'list_directory',
  'execute_command',
  'shell_session',
  'web_search',
  'web_fetch',
] as const
