/**
 * InteractiveToolCall 子组件共享工具函数
 *
 * 从原 InteractiveToolCall.vue 提取，仅包含纯函数与常量：
 * - TOOL_LABELS: 工具名→中文标签映射
 * - getToolLabel: 取工具中文标签，缺失时回退为空白分隔名
 * - formatDuration: 毫秒时长格式化
 * - formatJson / formatResult: JSON 序列化与截断
 */

/** 工具名→中文标签映射（覆盖实体/关系/知识库/输出/系统等全量工具） */
export const TOOL_LABELS: Record<string, string> = {
  entity_create: '创建实体', entity_get: '获取实体', entity_update: '更新实体',
  entity_delete: '删除实体', entity_list: '实体列表', entity_suggest_field: '建议字段',
  entity_smart_fill: '智能填充', entity_get_context: '获取上下文',
  relation_create: '创建关系', relation_delete: '删除关系', relation_list: '关系列表',
  content_search: '内容搜索',
  kb_search: '知识库搜索', kb_list: '知识库列表', kb_read: '知识库读取',
  kb_write: '知识库写入', kb_extract: '知识库提取', kb_delete: '知识库删除',
  kb_reflect: '知识库反思', kb_link: '知识库关联', kb_init: '知识库初始化',
  consistency_check: '一致性检查', schema_validate: '模式验证',
  web_search: '联网搜索', web_fetch: '网页抓取',
  memory_store: '存储记忆', memory_recall: '回忆记忆', memory_delete: '删除记忆',
  output_table: '表格', output_list: '列表', output_alert: '提示',
  output_comparison: '对比', output_accordion: '折叠区', output_entity_card: '实体卡',
  output_progress: '进度', output_choice: '选项', output_code: '代码',
  output_stat: '统计', output_timeline: '时间线', output_image: '图片',
  output_manuscript: '文境',
  dialog_open: '打开文件', dialog_save: '保存文件', dialog_message: '消息对话框',
  dialog_ask: '询问对话框', clipboard_read: '读取剪贴板', clipboard_write: '写入剪贴板',
  open_url: '打开链接', notify: '发送通知', native_fetch: '原生请求',
  load_skill: '加载技能',
  execute_command: '执行命令', shell_session: 'Shell会话',
  read_file: '读取文件', write_file: '写入文件', edit_file: '编辑文件',
  search_files: '搜索文件', list_directory: '列出目录',
  image_generate: '图片生成', image_edit: '图片编辑',
  video_generate: '视频生成', video_status: '视频状态',
  persona_apply: '人格附体', persona_reset: '人格重置', persona_update: '人格更新',
  schema_register_entity_type: '注册实体类型', schema_unregister_entity_type: '注销实体类型',
  schema_list_entity_types: '列出实体类型',
  daily_report: '每日报告', plan_create: '创建计划', plan_update: '更新计划',
  ui_create_surface: '创建界面', ui_update_components: '更新组件',
  ui_update_data: '更新数据', ui_delete_surface: '删除界面',
  a2ui_show_entity: '展示实体', a2ui_show_relation: '展示关系',
}

/** 取工具中文标签；缺失时回退为下划线→空格的原名 */
export function getToolLabel(name: string): string {
  return TOOL_LABELS[name] || name.replace(/_/g, ' ')
}

/** 毫秒时长格式化：<1s 显示 ms，<1min 显示 s，否则显示 min */
export function formatDuration(start: number, end: number): string {
  const ms = end - start
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}min`
}

/** 任意对象 JSON 美化；解析失败时回退 String() */
export function formatJson(obj: unknown): string {
  try { return JSON.stringify(obj, null, 2) } catch { return String(obj) }
}

/** 工具结果字符串格式化：尝试 JSON 美化，超 2000 字符截断 */
export function formatResult(result: string): string {
  if (!result) return ''
  try {
    const parsed = JSON.parse(result)
    const str = JSON.stringify(parsed, null, 2)
    return str.length > 2000 ? str.slice(0, 1997) + '...' : str
  } catch {
    return result.length > 2000 ? result.slice(0, 1997) + '...' : result
  }
}
