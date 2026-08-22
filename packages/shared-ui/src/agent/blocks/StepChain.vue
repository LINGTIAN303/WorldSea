<template>
  <!-- 深度模式：卡片式步骤链 -->
  <div v-if="mode === 'deep'" class="deep-step-chain">
    <div
      v-for="(step, idx) in steps"
      :key="idx"
      class="deep-step"
      :class="{ 'deep-step-active': step.active, 'deep-step-done': step.done }"
    >
      <div class="deep-step-header">
        <div class="deep-step-marker">
          <span v-if="step.done" class="deep-step-check"><WsIcon name="check" size="xs" /></span>
          <span v-else-if="step.active" class="deep-step-pulse"></span>
          <span v-else class="deep-step-num">{{ idx + 1 }}</span>
        </div>
        <span class="deep-step-label">{{ step.label }}</span>
        <span v-if="step.done" class="deep-step-badge deep-step-badge-done">完成</span>
        <span v-else-if="step.active" class="deep-step-badge deep-step-badge-active">进行中</span>
        <span v-else class="deep-step-badge deep-step-badge-pending">待执行</span>
      </div>
      <!-- 进度条 -->
      <div v-if="step.tools.length > 0" class="deep-step-progress">
        <div class="deep-step-bar-track">
          <div
            class="deep-step-bar-fill"
            :class="{ pulsing: step.active }"
            :style="{ width: stepProgress(step) + '%' }"
          ></div>
        </div>
        <span class="deep-step-bar-pct">{{ Math.round(stepProgress(step)) }}%</span>
      </div>
      <!-- 工具调用列表 -->
      <div v-if="step.tools.length > 0" class="deep-step-tools">
        <div v-for="tc in step.tools" :key="tc.id" class="deep-step-tool" :class="tc.status">
          <span class="deep-step-tool-dot"></span>
          <span class="deep-step-tool-name">{{ getToolLabel(tc.name) }}</span>
          <span v-if="tc.status === 'running'" class="deep-step-tool-status running">执行中</span>
          <span v-else-if="tc.status === 'completed'" class="deep-step-tool-status completed">完成</span>
          <span v-else class="deep-step-tool-status failed">失败</span>
          <span v-if="tc.endedAt && tc.startedAt" class="deep-step-tool-dur">{{ formatDuration(tc.startedAt, tc.endedAt) }}</span>
        </div>
      </div>
    </div>
  </div>
  <!-- 普通模式：原始步骤链 -->
  <div v-else class="step-chain">
    <div
      v-for="(step, idx) in steps"
      :key="idx"
      class="step-item"
      :class="{ 'step-active': step.active, 'step-done': step.done }"
    >
      <div class="step-marker">
        <span v-if="step.done" class="step-check"><WsIcon name="check" size="xs" /></span>
        <span v-else-if="step.active" class="step-pulse ws-step-pulse" aria-hidden="true"></span>
        <span v-else class="step-dot">{{ idx + 1 }}</span>
      </div>
      <div v-if="idx < steps.length - 1" class="step-line" :class="{ 'step-line-done': step.done }"></div>
      <div class="step-body">
        <div class="step-title">{{ step.label }}</div>
        <div v-if="step.tools.length > 0" class="step-tools">
          <div v-for="tc in step.tools" :key="tc.id" class="step-tool" :class="tc.status">
            <span class="step-tool-icon">
              <span v-if="tc.status === 'running'" class="tc-spin"><WsIcon name="wrench" size="xs" /></span>
              <span v-else-if="tc.status === 'completed'"><WsIcon name="check" size="xs" /></span>
              <span v-else><WsIcon name="x" size="xs" /></span>
            </span>
            <span class="step-tool-name">{{ getToolLabel(tc.name) }}</span>
            <span v-if="tc.status === 'running'" class="step-tool-status">执行中…</span>
            <span v-else-if="tc.status === 'completed'" class="step-tool-status">完成</span>
            <span v-else class="step-tool-status">失败</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'

interface ToolCallView {
  id: string
  name: string
  args: Record<string, unknown>
  status: 'running' | 'completed' | 'failed'
  result?: string
  startedAt: number
  endedAt?: number
}

const TOOL_LABELS: Record<string, string> = {
  // 实体
  entity_create: '创建实体', entity_get: '获取实体', entity_update: '更新实体',
  entity_delete: '删除实体', entity_list: '实体列表', entity_suggest_field: '建议字段',
  entity_smart_fill: '智能填充', entity_get_context: '获取上下文',
  // 关系
  relation_create: '创建关系', relation_delete: '删除关系', relation_list: '关系列表',
  // 搜索
  content_search: '内容搜索',
  // 知识库
  kb_search: '知识库搜索', kb_list: '知识库列表', kb_read: '知识库读取',
  kb_write: '知识库写入', kb_extract: '知识库提取', kb_delete: '知识库删除',
  kb_reflect: '知识库反思', kb_link: '知识库关联', kb_init: '知识库初始化',
  // 一致性
  consistency_check: '一致性检查', schema_validate: '模式验证',
  // 算法
  algo_graph_analysis: '图分析', algo_pagerank: 'PageRank',
  algo_community_detection: '社区检测', algo_shortest_path: '最短路径',
  algo_k_shortest_paths: 'K最短路径', algo_topological_sort: '拓扑排序',
  algo_force_layout: '力导向布局',
  // 联网
  web_search: '联网搜索', web_fetch: '网页抓取',
  web_search_cli: 'CLI搜索', web_fetch_cli: 'CLI抓取', web_qa_cli: 'CLI问答',
  // 记忆
  memory_store: '存储记忆', memory_recall: '回忆记忆', memory_delete: '删除记忆',
  // 输出组件
  output_table: '表格', output_list: '列表', output_alert: '提示',
  output_comparison: '对比', output_accordion: '折叠区', output_entity_card: '实体卡',
  output_progress: '进度', output_choice: '选项', output_code: '代码',
  output_stat: '统计', output_timeline: '时间线', output_image: '图片',
  output_manuscript: '文境',
  // UI
  ui_create_surface: '创建界面', ui_update_components: '更新组件', ui_update_data: '更新数据',
  ui_delete_surface: '删除界面',
  a2ui_show_entity: '展示实体', a2ui_show_relation: '展示关系',
  // 文件系统
  fs_read: '读取文件', fs_write: '写入文件', fs_list: '文件列表',
  fs_move: '移动文件', fs_delete: '删除文件', fs_search: '搜索文件',
  fs_stat: '文件状态', fs_mkdir: '创建目录', fs_copy: '复制文件',
  // 编码 Agent 标准工具
  read_file: '读取文件', write_file: '写入文件', edit_file: '编辑文件',
  search_files: '搜索文件', list_directory: '列出目录',
  // 旧版文件工具
  file_read: '读取文件', file_write: '写入文件', file_list: '文件列表',
  file_delete: '删除文件', file_associate: '关联文件', file_analyze: '分析文件',
  // 图片/视频
  image_generate: '图片生成', image_edit: '图片编辑', image_gen_config: '图片配置',
  image_list: '图片列表', image_show: '图片展示',
  video_generate: '视频生成', video_status: '视频状态', video_list: '视频列表',
  video_show: '视频展示', video_gen_config: '视频配置',
  // 视觉
  vision_analyze: '视觉分析', list_vision_images: '图片列表',
  // 人格
  persona_apply: '人格附体', persona_reset: '人格重置', persona_update: '人格更新',
  // Schema
  schema_register_entity_type: '注册实体类型', schema_unregister_entity_type: '注销实体类型',
  schema_get_entity_type: '获取实体类型', schema_list_entity_types: '列出实体类型',
  schema_update_entity_type: '更新实体类型', schema_register_validation: '注册验证规则',
  schema_register_view: '注册视图', schema_export: '导出模式',
  // 其他
  load_skill: '加载技能', plugin_write: '写入插件',
  project_export: '项目导出', project_import: '项目导入',
  daily_report: '每日报告', plan_create: '创建计划', plan_update: '更新计划',
  // 图谱插件
  graph_get_nodes: '获取节点', graph_get_edges: '获取边', graph_find_path: '查找路径',
  graph_cluster_analysis: '聚类分析', graph_highlight_nodes: '高亮节点',
  graph_export_snapshot: '导出快照', graph_filter_by_type: '类型过滤', graph_search_subgraph: '子图搜索',
}

function getToolLabel(name: string): string {
  return TOOL_LABELS[name] || name.replace(/_/g, ' ')
}

/**
 * 深度模式步骤定义
 *
 * 每个步骤包含 label 和匹配的工具名列表。
 * 工具名按类别分组，未匹配的工具归入"其他操作"步骤。
 * 步骤顺序遵循深度思考工作流：问题拆解 → 证据收集 → 推理分析 → 创作操作 → 结论输出 → 其他
 */
const DEEP_STEPS = [
  {
    label: '问题拆解',
    tools: ['output_list', 'output_choice'],
  },
  {
    label: '证据收集',
    tools: [
      'entity_get', 'entity_list', 'entity_suggest_field', 'entity_smart_fill', 'entity_get_context',
      'content_search', 'relation_list',
      'kb_search', 'kb_list', 'kb_read', 'kb_extract', 'kb_reflect', 'kb_link',
      'web_search', 'web_fetch', 'web_search_cli', 'web_fetch_cli', 'web_qa_cli',
      'vision_analyze', 'list_vision_images',
      'memory_recall',
      'fs_read', 'fs_list', 'fs_search', 'fs_stat',
      'read_file', 'search_files', 'list_directory',
      'file_read', 'file_list', 'file_analyze',
    ],
  },
  {
    label: '推理分析',
    tools: [
      'algo_graph_analysis', 'algo_pagerank', 'algo_community_detection',
      'algo_shortest_path', 'algo_k_shortest_paths', 'algo_topological_sort',
      'algo_force_layout',
      'consistency_check', 'schema_validate',
      'graph_get_nodes', 'graph_get_edges', 'graph_find_path', 'graph_cluster_analysis',
      'graph_highlight_nodes', 'graph_export_snapshot', 'graph_filter_by_type', 'graph_search_subgraph',
    ],
  },
  {
    label: '创作操作',
    tools: [
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
    ],
  },
  {
    label: '结论输出',
    tools: [
      'output_table', 'output_comparison', 'output_accordion', 'output_alert',
      'output_stat', 'output_code', 'output_entity_card', 'output_progress',
      'output_timeline', 'output_image', 'output_manuscript',
    ],
  },
  {
    label: '其他操作',
    tools: [], // 兜底：未匹配的工具自动归入此步骤
  },
]

/** 收集所有已定义步骤的工具名集合（用于快速判断是否需要兜底） */
const ALL_DEFINED_TOOLS = new Set(DEEP_STEPS.flatMap(s => s.tools))

const props = defineProps<{
  toolCalls: ToolCallView[]
  mode?: 'default' | 'deep'
}>()

const steps = computed(() => {
  let activeFound = false
  // 先将每个工具调用分配到对应的步骤
  const stepToolMap = DEEP_STEPS.map(stepDef =>
    props.toolCalls.filter(tc => stepDef.tools.includes(tc.name))
  )
  // 兜底：未匹配的工具归入最后一个"其他操作"步骤
  const lastIdx = stepToolMap.length - 1
  const unmatched = props.toolCalls.filter(tc => !ALL_DEFINED_TOOLS.has(tc.name))
  stepToolMap[lastIdx] = unmatched

  return DEEP_STEPS.map((stepDef, idx) => {
    const stepTools = stepToolMap[idx]
    // "其他操作"步骤只在有工具时才显示
    if (idx === lastIdx && stepTools.length === 0) {
      return { label: stepDef.label, tools: stepTools, active: false, done: false, hidden: true }
    }
    const hasRunning = stepTools.some(tc => tc.status === 'running')
    const allDone = stepTools.length > 0 && stepTools.every(tc => tc.status === 'completed' || tc.status === 'failed')
    const active = !allDone && (hasRunning || (!activeFound && stepTools.length > 0) || (!activeFound && idx === firstStepWithTools.value))
    if (active) activeFound = true
    return {
      label: stepDef.label,
      tools: stepTools,
      active,
      done: allDone,
      hidden: false,
    }
  }).filter(s => !s.hidden)
})

const firstStepWithTools = computed(() => {
  for (let i = 0; i < DEEP_STEPS.length; i++) {
    if (i === DEEP_STEPS.length - 1) {
      // 兜底步骤：检查是否有未匹配的工具
      if (props.toolCalls.some(tc => !ALL_DEFINED_TOOLS.has(tc.name))) return i
    } else {
      const hasTools = props.toolCalls.some(tc => DEEP_STEPS[i].tools.includes(tc.name))
      if (hasTools) return i
    }
  }
  return 0
})

function stepProgress(step: { tools: ToolCallView[] }): number {
  if (step.tools.length === 0) return 0
  const completed = step.tools.filter(tc => tc.status === 'completed' || tc.status === 'failed').length
  return (completed / step.tools.length) * 100
}

function formatDuration(start: number, end: number): string {
  const ms = end - start
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}min`
}
</script>

<style scoped>
/* ===== 深度模式：卡片式步骤链 ===== */
.deep-step-chain {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.deep-step {
  border-radius: 10px;
  border: 1px solid var(--agent-border);
  background: color-mix(in srgb, var(--bg-surface) 2%, transparent);
  overflow: hidden;
  transition: border-color 0.2s, background 0.2s;
}

.deep-step-active {
  border-color: color-mix(in srgb, var(--agent-primary) 25%, transparent);
  background: color-mix(in srgb, var(--agent-primary) 4%, transparent);
}

.deep-step-done {
  border-color: color-mix(in srgb, var(--agent-success, #22c55e) 15%, transparent);
}

.deep-step-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
}

.deep-step-marker {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  background: var(--agent-border);
  border: 1.5px solid color-mix(in srgb, var(--bg-surface) 12%, transparent);
  color: var(--agent-text-tertiary);
}

.deep-step-done .deep-step-marker {
  background: color-mix(in srgb, var(--agent-success, #22c55e) 15%, transparent);
  border-color: color-mix(in srgb, var(--agent-success, #22c55e) 40%, transparent);
  color: var(--agent-success, #22c55e);
}

.deep-step-active .deep-step-marker {
  background: color-mix(in srgb, var(--agent-primary) 15%, transparent);
  border-color: color-mix(in srgb, var(--agent-primary) 50%, transparent);
  color: var(--agent-primary);
}

.deep-step-check { display: flex; align-items: center; justify-content: center; }

.deep-step-pulse {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--agent-primary);
  animation: ws-pulse 1.5s infinite;
}

.deep-step-num { font-size: 10px; }

.deep-step-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--agent-text);
  flex: 1;
}

.deep-step-active .deep-step-label {
  color: var(--agent-primary);
}

.deep-step-done .deep-step-label {
  color: color-mix(in srgb, var(--agent-success, #22c55e) 80%, transparent);
}

.deep-step-badge {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 8px;
  font-weight: 500;
}

.deep-step-badge-done {
  background: color-mix(in srgb, var(--agent-success, #22c55e) 10%, transparent);
  color: color-mix(in srgb, var(--agent-success, #22c55e) 80%, transparent);
}

.deep-step-badge-active {
  background: color-mix(in srgb, var(--agent-primary) 10%, transparent);
  color: var(--agent-primary);
}

.deep-step-badge-pending {
  background: var(--agent-border);
  color: var(--agent-text-tertiary);
}

/* 深度模式：进度条 */
.deep-step-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px 6px 42px;
}

.deep-step-bar-track {
  flex: 1;
  height: 3px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--bg-surface) 6%, transparent);
  overflow: hidden;
}

.deep-step-bar-fill {
  height: 100%;
  border-radius: 2px;
  background: var(--agent-primary);
  transition: width 0.4s ease;
}

.deep-step-done .deep-step-bar-fill {
  background: var(--agent-success, #22c55e);
}

.deep-step-bar-fill.pulsing {
  animation: bar-pulse 1.8s ease-in-out infinite;
}

@keyframes bar-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.deep-step-bar-pct {
  font-size: 10px;
  color: var(--agent-text-tertiary);
  font-variant-numeric: tabular-nums;
  min-width: 28px;
  text-align: right;
}

/* 深度模式：工具调用列表 */
.deep-step-tools {
  padding: 2px 12px 8px 42px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.deep-step-tool {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border-radius: 5px;
  font-size: 11px;
  background: color-mix(in srgb, var(--bg-surface) 2%, transparent);
}

.deep-step-tool.running {
  background: color-mix(in srgb, var(--agent-primary) 6%, transparent);
}

.deep-step-tool.completed {
  opacity: 0.7;
}

.deep-step-tool-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--agent-text-tertiary);
}

.deep-step-tool.running .deep-step-tool-dot {
  background: var(--agent-primary);
  animation: ws-pulse 1.5s infinite;
}

.deep-step-tool.completed .deep-step-tool-dot {
  background: var(--agent-success, #22c55e);
}

.deep-step-tool.failed .deep-step-tool-dot {
  background: var(--agent-danger, #ef4444);
}

.deep-step-tool-name {
  color: var(--agent-text-secondary);
  flex: 1;
}

.deep-step-tool-status {
  font-size: 10px;
}

.deep-step-tool-status.running { color: var(--agent-primary); }
.deep-step-tool-status.completed { color: color-mix(in srgb, var(--agent-success, #22c55e) 60%, transparent); }
.deep-step-tool-status.failed { color: color-mix(in srgb, var(--agent-danger, #ef4444) 60%, transparent); }

.deep-step-tool-dur {
  font-size: 10px;
  color: var(--agent-text-tertiary);
  font-variant-numeric: tabular-nums;
}

/* ===== 普通模式：原始步骤链 ===== */
.step-chain {
  padding: 8px 0;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.step-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  position: relative;
  min-height: 28px;
}

.step-marker {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
  background: var(--agent-border);
  border: 1.5px solid color-mix(in srgb, var(--bg-surface) 15%, transparent);
  color: var(--agent-text-secondary);
  position: relative;
  z-index: 1;
}

.step-item.step-done .step-marker {
  background: color-mix(in srgb, var(--agent-success, #22c55e) 15%, transparent);
  border-color: color-mix(in srgb, var(--agent-success, #22c55e) 40%, transparent);
  color: var(--agent-success, #22c55e);
}

.step-item.step-active .step-marker {
  background: color-mix(in srgb, var(--agent-primary) 15%, transparent);
  border-color: color-mix(in srgb, var(--agent-primary) 50%, transparent);
  color: var(--agent-primary);
}

.step-check { font-size: 12px; font-weight: 700; }
/* 步骤进行中：CSS 圆点（ws- 前缀类名确保 reduced-motion 停用脉冲） */
.step-pulse {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--agent-primary);
  display: inline-block;
  animation: ws-pulse 1.5s infinite;
}
.step-dot { font-size: 10px; }

.step-line {
  position: absolute;
  left: 10px;
  top: 22px;
  width: 1.5px;
  height: calc(100% - 22px);
  background: color-mix(in srgb, var(--bg-surface) 10%, transparent);
}

.step-line-done {
  background: color-mix(in srgb, var(--agent-success, #22c55e) 30%, transparent);
}

.step-body {
  flex: 1;
  padding-bottom: 12px;
  min-width: 0;
}

.step-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--agent-text);
  line-height: 22px;
}

.step-item.step-active .step-title {
  color: var(--agent-primary);
}

.step-item.step-done .step-title {
  color: color-mix(in srgb, var(--agent-success, #22c55e) 80%, transparent);
}

.step-tools {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 4px;
}

.step-tool {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  background: color-mix(in srgb, var(--bg-surface) 3%, transparent);
}

.step-tool.running {
  background: color-mix(in srgb, var(--agent-primary) 8%, transparent);
}

.step-tool.completed {
  opacity: 0.7;
}

.step-tool-icon { font-size: 11px; }
.step-tool-name { color: var(--agent-text-secondary); }
.step-tool-status { margin-left: auto; font-size: 10px; color: var(--agent-text-tertiary); }
.step-tool.running .step-tool-status { color: var(--agent-primary); }
.step-tool.completed .step-tool-status { color: color-mix(in srgb, var(--agent-success, #22c55e) 60%, transparent); }
.step-tool.failed .step-tool-status { color: color-mix(in srgb, var(--agent-danger, #ef4444) 60%, transparent); }

.tc-spin { animation: ws-spin 1.2s linear infinite; display: inline-block; }
</style>
