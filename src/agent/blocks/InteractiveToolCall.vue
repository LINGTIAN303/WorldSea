<template>
  <!-- 选择型：浮出卡片，独立于折叠容器 -->
  <div v-if="interactiveType === 'choice'" class="itc-choice" :class="tc.status">
    <div class="itc-choice-header">
      <span class="itc-choice-icon"><WsIcon name="target" size="s" /></span>
      <span class="itc-choice-title">{{ block?.title || getToolLabel(tc.name) }}</span>
      <span v-if="tc.status === 'running'" class="itc-choice-badge">生成中</span>
      <span v-else-if="choiceSelected" class="itc-choice-badge done">已选择</span>
    </div>
    <div v-if="block && tc.status !== 'running'" class="itc-choice-options">
      <button
        v-for="opt in block.options"
        :key="opt.value"
        class="itc-choice-btn"
        :class="{ active: choiceSelected === opt.value, disabled: !!choiceSelected }"
        @click="onChoiceSelect(opt.value, opt.label)"
      >
        <span class="itc-choice-btn-label">{{ opt.label }}</span>
        <span v-if="opt.description" class="itc-choice-btn-desc">{{ opt.description }}</span>
      </button>
    </div>
    <div v-else-if="tc.status === 'running'" class="itc-choice-loading">
      <span class="itc-loading-dots">
        <span class="itc-loading-dot"></span>
        <span class="itc-loading-dot"></span>
        <span class="itc-loading-dot"></span>
      </span>
      <span class="itc-loading-text">准备选项...</span>
    </div>
  </div>

  <!-- 展示型：工具行 + 内嵌 Block 组件 -->
  <div v-else-if="interactiveType === 'display'" class="itc-display" :class="tc.status">
    <div class="itc-display-header" @click="toggleExpand">
      <span class="itc-display-dot" :class="tc.status"></span>
      <span class="itc-display-name">{{ getToolLabel(tc.name) }}</span>
      <span v-if="tc.status === 'running'" class="itc-display-status running">生成中</span>
      <span v-else-if="tc.status === 'completed'" class="itc-display-status completed">完成</span>
      <span v-else class="itc-display-status failed">失败</span>
      <span v-if="blockSummary" class="itc-display-summary">{{ blockSummary }}</span>
      <span class="itc-display-chevron" :class="{ expanded: isExpanded }">▸</span>
    </div>
    <Transition name="itc-block-expand">
      <div v-if="isExpanded && block && tc.status === 'completed'" class="itc-display-block" @click.stop>
        <BlockTable v-if="block.type === 'table'" :block="block" @action="emit('block-action', $event)" />
        <BlockChoice v-else-if="block.type === 'choice'" :block="block" @action="emit('block-action', $event)" />
        <BlockCode v-else-if="block.type === 'code'" :block="block" @action="emit('block-action', $event)" />
        <BlockEntityCard v-else-if="block.type === 'entity-card'" :block="block" @action="emit('block-action', $event)" />
        <BlockAlert v-else-if="block.type === 'alert'" :block="block" @action="emit('block-action', $event)" />
        <BlockStat v-else-if="block.type === 'stat'" :block="block" @action="emit('block-action', $event)" />
        <BlockList v-else-if="block.type === 'list'" :block="block" @action="emit('block-action', $event)" />
        <BlockProgress v-else-if="block.type === 'progress'" :block="block" @action="emit('block-action', $event)" />
        <BlockComparison v-else-if="block.type === 'comparison'" :block="block" @action="emit('block-action', $event)" />
        <BlockTimeline v-else-if="block.type === 'timeline'" :block="block" @action="emit('block-action', $event)" />
        <BlockImage v-else-if="block.type === 'image'" :block="block" @action="emit('block-action', $event)" />
        <BlockAccordion v-else-if="block.type === 'accordion'" :block="block" @action="emit('block-action', $event)" />
        <BlockManuscript v-else-if="block.type === 'manuscript'" :block="block" @action="emit('block-action', $event)" />
        <div v-else class="itc-display-unknown">
          <pre>{{ formatJson(block) }}</pre>
        </div>
      </div>
    </Transition>
  </div>

  <!-- 等待型：动画指示器 -->
  <div v-else-if="interactiveType === 'waiting'" class="itc-waiting" :class="tc.status">
    <span class="itc-waiting-dot" :class="tc.status"></span>
    <span class="itc-waiting-name">{{ getToolLabel(tc.name) }}</span>
    <template v-if="tc.status === 'running'">
      <span class="itc-waiting-indicator">
        <span class="itc-waiting-ring"></span>
      </span>
      <span class="itc-waiting-text">等待操作...</span>
    </template>
    <template v-else-if="tc.status === 'completed'">
      <span class="itc-waiting-status completed">完成</span>
    </template>
    <template v-else>
      <span class="itc-waiting-status failed">失败</span>
    </template>
    <span v-if="tc.endedAt && tc.startedAt" class="itc-waiting-dur">{{ formatDuration(tc.startedAt, tc.endedAt) }}</span>
  </div>

  <!-- 确认型：内联确认条 -->
  <div v-else-if="interactiveType === 'confirm'" class="itc-confirm" :class="tc.status">
    <div class="itc-confirm-header" @click="toggleExpand">
      <span class="itc-confirm-dot" :class="permissionColor"></span>
      <span class="itc-confirm-name">{{ getToolLabel(tc.name) }}</span>
      <span class="itc-confirm-level" :class="permissionColor">{{ permissionLabel }}</span>
      <span v-if="tc.status === 'running'" class="itc-confirm-status running">等待确认</span>
      <span v-else-if="tc.status === 'completed'" class="itc-confirm-status completed">已执行</span>
      <span v-else class="itc-confirm-status failed">已拒绝</span>
      <span class="itc-confirm-chevron" :class="{ expanded: isExpanded }">▸</span>
    </div>
    <Transition name="itc-confirm-expand">
      <div v-if="isExpanded && tc.status === 'running'" class="itc-confirm-bar" @click.stop>
        <div class="itc-confirm-desc">
          <WsIcon :name="permissionIcon" size="xs" />
          <span>{{ confirmDescription }}</span>
        </div>
        <div class="itc-confirm-actions">
          <button class="itc-confirm-reject" @click="onReject">拒绝</button>
          <button class="itc-confirm-approve" :class="permissionColor" @click="onApprove">确认执行</button>
        </div>
      </div>
    </Transition>
  </div>

  <!-- 普通型：原有工具行（无特殊交互） -->
  <div v-else class="itc-normal" :class="tc.status" @click="toggleExpand">
    <span class="itc-normal-dot" :class="tc.status"></span>
    <span class="itc-normal-name">{{ getToolLabel(tc.name) }}</span>
    <span v-if="tc.status === 'running'" class="itc-normal-status running">执行中</span>
    <span v-else-if="tc.status === 'completed'" class="itc-normal-status completed">完成</span>
    <span v-else class="itc-normal-status failed">失败</span>
    <span v-if="tc.endedAt && tc.startedAt" class="itc-normal-dur">{{ formatDuration(tc.startedAt, tc.endedAt) }}</span>
    <span class="itc-normal-chevron" :class="{ expanded: isExpanded }">▸</span>
    <Transition name="itc-detail">
      <div v-if="isExpanded" class="itc-normal-detail" @click.stop>
        <div v-if="Object.keys(tc.args).length > 0" class="itc-detail-section">
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
import { ref, computed, watch } from 'vue'
import WsIcon from '../../ui/WsIcon.vue'
import BlockTable from './BlockTable.vue'
import BlockChoice from './BlockChoice.vue'
import BlockCode from './BlockCode.vue'
import BlockEntityCard from './BlockEntityCard.vue'
import BlockAlert from './BlockAlert.vue'
import BlockStat from './BlockStat.vue'
import BlockList from './BlockList.vue'
import BlockProgress from './BlockProgress.vue'
import BlockComparison from './BlockComparison.vue'
import BlockTimeline from './BlockTimeline.vue'
import BlockImage from './BlockImage.vue'
import BlockAccordion from './BlockAccordion.vue'
import BlockManuscript from './BlockManuscript.vue'
import type { ToolCallView } from '../composables/useAgent'
import type { BlockActionEvent } from './index'
import { getBlockSummary } from './index'

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

function getToolLabel(name: string): string {
  return TOOL_LABELS[name] || name.replace(/_/g, ' ')
}

const props = defineProps<{
  tc: ToolCallView
}>()

const emit = defineEmits<{
  'block-action': [event: BlockActionEvent]
  'tool-confirm': [event: { toolId: string; approved: boolean }]
}>()

const interactiveType = computed(() => props.tc.interactiveType || 'none')
const isExpanded = ref(
  (interactiveType.value === 'display' && props.tc.status === 'completed') ||
  (interactiveType.value === 'confirm' && props.tc.status === 'running')
)
const choiceSelected = ref<string | null>(null)
const block = computed(() => props.tc.block)

// confirm 类型工具在 running 状态时自动展开，完成后自动折叠
watch(() => props.tc.status, (status) => {
  if (interactiveType.value === 'confirm') {
    if (status === 'running') isExpanded.value = true
    else isExpanded.value = false
  }
})

function toggleExpand() {
  isExpanded.value = !isExpanded.value
}

/** 展示型 Block 摘要 */
const blockSummary = computed(() => {
  if (!block.value) return ''
  return getBlockSummary(block.value)
})

/** 确认型权限颜色 */
const permissionColor = computed(() => {
  if (props.tc.permissionLevel === 'dangerous') return 'danger'
  if (props.tc.permissionLevel === 'moderate') return 'warning'
  return 'safe'
})

const permissionLabel = computed(() => {
  if (props.tc.permissionLevel === 'dangerous') return '高危'
  if (props.tc.permissionLevel === 'moderate') return '需确认'
  return ''
})

const permissionIcon = computed(() => {
  if (props.tc.permissionLevel === 'dangerous') return 'close'
  return 'warning'
})

/** 确认型描述 */
const confirmDescription = computed(() => {
  const name = getToolLabel(props.tc.name)
  const args = props.tc.args
  // 从参数中提取关键信息
  const targetName = args.name || args.entityName || args.title || args.id || args.path || args.url || ''
  if (targetName && typeof targetName === 'string') {
    return `即将执行「${name}」: ${targetName}`
  }
  return `即将执行「${name}」，此操作需要您的确认`
})

function onChoiceSelect(value: string, label: string): void {
  if (choiceSelected.value) return
  choiceSelected.value = value
  emit('block-action', {
    blockId: block.value?.id || props.tc.id,
    action: 'choice_select',
    data: { value, label, mode: 'single' },
  })
}

function onApprove(): void {
  emit('tool-confirm', { toolId: props.tc.id, approved: true })
}

function onReject(): void {
  emit('tool-confirm', { toolId: props.tc.id, approved: false })
}

function formatDuration(start: number, end: number): string {
  const ms = end - start
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}min`
}

function formatJson(obj: unknown): string {
  try { return JSON.stringify(obj, null, 2) } catch { return String(obj) }
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
/* ─── 选择型：浮出卡片 ─── */
.itc-choice {
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--agent-primary) 15%, transparent);
  background: color-mix(in srgb, var(--agent-primary) 3%, transparent);
  overflow: hidden;
  animation: itc-slide-in 0.3s ease-out;
}

.itc-choice-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
}

.itc-choice-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--agent-primary) 12%, transparent);
  color: var(--agent-primary);
  flex-shrink: 0;
}

.itc-choice-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--agent-text);
}

.itc-choice-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--agent-primary) 10%, transparent);
  color: var(--agent-primary);
  animation: itc-badge-pulse 1.5s infinite;
}

.itc-choice-badge.done {
  background: color-mix(in srgb, var(--agent-success, #22c55e) 10%, transparent);
  color: var(--agent-success, #22c55e);
  animation: none;
}

.itc-choice-options {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 14px 12px;
}

.itc-choice-btn {
  padding: 5px 14px;
  border-radius: 16px;
  cursor: pointer;
  border: 1px solid color-mix(in srgb, var(--agent-primary) 25%, transparent);
  background: transparent;
  color: var(--agent-primary);
  font-size: 12px;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
  overflow: hidden;
}

.itc-choice-btn:hover:not(.disabled) {
  background: color-mix(in srgb, var(--agent-primary) 10%, transparent);
  border-color: color-mix(in srgb, var(--agent-primary) 40%, transparent);
}

.itc-choice-btn:active:not(.disabled) {
  transform: scale(0.95);
}

.itc-choice-btn.active {
  background: var(--agent-primary);
  color: #fff;
  border-color: transparent;
  animation: itc-bounce 0.25s ease;
}

.itc-choice-btn.disabled {
  opacity: 0.4;
  cursor: default;
}

.itc-choice-btn-label { }

.itc-choice-btn-desc {
  font-size: 10px;
  opacity: 0.7;
  margin-top: 2px;
}

.itc-choice-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px 12px;
}

.itc-loading-dots {
  display: flex;
  gap: 3px;
}

.itc-loading-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--agent-primary);
  animation: itc-pulse-dot 1.2s ease-in-out infinite;
}

.itc-loading-dot:nth-child(2) { animation-delay: 0.15s; }
.itc-loading-dot:nth-child(3) { animation-delay: 0.3s; }

.itc-loading-text {
  font-size: 11px;
  color: var(--agent-text-tertiary);
  animation: itc-caret-pulse 1.5s ease-in-out infinite;
}

/* ─── 展示型：工具行 + 内嵌 Block ─── */
.itc-display {
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
  overflow: hidden;
  transition: border-color 0.15s, background 0.15s;
}

.itc-display:hover {
  border-color: rgba(255, 255, 255, 0.1);
}

.itc-display-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  cursor: pointer;
  user-select: none;
  font-size: 12px;
}

.itc-display-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--agent-text-tertiary);
}

.itc-display-dot.running {
  background: var(--agent-segment-tooling, #38bdf8);
  animation: itc-pulse 1.5s infinite;
}

.itc-display-dot.completed {
  background: var(--agent-segment-output, #34d399);
}

.itc-display-dot.failed {
  background: var(--agent-danger, #ef4444);
}

.itc-display-name {
  font-weight: 600;
  color: var(--agent-text);
  flex-shrink: 0;
}

.itc-display-status {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 6px;
  flex-shrink: 0;
}

.itc-display-status.running {
  background: color-mix(in srgb, var(--agent-segment-tooling, #38bdf8) 10%, transparent);
  color: var(--agent-segment-tooling, #38bdf8);
}

.itc-display-status.completed {
  background: color-mix(in srgb, var(--agent-segment-output, #34d399) 8%, transparent);
  color: color-mix(in srgb, var(--agent-segment-output, #34d399) 70%, transparent);
}

.itc-display-status.failed {
  background: color-mix(in srgb, var(--agent-danger, #ef4444) 8%, transparent);
  color: color-mix(in srgb, var(--agent-danger, #ef4444) 70%, transparent);
}

.itc-display-summary {
  font-size: 11px;
  color: var(--agent-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.itc-display-chevron {
  margin-left: auto;
  font-size: 10px;
  color: var(--agent-text-tertiary);
  transition: transform 0.2s;
  flex-shrink: 0;
}

.itc-display-chevron.expanded {
  transform: rotate(90deg);
}

.itc-display-block {
  border-top: 1px solid rgba(255, 255, 255, 0.04);
  padding: 8px 10px;
}

.itc-display-unknown {
  font-size: 11px;
  color: var(--agent-text-tertiary);
  padding: 4px;
}

.itc-display-unknown pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
}

/* ─── 等待型：动画指示器 ─── */
.itc-waiting {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
  transition: background 0.15s;
}

.itc-waiting:hover {
  background: rgba(255, 255, 255, 0.03);
}

.itc-waiting-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--agent-text-tertiary);
}

.itc-waiting-dot.running {
  background: var(--agent-warning, #eab308);
  animation: itc-pulse 1.5s infinite;
}

.itc-waiting-dot.completed {
  background: var(--agent-segment-output, #34d399);
}

.itc-waiting-dot.failed {
  background: var(--agent-danger, #ef4444);
}

.itc-waiting-name {
  color: var(--agent-text-secondary);
  flex-shrink: 0;
}

.itc-waiting-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.itc-waiting-ring {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1.5px solid color-mix(in srgb, var(--agent-warning, #eab308) 30%, transparent);
  border-top-color: var(--agent-warning, #eab308);
  animation: itc-spin 1s linear infinite;
}

.itc-waiting-text {
  font-size: 11px;
  color: var(--agent-warning, #eab308);
  animation: itc-caret-pulse 1.5s ease-in-out infinite;
}

.itc-waiting-status {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 6px;
  flex-shrink: 0;
}

.itc-waiting-status.completed {
  background: color-mix(in srgb, var(--agent-segment-output, #34d399) 8%, transparent);
  color: color-mix(in srgb, var(--agent-segment-output, #34d399) 70%, transparent);
}

.itc-waiting-status.failed {
  background: color-mix(in srgb, var(--agent-danger, #ef4444) 8%, transparent);
  color: color-mix(in srgb, var(--agent-danger, #ef4444) 70%, transparent);
}

.itc-waiting-dur {
  font-size: 10px;
  color: var(--agent-text-tertiary);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

/* ─── 确认型：内联确认条 ─── */
.itc-confirm {
  border-radius: 8px;
  overflow: hidden;
  transition: border-color 0.15s;
}

.itc-confirm.running {
  border: 1px solid color-mix(in srgb, var(--agent-warning, #eab308) 15%, transparent);
  background: color-mix(in srgb, var(--agent-warning, #eab308) 2%, transparent);
}

.itc-confirm.completed {
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
}

.itc-confirm.failed {
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
}

.itc-confirm-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  cursor: pointer;
  user-select: none;
  font-size: 12px;
}

.itc-confirm-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
}

.itc-confirm-dot.warning {
  background: var(--agent-warning, #eab308);
  animation: itc-pulse 1.5s infinite;
}

.itc-confirm-dot.danger {
  background: var(--agent-danger, #ef4444);
  animation: itc-pulse 1s infinite;
}

.itc-confirm-dot.safe {
  background: var(--agent-text-tertiary);
}

.itc-confirm-name {
  font-weight: 600;
  color: var(--agent-text);
  flex-shrink: 0;
}

.itc-confirm-level {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
  flex-shrink: 0;
}

.itc-confirm-level.warning {
  background: color-mix(in srgb, var(--agent-warning, #eab308) 10%, transparent);
  color: var(--agent-warning, #eab308);
}

.itc-confirm-level.danger {
  background: color-mix(in srgb, var(--agent-danger, #ef4444) 10%, transparent);
  color: var(--agent-danger, #ef4444);
}

.itc-confirm-status {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 6px;
  flex-shrink: 0;
}

.itc-confirm-status.running {
  background: color-mix(in srgb, var(--agent-warning, #eab308) 10%, transparent);
  color: var(--agent-warning, #eab308);
  animation: itc-caret-pulse 1.5s ease-in-out infinite;
}

.itc-confirm-status.completed {
  background: color-mix(in srgb, var(--agent-segment-output, #34d399) 8%, transparent);
  color: color-mix(in srgb, var(--agent-segment-output, #34d399) 70%, transparent);
}

.itc-confirm-status.failed {
  background: color-mix(in srgb, var(--agent-danger, #ef4444) 8%, transparent);
  color: color-mix(in srgb, var(--agent-danger, #ef4444) 70%, transparent);
}

.itc-confirm-chevron {
  margin-left: auto;
  font-size: 10px;
  color: var(--agent-text-tertiary);
  transition: transform 0.2s;
  flex-shrink: 0;
}

.itc-confirm-chevron.expanded {
  transform: rotate(90deg);
}

.itc-confirm-bar {
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  padding: 8px 10px;
  animation: itc-staircase 0.25s ease-out;
}

.itc-confirm-desc {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--agent-text-secondary);
  margin-bottom: 8px;
}

.itc-confirm-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.itc-confirm-reject {
  padding: 4px 12px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--agent-text-secondary);
  border: 1px solid rgba(255, 255, 255, 0.1);
  cursor: pointer;
  font-size: 12px;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}

.itc-confirm-reject:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--agent-text);
}

.itc-confirm-approve {
  padding: 4px 12px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}

.itc-confirm-approve.warning {
  background: var(--agent-warning, #eab308);
}

.itc-confirm-approve.danger {
  background: var(--agent-danger, #ef4444);
}

.itc-confirm-approve.safe {
  background: var(--agent-primary);
}

.itc-confirm-approve:hover {
  filter: brightness(1.1);
}

/* ─── 普通型 ─── */
.itc-normal {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  flex-wrap: wrap;
  transition: background 0.1s;
}

.itc-normal:hover {
  background: rgba(255, 255, 255, 0.03);
}

.itc-normal-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--agent-text-tertiary);
}

.itc-normal-dot.running {
  background: var(--agent-segment-tooling, #38bdf8);
  animation: itc-pulse 1.5s infinite;
}

.itc-normal-dot.completed {
  background: var(--agent-segment-output, #34d399);
}

.itc-normal-dot.failed {
  background: var(--agent-danger, #ef4444);
}

.itc-normal-name {
  color: var(--agent-text-secondary);
  flex-shrink: 0;
}

.itc-normal-status {
  font-size: 10px;
  flex-shrink: 0;
}

.itc-normal-status.running { color: var(--agent-segment-tooling, #38bdf8); }
.itc-normal-status.completed { color: color-mix(in srgb, var(--agent-segment-output, #34d399) 60%, transparent); }
.itc-normal-status.failed { color: rgba(239, 68, 68, 0.6); }

.itc-normal-dur {
  font-size: 10px;
  color: var(--agent-text-tertiary);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.itc-normal-chevron {
  font-size: 9px;
  color: var(--agent-text-tertiary);
  transition: transform 0.15s;
  flex-shrink: 0;
}

.itc-normal-chevron.expanded {
  transform: rotate(90deg);
}

.itc-normal-detail {
  width: 100%;
  margin-top: 4px;
  padding: 6px 8px;
  background: rgba(0, 0, 0, 0.15);
  border-radius: 6px;
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
  padding: 4px 6px;
  border-radius: 4px;
  overflow-x: auto;
  max-height: 150px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
  font-family: 'Consolas', 'Monaco', monospace;
  background: rgba(0, 0, 0, 0.1);
}

.itc-detail-result {
  max-height: 200px;
}

/* ─── 动画 ─── */
@keyframes itc-slide-in {
  from { opacity: 0; transform: translateX(24px); }
  to { opacity: 1; transform: translateX(0); }
}

@keyframes itc-badge-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

@keyframes itc-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

@keyframes itc-pulse-dot {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.5; }
  40% { transform: scale(1); opacity: 1; }
}

@keyframes itc-caret-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

@keyframes itc-spin {
  to { transform: rotate(360deg); }
}

@keyframes itc-bounce {
  0% { transform: scale(1); }
  50% { transform: scale(1.05); }
  100% { transform: scale(1); }
}

@keyframes itc-staircase {
  from { opacity: 0; transform: translateX(-6px); }
  to { opacity: 1; transform: translateX(0); }
}

.itc-block-expand-enter-active,
.itc-block-expand-leave-active {
  transition: max-height 0.25s ease, opacity 0.2s ease;
  max-height: 600px;
  overflow: hidden;
}

.itc-block-expand-enter-from,
.itc-block-expand-leave-to {
  max-height: 0;
  opacity: 0;
}

.itc-confirm-expand-enter-active,
.itc-confirm-expand-leave-active {
  transition: max-height 0.2s ease, opacity 0.15s ease;
  max-height: 200px;
  overflow: hidden;
}

.itc-confirm-expand-enter-from,
.itc-confirm-expand-leave-to {
  max-height: 0;
  opacity: 0;
}

.itc-detail-enter-active,
.itc-detail-leave-active {
  transition: max-height 0.15s ease, opacity 0.1s ease;
  max-height: 300px;
  overflow: hidden;
}

.itc-detail-enter-from,
.itc-detail-leave-to {
  max-height: 0;
  opacity: 0;
}
</style>
