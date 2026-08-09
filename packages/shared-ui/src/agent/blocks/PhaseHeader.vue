<template>
  <div class="phase-header" :class="{ active: isActive, done: isDone }" role="button" tabindex="0" :aria-expanded="isExpanded" @click="toggleExpand" @keydown.enter.prevent="toggleExpand" @keydown.space.prevent="toggleExpand">
    <div class="phase-header-main">
      <div class="phase-marker">
        <span v-if="isDone" class="phase-check"><WsIcon name="check" size="xs" /></span>
        <span v-else-if="isActive" class="phase-pulse"></span>
        <span v-else class="phase-num">{{ index + 1 }}</span>
      </div>
      <span class="phase-label">{{ label }}</span>
      <span class="phase-count">{{ completedCount }}/{{ tools.length }}</span>
      <!-- 进度条 -->
      <div class="phase-bar-track">
        <div
          class="phase-bar-fill"
          :class="{ pulsing: isActive }"
          :style="{ width: progress + '%' }"
        ></div>
      </div>
      <span class="phase-chevron" :class="{ expanded: isExpanded }">▸</span>
    </div>
    <!-- 展开后：工具摘要列表 -->
    <Transition name="phase-expand">
      <div v-if="isExpanded" class="phase-tools-summary" @click.stop>
        <div v-for="tc in tools" :key="tc.id" class="phase-tool-row" :class="tc.status">
          <span class="phase-tool-dot"></span>
          <span class="phase-tool-name">{{ getToolLabel(tc.name) }}</span>
          <span v-if="tc.status === 'running'" class="phase-tool-status running">执行中</span>
          <span v-else-if="tc.status === 'completed'" class="phase-tool-status completed">完成</span>
          <span v-else class="phase-tool-status failed">失败</span>
          <span v-if="tc.endedAt && tc.startedAt" class="phase-tool-dur">{{ formatDuration(tc.startedAt, tc.endedAt) }}</span>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import type { ToolCallView } from './InlineToolCall.vue'

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

function getToolLabel(name: string): string {
  return TOOL_LABELS[name] || name.replace(/_/g, ' ')
}

const props = defineProps<{
  label: string
  index: number
  tools: ToolCallView[]
  isActive: boolean
  isDone: boolean
  defaultExpanded?: boolean
}>()

const isExpanded = ref(props.defaultExpanded ?? false)

function toggleExpand() {
  isExpanded.value = !isExpanded.value
}

const completedCount = computed(() =>
  props.tools.filter(tc => tc.status === 'completed' || tc.status === 'failed').length
)

const progress = computed(() => {
  if (props.tools.length === 0) return 0
  return (completedCount.value / props.tools.length) * 100
})

function formatDuration(start: number, end: number): string {
  const ms = end - start
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}min`
}
</script>

<style scoped>
.phase-header {
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
  overflow: hidden;
}

.phase-header:hover {
  border-color: rgba(255, 255, 255, 0.1);
}

.phase-header.active {
  border-color: color-mix(in srgb, var(--agent-primary) 20%, transparent);
  background: color-mix(in srgb, var(--agent-primary) 3%, transparent);
}

.phase-header.done {
  border-color: color-mix(in srgb, var(--agent-success, #22c55e) 12%, transparent);
}

.phase-header-main {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
}

.phase-marker {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.06);
  border: 1.5px solid rgba(255, 255, 255, 0.12);
  color: var(--agent-text-tertiary);
}

.done .phase-marker {
  background: color-mix(in srgb, var(--agent-success, #22c55e) 15%, transparent);
  border-color: color-mix(in srgb, var(--agent-success, #22c55e) 40%, transparent);
  color: var(--agent-success, #22c55e);
}

.active .phase-marker {
  background: color-mix(in srgb, var(--agent-primary) 15%, transparent);
  border-color: color-mix(in srgb, var(--agent-primary) 50%, transparent);
  color: var(--agent-primary);
}

.phase-check {
  display: flex;
  align-items: center;
  justify-content: center;
}

.phase-pulse {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--agent-primary);
  animation: ph-pulse 1.5s infinite;
}

.phase-num {
  font-size: 9px;
}

.phase-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--agent-text);
  flex-shrink: 0;
}

.active .phase-label {
  color: var(--agent-primary);
}

.done .phase-label {
  color: color-mix(in srgb, var(--agent-success, #22c55e) 80%, transparent);
}

.phase-count {
  font-size: 10px;
  color: var(--agent-text-tertiary);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.phase-bar-track {
  flex: 1;
  height: 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.06);
  overflow: hidden;
  min-width: 40px;
}

.phase-bar-fill {
  height: 100%;
  border-radius: 2px;
  background: var(--agent-primary);
  transition: width 0.4s ease;
}

.done .phase-bar-fill {
  background: var(--agent-success, #22c55e);
}

.phase-bar-fill.pulsing {
  animation: bar-pulse 1.8s ease-in-out infinite;
}

@keyframes bar-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.phase-chevron {
  font-size: 10px;
  color: var(--agent-text-tertiary);
  transition: transform 0.2s;
  flex-shrink: 0;
}

.phase-chevron.expanded {
  transform: rotate(90deg);
}

/* 展开后：工具摘要列表 */
.phase-tools-summary {
  padding: 2px 12px 8px 40px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
}

.phase-tool-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 11px;
}

.phase-tool-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--agent-text-tertiary);
}

.phase-tool-row.running .phase-tool-dot {
  background: var(--agent-primary);
  animation: ph-pulse 1.5s infinite;
}

.phase-tool-row.completed .phase-tool-dot {
  background: var(--agent-success, #22c55e);
}

.phase-tool-row.failed .phase-tool-dot {
  background: var(--agent-danger, #ef4444);
}

.phase-tool-name {
  color: var(--agent-text-secondary);
  flex: 1;
}

.phase-tool-status {
  font-size: 10px;
}

.phase-tool-status.running { color: var(--agent-primary); }
.phase-tool-status.completed { color: color-mix(in srgb, var(--agent-success, #22c55e) 60%, transparent); }
.phase-tool-status.failed { color: color-mix(in srgb, var(--agent-danger, #ef4444) 60%, transparent); }

.phase-tool-dur {
  font-size: 10px;
  color: var(--agent-text-tertiary);
  font-variant-numeric: tabular-nums;
}

/* 展开动画 */
.phase-expand-enter-active,
.phase-expand-leave-active {
  transition: max-height 0.2s ease, opacity 0.15s ease;
  max-height: 400px;
  overflow: hidden;
}

.phase-expand-enter-from,
.phase-expand-leave-to {
  max-height: 0;
  opacity: 0;
}

@keyframes ph-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>
