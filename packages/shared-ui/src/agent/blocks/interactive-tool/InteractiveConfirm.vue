<template>
  <!-- 确认型：内联确认条 -->
  <div class="itc-confirm" :class="tc.status">
    <div class="itc-confirm-header" role="button" tabindex="0" :aria-expanded="isExpanded" @click="toggleExpand" @keydown.enter.prevent="toggleExpand" @keydown.space.prevent="toggleExpand">
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
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import type { ToolCallView } from '@worldsmith/shared-composables/agent/useAgent'
import { getToolLabel } from './utils'

const props = defineProps<{
  tc: ToolCallView
}>()

const emit = defineEmits<{
  'tool-confirm': [event: { toolId: string; approved: boolean }]
}>()

/** 折叠状态：running 时默认展开 */
const isExpanded = ref(props.tc.status === 'running')

function toggleExpand() {
  isExpanded.value = !isExpanded.value
}

// confirm 类型工具在 running 状态时自动展开，完成后自动折叠
watch(() => props.tc.status, (status) => {
  if (status === 'running') isExpanded.value = true
  else isExpanded.value = false
})

/** 确认型权限颜色：dangerous→danger, moderate→warning, 其他→safe */
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

/** 确认型描述：从参数中提取目标名 */
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

function onApprove(): void {
  emit('tool-confirm', { toolId: props.tc.id, approved: true })
}

function onReject(): void {
  emit('tool-confirm', { toolId: props.tc.id, approved: false })
}
</script>

<style scoped>
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
  border: 1px solid var(--agent-border);
  background: color-mix(in srgb, var(--bg-surface) 2%, transparent);
}

.itc-confirm.failed {
  border: 1px solid var(--agent-border);
  background: color-mix(in srgb, var(--bg-surface) 2%, transparent);
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
  border-top: 1px solid var(--agent-border);
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
  background: var(--bg-muted);
  color: var(--agent-text-secondary);
  border: 1px solid var(--border-strong);
  cursor: pointer;
  font-size: 12px;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}

.itc-confirm-reject:hover {
  background: var(--bg-active);
  color: var(--agent-text);
}

.itc-confirm-approve {
  padding: 4px 12px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  color: var(--on-accent);
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

/* ─── 确认型动画 ─── */
@keyframes itc-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

@keyframes itc-caret-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

@keyframes itc-staircase {
  from { opacity: 0; transform: translateX(-6px); }
  to { opacity: 1; transform: translateX(0); }
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
</style>
