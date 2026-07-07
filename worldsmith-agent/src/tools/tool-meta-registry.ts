/**
 * 工具元数据注册中心
 *
 * 为所有工具（含旧工具名）提供统一的元数据查询接口。
 *
 * 数据源优先级（任务3 接线后）：
 * 1. 全局 ToolRegistry（@worldsmith/agent-core）—— 声明式首选源
 * 2. LEGACY_TOOL_META —— 旧工具/能力链工具的兜底元数据
 * 3. ALIAS_MAP / LEGACY_ALGO_MAP / LEGACY_PLUGIN_MAP —— 旧工具名别名解析
 * 4. 兜底：moderate 权限
 *
 * 用法：
 *   const meta = getToolMeta('fs_read')   // → read_file 的 meta
 *   const meta = getToolMeta('entity_delete')  // → 旧工具的 meta
 */

import type { ToolMeta } from '@worldsmith/agent-core'
import { getGlobalToolRegistry } from '@worldsmith/agent-core'
import type { ToolDefinition } from '../bridge-types'
import { LEGACY_ALGO_MAP } from './algo-tools'
import { LEGACY_PLUGIN_MAP } from './plugin-backend-tools'

/** 工具列表注入点（默认从 agent.ts 注入，CLI 从 cli-agent.ts 注入） */
// 任务3 接线后：工具直接注册到全局 ToolRegistry，不再需要本地 _toolsSource 变量。
// 保留 initToolMetaRegistry 作为注入入口语义，内部委托 ToolRegistry。

/**
 * 注入工具列表（必须在首次 getToolMeta 前调用）
 *
 * 将工具注册到全局 ToolRegistry，使其成为元数据首选源。
 * 幂等：同名工具覆盖（ToolRegistry.register 用 Map.set）。
 */
export function initToolMetaRegistry(tools: ToolDefinition[]): void {
  _metaCache = null

  // 任务3 接线：注册到全局 ToolRegistry（声明式首选源）
  // ToolRegistry.register 用 Map.set，同名工具覆盖（幂等）；
  // initToolMetaRegistry 通常仅在启动时调用一次。
  const registry = getGlobalToolRegistry()
  for (const tool of tools) {
    if (tool.meta) {
      registry.register(tool as import('@worldsmith/agent-core').ToolDefinition)
    }
  }
}

/** 旧工具名→标准工具名的别名映射 */
const ALIAS_MAP: Record<string, string> = {
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

/** 旧工具名（无标准工具对应）的独立元数据 */
const LEGACY_TOOL_META: Record<string, ToolMeta> = {
  // ─── 实体管理 ────────────────────────────────
  entity_list: { permission: 'safe', category: 'entity', alwaysAvailable: true, displayName: '列出实体' },
  entity_get: { permission: 'safe', category: 'entity', alwaysAvailable: true, displayName: '获取实体' },
  entity_get_context: { permission: 'safe', category: 'entity', alwaysAvailable: true, displayName: '获取实体上下文' },
  entity_create: { permission: 'moderate', category: 'entity', displayName: '创建实体' },
  entity_update: { permission: 'moderate', category: 'entity', displayName: '更新实体' },
  entity_delete: { permission: 'dangerous', category: 'entity', displayName: '删除实体' },
  entity_suggest_field: { permission: 'safe', category: 'entity', alwaysAvailable: true, displayName: '建议字段' },
  entity_smart_fill: { permission: 'safe', category: 'entity', alwaysAvailable: true, displayName: '智能填充' },

  // ─── 关系管理 ────────────────────────────────
  relation_list: { permission: 'safe', category: 'relation', alwaysAvailable: true, displayName: '列出关系' },
  relation_create: { permission: 'moderate', category: 'relation', displayName: '创建关系' },
  relation_update: { permission: 'moderate', category: 'relation', displayName: '更新关系' },
  relation_delete: { permission: 'dangerous', category: 'relation', displayName: '删除关系' },

  // ─── 搜索 ────────────────────────────────────
  content_search: { permission: 'safe', category: 'search', alwaysAvailable: true, displayName: '内容搜索' },

  // ─── 输出渲染 ────────────────────────────────
  output_table: { permission: 'safe', category: 'output', alwaysAvailable: true, displayName: '输出表格' },
  output_choice: { permission: 'safe', category: 'output', alwaysAvailable: true, displayName: '输出选择' },
  output_code: { permission: 'safe', category: 'output', alwaysAvailable: true, displayName: '输出代码' },
  output_entity_card: { permission: 'safe', category: 'output', alwaysAvailable: true, displayName: '输出实体卡片' },
  output_alert: { permission: 'safe', category: 'output', alwaysAvailable: true, displayName: '输出提示' },
  output_stat: { permission: 'safe', category: 'output', alwaysAvailable: true, displayName: '输出统计' },
  output_list: { permission: 'safe', category: 'output', alwaysAvailable: true, displayName: '输出列表' },
  output_progress: { permission: 'safe', category: 'output', alwaysAvailable: true, displayName: '输出进度' },
  output_comparison: { permission: 'safe', category: 'output', alwaysAvailable: true, displayName: '输出对比' },
  output_timeline: { permission: 'safe', category: 'output', alwaysAvailable: true, displayName: '输出时间线' },
  output_image: { permission: 'safe', category: 'output', alwaysAvailable: true, displayName: '输出图片' },
  output_accordion: { permission: 'safe', category: 'output', alwaysAvailable: true, displayName: '输出折叠面板' },

  // ─── 记忆 ────────────────────────────────────
  memory_store: { permission: 'moderate', category: 'memory', alwaysAvailable: true, displayName: '存储记忆' },
  memory_recall: { permission: 'safe', category: 'memory', alwaysAvailable: true, displayName: '回忆记忆' },
  memory_delete: { permission: 'dangerous', category: 'memory', displayName: '删除记忆' },

  // ─── 知识库 ──────────────────────────────────
  kb_write: { permission: 'moderate', category: 'plan', alwaysAvailable: true, displayName: '写入知识库' },
  kb_read: { permission: 'safe', category: 'plan', alwaysAvailable: true, displayName: '读取知识库' },
  kb_list: { permission: 'safe', category: 'plan', alwaysAvailable: true, displayName: '列出知识库' },
  kb_search: { permission: 'safe', category: 'plan', alwaysAvailable: true, displayName: '搜索知识库' },
  kb_delete: { permission: 'dangerous', category: 'plan', displayName: '删除知识库' },
  kb_extract: { permission: 'moderate', category: 'plan', alwaysAvailable: true, displayName: '提取知识' },
  kb_reflect: { permission: 'moderate', category: 'plan', alwaysAvailable: true, displayName: '反思知识' },
  kb_link: { permission: 'moderate', category: 'plan', alwaysAvailable: true, displayName: '链接知识' },
  kb_init: { permission: 'moderate', category: 'plan', alwaysAvailable: true, displayName: '初始化知识库' },

  // ─── 项目 ────────────────────────────────────
  project_export: { permission: 'safe', category: 'project', alwaysAvailable: true, displayName: '导出项目' },
  project_import: { permission: 'safe', category: 'project', alwaysAvailable: true, displayName: '导入项目' },

  // ─── 文件 ────────────────────────────────────
  file_write: { permission: 'moderate', category: 'file', displayName: '写入文件' },
  file_associate: { permission: 'moderate', category: 'file', displayName: '关联文件' },
  file_delete: { permission: 'dangerous', category: 'file', displayName: '删除文件' },

  // ─── Schema ──────────────────────────────────
  schema_get_entity_type: { permission: 'safe', category: 'schema', displayName: '获取实体类型' },
  schema_list_entity_types: { permission: 'safe', category: 'schema', displayName: '列出实体类型' },
  schema_register_entity_type: { permission: 'moderate', category: 'schema', displayName: '注册实体类型' },
  schema_update_entity_type: { permission: 'moderate', category: 'schema', displayName: '更新实体类型' },
  schema_unregister_entity_type: { permission: 'dangerous', category: 'schema', displayName: '注销实体类型' },
  schema_register_validation: { permission: 'moderate', category: 'schema', displayName: '注册验证' },
  schema_register_view: { permission: 'moderate', category: 'schema', displayName: '注册视图' },

  // ─── 开发工具 ────────────────────────────────
  git_commit: { permission: 'moderate', category: 'dev', displayName: 'Git 提交' },
  git_branch: { permission: 'moderate', category: 'dev', displayName: 'Git 分支' },
  pkg_install: { permission: 'moderate', category: 'dev', displayName: '安装包' },
  web_fetch_cli: { permission: 'moderate', category: 'dev', displayName: 'CLI 网页抓取' },
  launch_terminal: { permission: 'moderate', category: 'dev', displayName: '启动终端' },
  launch_terminal_script: { permission: 'moderate', category: 'dev', displayName: '终端脚本' },

  // ─── 系统 ────────────────────────────────────
  sys_info: { permission: 'safe', category: 'dev', displayName: '系统信息' },
  sys_processes: { permission: 'safe', category: 'dev', displayName: '进程列表' },
  sys_disk: { permission: 'safe', category: 'dev', displayName: '磁盘信息' },

  // ─── 原生 ────────────────────────────────────
  dialog_open: { permission: 'moderate', category: 'native', displayName: '打开文件对话框' },
  dialog_save: { permission: 'moderate', category: 'native', displayName: '保存文件对话框' },
  dialog_message: { permission: 'safe', category: 'native', alwaysAvailable: true, displayName: '消息对话框' },
  dialog_ask: { permission: 'safe', category: 'native', alwaysAvailable: true, displayName: '询问对话框' },
  clipboard_read: { permission: 'safe', category: 'native', alwaysAvailable: true, displayName: '读取剪贴板' },
  clipboard_write: { permission: 'moderate', category: 'native', alwaysAvailable: true, displayName: '写入剪贴板' },
  open_url: { permission: 'moderate', category: 'native', displayName: '打开 URL' },
  notify: { permission: 'safe', category: 'native', alwaysAvailable: true, displayName: '通知' },
  native_fetch: { permission: 'moderate', category: 'native', displayName: '原生HTTP请求' },

  // ─── A2UI ────────────────────────────────────
  ui_create_surface: { permission: 'moderate', category: 'a2ui', displayName: '创建 UI 面' },
  ui_update_components: { permission: 'moderate', category: 'a2ui', displayName: '更新 UI 组件' },
  ui_update_data: { permission: 'moderate', category: 'a2ui', displayName: '更新 UI 数据' },
  ui_delete_surface: { permission: 'dangerous', category: 'a2ui', displayName: '删除 UI 面' },

  // ─── 插件 ────────────────────────────────────
  plugin_write: { permission: 'moderate', category: 'plugin', displayName: '写入插件' },

  // ─── 人格 ────────────────────────────────────
  persona_update: { permission: 'moderate', category: 'persona', displayName: '更新人格' },

  // ─── 会话 ────────────────────────────────────
  session_info: { permission: 'safe', category: 'session', displayName: '会话信息' },
  session_list: { permission: 'safe', category: 'session', displayName: '会话列表' },
  session_read: { permission: 'safe', category: 'session', displayName: '读取会话' },

  // ─── 视觉 ────────────────────────────────────
  vision_analyze: { permission: 'safe', category: 'vision', alwaysAvailable: true, displayName: '视觉分析' },
  list_vision_images: { permission: 'safe', category: 'vision', alwaysAvailable: true, displayName: '列出视觉图片' },
  image_generate: { permission: 'safe', category: 'vision', alwaysAvailable: true, displayName: '生成图片' },
  image_gen_config: { permission: 'safe', category: 'vision', alwaysAvailable: true, displayName: '图片生成配置' },
  image_list: { permission: 'safe', category: 'vision', alwaysAvailable: true, displayName: '列出图片' },
  image_show: { permission: 'safe', category: 'vision', alwaysAvailable: true, displayName: '展示图片' },

  // ─── 日常任务 ────────────────────────────────
  daily_report: { permission: 'safe', category: 'persona', alwaysAvailable: true, displayName: '日报' },
  consistency_check: { permission: 'safe', category: 'persona', alwaysAvailable: true, displayName: '一致性检查' },

  // ─── 技能加载 ────────────────────────────────
  load_skill: { permission: 'safe', category: 'orchestrator', alwaysAvailable: true, displayName: '加载技能' },

  // ─── 代码执行 ────────────────────────────────
  code_execute: { permission: 'dangerous', category: 'dev', displayName: '执行代码' },

  // ─── 视频 ────────────────────────────────────
  video_generate: { permission: 'safe', category: 'vision', alwaysAvailable: true, displayName: '生成视频' },
  video_status: { permission: 'safe', category: 'vision', alwaysAvailable: true, displayName: '视频状态' },
  video_list: { permission: 'safe', category: 'vision', alwaysAvailable: true, displayName: '列出视频' },
  video_show: { permission: 'safe', category: 'vision', alwaysAvailable: true, displayName: '展示视频' },
  video_gen_config: { permission: 'safe', category: 'vision', alwaysAvailable: true, displayName: '视频生成配置' },

  // ─── 图片编辑 ────────────────────────────────
  // image_edit 工具尚未实现，已移除幽灵元数据

  // ─── 计划 ────────────────────────────────────
  plan_create: { permission: 'moderate', category: 'plan', alwaysAvailable: true, displayName: '创建计划' },
  plan_update: { permission: 'moderate', category: 'plan', alwaysAvailable: true, displayName: '更新计划' },

  // ─── 文境 ────────────────────────────────────
  output_manuscript: { permission: 'safe', category: 'output', alwaysAvailable: true, displayName: '输出文境' },

  // ─── 爬虫 ────────────────────────────────────
  web_crawl: { permission: 'moderate', category: 'search', displayName: '网页爬虫' },

  // ─── 文档转换 ────────────────────────────────
  doc_convert: { permission: 'safe', category: 'file', alwaysAvailable: true, displayName: '文档转换' },

  // ─── 编排 ────────────────────────────────────
  dispatch_sub_agent: { permission: 'moderate', category: 'orchestrator', displayName: '调度子Agent' },
  pipeline_run_step: { permission: 'moderate', category: 'orchestrator', displayName: '运行流水线步骤' },

  // ─── A2UI 辅助 ───────────────────────────────
  a2ui_show_entity: { permission: 'safe', category: 'a2ui', alwaysAvailable: true, displayName: '展示实体' },
  a2ui_show_relation: { permission: 'safe', category: 'a2ui', alwaysAvailable: true, displayName: '展示关系' },

  // ─── Schema 导出 ─────────────────────────────
  schema_export: { permission: 'safe', category: 'schema', alwaysAvailable: true, displayName: '导出模式' },

  // ─── Web 搜索 CLI ────────────────────────────
  web_search_cli: { permission: 'moderate', category: 'dev', displayName: 'CLI 搜索' },
  web_qa_cli: { permission: 'moderate', category: 'dev', displayName: 'CLI 问答' },

  // ─── 文件分析 ────────────────────────────────
  file_analyze: { permission: 'safe', category: 'file', alwaysAvailable: true, displayName: '分析文件' },
}

/** 工具名→元数据的缓存 */
let _metaCache: Map<string, ToolMeta> | null = null

/**
 * 获取工具元数据
 *
 * 查找优先级（任务3 接线后）：
 * 1. 全局 ToolRegistry（声明式首选源，含别名解析）
 * 2. LEGACY_TOOL_META（旧工具/能力链工具兜底）
 * 3. ALIAS_MAP / LEGACY_ALGO_MAP / LEGACY_PLUGIN_MAP（旧工具名别名）
 * 4. 兜底：moderate 权限
 */
export function getToolMeta(toolName: string): ToolMeta {
  if (!_metaCache) {
    _metaCache = buildMetaCache()
  }
  return _metaCache.get(toolName) || { permission: 'moderate', category: 'coding' }
}

/** 重置缓存（测试用） */
export function resetToolMetaCache(): void {
  _metaCache = null
}

function buildMetaCache(): Map<string, ToolMeta> {
  const cache = new Map<string, ToolMeta>()

  // 1. 从全局 ToolRegistry 收集（任务3 接线：声明式首选源，含别名）
  //    ToolRegistry.register 时已自动注册 meta.aliases，此处一次性导出
  const registry = getGlobalToolRegistry()
  for (const tool of registry.getAll()) {
    if (tool.meta) {
      cache.set(tool.name, tool.meta)
      if (tool.meta.aliases) {
        for (const alias of tool.meta.aliases) {
          cache.set(alias, tool.meta)
        }
      }
    }
  }

  // 1.5. 无 meta 的工具不进 ToolRegistry，由 LEGACY_TOOL_META 兜底覆盖，无需此处处理

  // 2. 从 ALIAS_MAP 补充别名映射
  for (const [alias, canonical] of Object.entries(ALIAS_MAP)) {
    if (!cache.has(alias)) {
      const meta = cache.get(canonical)
      if (meta) cache.set(alias, meta)
    }
  }

  // 2.5. 从 LEGACY_ALGO_MAP 补充 algo 旧名映射
  for (const [alias, canonical] of Object.entries(LEGACY_ALGO_MAP)) {
    if (!cache.has(alias)) {
      const meta = cache.get(canonical)
      if (meta) cache.set(alias, meta)
    }
  }

  // 2.6. 从 LEGACY_PLUGIN_MAP 补充插件旧名映射
  for (const [alias, canonical] of Object.entries(LEGACY_PLUGIN_MAP)) {
    if (!cache.has(alias)) {
      const meta = cache.get(canonical)
      if (meta) cache.set(alias, meta)
    }
  }

  // 3. 从 LEGACY_TOOL_META 补充旧工具元数据
  for (const [name, meta] of Object.entries(LEGACY_TOOL_META)) {
    if (!cache.has(name)) {
      cache.set(name, meta)
    }
  }

  return cache
}
