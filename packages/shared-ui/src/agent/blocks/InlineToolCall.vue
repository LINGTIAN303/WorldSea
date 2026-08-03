<template>
  <div class="inline-tool-call" :class="tc.status" @click="toggleExpand">
    <!-- 摘要行1：工具名 + 状态 + 耗时 -->
    <div class="itc-summary">
      <span class="itc-dot"></span>
      <span class="itc-name">{{ label }}</span>
      <span v-if="tc.status === 'running'" class="itc-status running">执行中</span>
      <span v-else-if="tc.status === 'completed'" class="itc-status completed">完成</span>
      <span v-else class="itc-status failed">失败</span>
      <span v-if="tc.endedAt && tc.startedAt" class="itc-dur">{{ formatDuration(tc.startedAt, tc.endedAt) }}</span>
      <span class="itc-chevron" :class="{ expanded: isExpanded }">▸</span>
    </div>
    <!-- 摘要行2：参数摘要 -->
    <div class="itc-args-preview">
      {{ argsPreview }}
    </div>
    <!-- 展开详情 -->
    <Transition name="itc-expand">
      <div v-if="isExpanded" class="itc-detail" @click.stop>
        <div v-if="hasArgs" class="itc-detail-section">
          <div class="itc-detail-label">参数</div>
          <pre class="itc-detail-code">{{ formatJson(tc.args) }}</pre>
        </div>
        <div v-if="tc.result" class="itc-detail-section">
          <div class="itc-detail-label">结果</div>
          <pre class="itc-detail-code itc-detail-result">{{ formatResult(tc.result) }}</pre>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

export interface ToolCallView {
  id: string
  name: string
  args: Record<string, unknown>
  status: 'running' | 'completed' | 'failed'
  result?: string
  startedAt: number
  endedAt?: number
}

const TOOL_LABELS: Record<string, string> = {
  entity_create: '创建实体', entity_get: '获取实体', entity_update: '更新实体',
  entity_delete: '删除实体', entity_list: '实体列表', entity_suggest_field: '建议字段',
  entity_smart_fill: '智能填充', entity_get_context: '获取上下文',
  relation_create: '创建关系', relation_delete: '删除关系', relation_list: '关系列表',
  content_search: '内容搜索',
  kb_search: '知识库搜索', kb_list: '知识库列表', kb_read: '知识库读取',
  kb_write: '知识库写入', kb_extract: '知识库提取', kb_delete: '知识库删除',
  kb_reflect: '知识库反思', kb_link: '知识库关联', kb_init: '知识库初始化',
  consistency_check: '一致性检查', schema_validate: '模式验证',
  algo_graph_analysis: '图分析', algo_pagerank: 'PageRank',
  algo_community_detection: '社区检测', algo_shortest_path: '最短路径',
  algo_k_shortest_paths: 'K最短路径', algo_topological_sort: '拓扑排序',
  algo_force_layout: '力导向布局',
  web_search: '联网搜索', web_fetch: '网页抓取',
  web_search_cli: 'CLI搜索', web_fetch_cli: 'CLI抓取', web_qa_cli: 'CLI问答',
  memory_store: '存储记忆', memory_recall: '回忆记忆', memory_delete: '删除记忆',
  output_table: '表格', output_list: '列表', output_alert: '提示',
  output_comparison: '对比', output_accordion: '折叠区', output_entity_card: '实体卡',
  output_progress: '进度', output_choice: '选项', output_code: '代码',
  output_stat: '统计', output_timeline: '时间线', output_image: '图片',
  output_manuscript: '文境',
  ui_create_surface: '创建界面', ui_update_components: '更新组件', ui_update_data: '更新数据',
  ui_delete_surface: '删除界面',
  a2ui_show_entity: '展示实体', a2ui_show_relation: '展示关系',
  fs_read: '读取文件', fs_write: '写入文件', fs_list: '文件列表',
  fs_move: '移动文件', fs_delete: '删除文件', fs_search: '搜索文件',
  fs_stat: '文件状态', fs_mkdir: '创建目录', fs_copy: '复制文件',
  read_file: '读取文件', write_file: '写入文件', edit_file: '编辑文件',
  search_files: '搜索文件', list_directory: '列出目录',
  file_read: '读取文件', file_write: '写入文件', file_list: '文件列表',
  file_delete: '删除文件', file_associate: '关联文件', file_analyze: '分析文件',
  image_generate: '图片生成', image_edit: '图片编辑', image_gen_config: '图片配置',
  image_list: '图片列表', image_show: '图片展示',
  video_generate: '视频生成', video_status: '视频状态', video_list: '视频列表',
  video_show: '视频展示', video_gen_config: '视频配置',
  vision_analyze: '视觉分析', list_vision_images: '图片列表',
  persona_apply: '人格附体', persona_reset: '人格重置', persona_update: '人格更新',
  schema_register_entity_type: '注册实体类型', schema_unregister_entity_type: '注销实体类型',
  schema_get_entity_type: '获取实体类型', schema_list_entity_types: '列出实体类型',
  schema_update_entity_type: '更新实体类型', schema_register_validation: '注册验证规则',
  schema_register_view: '注册视图', schema_export: '导出模式',
  load_skill: '加载技能', plugin_write: '写入插件',
  project_export: '项目导出', project_import: '项目导入',
  daily_report: '每日报告', plan_create: '创建计划', plan_update: '更新计划',
  graph_get_nodes: '获取节点', graph_get_edges: '获取边', graph_find_path: '查找路径',
  graph_cluster_analysis: '聚类分析', graph_highlight_nodes: '高亮节点',
  graph_export_snapshot: '导出快照', graph_filter_by_type: '类型过滤', graph_search_subgraph: '子图搜索',
  execute_command: '执行命令', shell_session: 'Shell会话',
}

const props = defineProps<{
  tc: ToolCallView
}>()

const isExpanded = ref(false)

function toggleExpand() {
  isExpanded.value = !isExpanded.value
}

const label = computed(() => TOOL_LABELS[props.tc.name] || props.tc.name.replace(/_/g, ' '))

const hasArgs = computed(() => Object.keys(props.tc.args).length > 0)

/** 参数摘要：提取关键参数值用于一行预览 */
const argsPreview = computed(() => {
  const args = props.tc.args
  const keys = Object.keys(args)
  if (keys.length === 0) return ''
  // 优先展示常见的关键参数
  const priorityKeys = ['name', 'query', 'keyword', 'type', 'entityType', 'id', 'path', 'url', 'prompt', 'content']
  for (const pk of priorityKeys) {
    if (args[pk] && typeof args[pk] === 'string') {
      const val = String(args[pk])
      return val.length > 60 ? val.slice(0, 57) + '...' : val
    }
  }
  // 回退：取第一个字符串参数
  for (const k of keys) {
    if (typeof args[k] === 'string') {
      const val = String(args[k])
      return val.length > 60 ? val.slice(0, 57) + '...' : val
    }
  }
  // 回退：key=value 拼接
  return keys.slice(0, 3).map(k => `${k}=${JSON.stringify(args[k])}`).join(', ')
})

function formatDuration(start: number, end: number): string {
  const ms = end - start
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}min`
}

function formatJson(obj: Record<string, unknown>): string {
  try {
    return JSON.stringify(obj, null, 2)
  } catch {
    return String(obj)
  }
}

function formatResult(result: string): string {
  if (!result) return ''
  try {
    const parsed = JSON.parse(result)
    const str = JSON.stringify(parsed, null, 2)
    return str.length > 2000 ? str.slice(0, 1997) + '...' : str
  } catch {
    return result.length > 2000 ? result.slice(0, 1997) + '...' : result
  }
}
</script>

<style scoped>
.inline-tool-call {
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  overflow: hidden;
}

.inline-tool-call:hover {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.03);
}

.inline-tool-call.running {
  border-color: color-mix(in srgb, var(--agent-primary) 20%, transparent);
  background: color-mix(in srgb, var(--agent-primary) 3%, transparent);
}

.inline-tool-call.completed {
  opacity: 0.85;
}

.inline-tool-call.failed {
  border-color: color-mix(in srgb, var(--agent-danger, #ef4444) 15%, transparent);
}

/* 摘要行1 */
.itc-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  font-size: 12px;
}

.itc-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--agent-text-tertiary);
}

.running .itc-dot {
  background: var(--agent-primary);
  animation: itc-pulse 1.5s infinite;
}

.completed .itc-dot {
  background: var(--agent-success, #22c55e);
}

.failed .itc-dot {
  background: var(--agent-danger, #ef4444);
}

.itc-name {
  font-weight: 600;
  color: var(--agent-text);
  flex-shrink: 0;
}

.itc-status {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 6px;
  flex-shrink: 0;
}

.itc-status.running {
  background: color-mix(in srgb, var(--agent-primary) 10%, transparent);
  color: var(--agent-primary);
}

.itc-status.completed {
  background: color-mix(in srgb, var(--agent-success, #22c55e) 8%, transparent);
  color: color-mix(in srgb, var(--agent-success, #22c55e) 70%, transparent);
}

.itc-status.failed {
  background: color-mix(in srgb, var(--agent-danger, #ef4444) 8%, transparent);
  color: color-mix(in srgb, var(--agent-danger, #ef4444) 70%, transparent);
}

.itc-dur {
  font-size: 10px;
  color: var(--agent-text-tertiary);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.itc-chevron {
  margin-left: auto;
  font-size: 10px;
  color: var(--agent-text-tertiary);
  transition: transform 0.2s;
  flex-shrink: 0;
}

.itc-chevron.expanded {
  transform: rotate(90deg);
}

/* 摘要行2：参数预览 */
.itc-args-preview {
  padding: 0 10px 6px 22px;
  font-size: 11px;
  color: var(--agent-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.4;
}

/* 展开详情 */
.itc-detail {
  border-top: 1px solid rgba(255, 255, 255, 0.04);
  padding: 8px 10px;
}

.itc-detail-section {
  margin-bottom: 6px;
}

.itc-detail-section:last-child {
  margin-bottom: 0;
}

.itc-detail-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--agent-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}

.itc-detail-code {
  font-size: 11px;
  line-height: 1.5;
  color: var(--agent-text-secondary);
  background: rgba(0, 0, 0, 0.15);
  padding: 6px 8px;
  border-radius: 6px;
  overflow-x: auto;
  max-height: 200px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
  font-family: 'Consolas', 'Monaco', monospace;
}

.itc-detail-result {
  max-height: 300px;
}

/* 展开动画 */
.itc-expand-enter-active,
.itc-expand-leave-active {
  transition: max-height 0.2s ease, opacity 0.15s ease;
  max-height: 400px;
  overflow: hidden;
}

.itc-expand-enter-from,
.itc-expand-leave-to {
  max-height: 0;
  opacity: 0;
}

@keyframes itc-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>
