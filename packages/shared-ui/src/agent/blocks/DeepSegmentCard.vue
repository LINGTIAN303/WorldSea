<template>
  <div class="deep-seg-card" :class="[segment.type, segment.status || '']" :data-seg-id="segment.id">
    <!-- 推理段 -->
    <template v-if="segment.type === 'thinking'">
      <div class="seg-header" role="button" tabindex="0" :aria-expanded="isExpanded" @click="toggleExpand" @keydown.enter.prevent="toggleExpand" @keydown.space.prevent="toggleExpand">
        <span class="seg-icon thinking-icon"><WsIcon name="brain" size="s" /></span>
        <span class="seg-title">推理过程</span>
        <span v-if="segment.status === 'streaming'" class="seg-badge streaming">思考中</span>
        <span class="seg-chevron" :class="{ expanded: isExpanded }">▸</span>
      </div>
      <Transition name="seg-expand">
        <div v-if="isExpanded" class="seg-body thinking-body">
          <div class="thinking-text">{{ segment.thinking }}</div>
        </div>
      </Transition>
    </template>

    <!-- 阶段容器段 -->
    <template v-else-if="segment.type === 'phase'">
      <div class="seg-header phase-header" role="button" tabindex="0" :aria-expanded="isExpanded" @click="toggleExpand" @keydown.enter.prevent="toggleExpand" @keydown.space.prevent="toggleExpand">
        <div class="phase-marker">
          <span v-if="segment.status === 'done'" class="phase-check"><WsIcon name="check" size="xs" /></span>
          <span v-else-if="segment.status === 'active'" class="phase-pulse"></span>
          <span v-else class="phase-num">{{ segment.index + 1 }}</span>
        </div>
        <span class="seg-title">{{ segment.label }}</span>
        <span class="seg-badge count">{{ completedCount }}/{{ segment.tools.length }}</span>
        <div class="phase-bar-track">
          <div class="phase-bar-fill" :class="{ pulsing: segment.status === 'active' }" :style="{ width: phaseProgress + '%' }"></div>
        </div>
        <span class="seg-chevron" :class="{ expanded: isExpanded }">▸</span>
      </div>
      <Transition name="seg-expand">
        <div v-if="isExpanded" class="seg-body phase-body">
          <!-- 非选择型工具：内嵌在阶段容器内 -->
          <InteractiveToolCall
            v-for="tc in nonChoiceTools"
            :key="tc.id"
            :tc="tc"
            @block-action="emit('block-action', $event)"
            @tool-confirm="emit('tool-confirm', $event)"
          />
          <!-- 中间输出 -->
          <div v-for="po in segment.outputs" :key="po.id" class="phase-output">
            <div class="phase-output-header">
              <span class="phase-output-icon"><WsIcon name="message-text" size="xs" /></span>
              <span class="phase-output-label">输出</span>
              <span v-if="po.status === 'streaming'" class="phase-output-badge">生成中</span>
            </div>
            <div class="phase-output-content" v-html="renderMarkdown(po.content)"></div>
          </div>
        </div>
      </Transition>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import InteractiveToolCall from './InteractiveToolCall.vue'
import type { DeepSegment } from '@worldsmith/shared-composables/agent/useAgent'
import type { BlockActionEvent } from './index'

const props = defineProps<{
  segment: DeepSegment
}>()

const emit = defineEmits<{
  'block-action': [event: BlockActionEvent]
  'tool-confirm': [event: { toolId: string; approved: boolean }]
}>()

// 阶段容器默认折叠，推理段默认展开
// 但如果阶段内有等待确认的工具，自动展开
const hasPendingConfirm = computed(() =>
  props.segment.type === 'phase' &&
  props.segment.tools.some(tc => tc.interactiveType === 'confirm' && tc.status === 'running')
)
const isExpanded = ref(props.segment.type === 'thinking' || hasPendingConfirm.value)

// 当出现新的待确认工具时自动展开
watch(hasPendingConfirm, (pending) => {
  if (pending) isExpanded.value = true
})

function toggleExpand() {
  isExpanded.value = !isExpanded.value
}

/** 阶段容器：已完成工具数 */
const completedCount = computed(() => {
  if (props.segment.type !== 'phase') return 0
  return props.segment.tools.filter(tc => tc.status === 'completed' || tc.status === 'failed').length
})

const phaseProgress = computed(() => {
  if (props.segment.type !== 'phase' || props.segment.tools.length === 0) return 0
  return (completedCount.value / props.segment.tools.length) * 100
})

/** 阶段内嵌工具（选择型由 AgentMessageList 独立渲染，此处排除） */
const nonChoiceTools = computed(() => {
  if (props.segment.type !== 'phase') return []
  return props.segment.tools.filter(tc => tc.interactiveType !== 'choice')
})

function renderMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
}
</script>

<style scoped>
.deep-seg-card {
  border-radius: 10px;
  border: 1px solid var(--agent-border);
  background: color-mix(in srgb, var(--bg-surface) 2%, transparent);
  overflow: hidden;
  transition: border-color 0.2s, background 0.2s;
  animation: seg-in 0.3s ease-out;
}

.deep-seg-card:hover {
  border-color: var(--agent-border-strong);
}

/* 推理段 */
.deep-seg-card.thinking {
  border-color: color-mix(in srgb, var(--agent-segment-thinking, #a78bfa) 12%, transparent);
  background: color-mix(in srgb, var(--agent-segment-thinking, #a78bfa) 2%, transparent);
}

.deep-seg-card.thinking.streaming {
  border-color: color-mix(in srgb, var(--agent-segment-thinking, #a78bfa) 20%, transparent);
}

/* 阶段容器段 */
.deep-seg-card.phase {
  border-color: color-mix(in srgb, var(--agent-segment-tooling, #38bdf8) 12%, transparent);
  background: color-mix(in srgb, var(--agent-segment-tooling, #38bdf8) 2%, transparent);
}

.deep-seg-card.phase.active {
  border-color: color-mix(in srgb, var(--agent-segment-tooling, #38bdf8) 20%, transparent);
}

.deep-seg-card.phase.done {
  border-color: color-mix(in srgb, var(--agent-segment-output, #34d399) 10%, transparent);
}

/* 段头 */
.seg-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
}

.seg-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  flex-shrink: 0;
}

.thinking-icon {
  background: color-mix(in srgb, var(--agent-segment-thinking, #a78bfa) 10%, transparent);
  color: var(--agent-segment-thinking, #a78bfa);
}

.seg-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--agent-text);
  flex-shrink: 0;
}

.seg-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 6px;
  flex-shrink: 0;
}

.seg-badge.streaming {
  background: color-mix(in srgb, var(--agent-segment-thinking, #a78bfa) 10%, transparent);
  color: var(--agent-segment-thinking, #a78bfa);
  animation: badge-pulse 1.5s infinite;
}

.seg-badge.count {
  background: color-mix(in srgb, var(--bg-surface) 5%, transparent);
  color: var(--agent-text-tertiary);
  font-variant-numeric: tabular-nums;
}

.seg-chevron {
  margin-left: auto;
  font-size: 10px;
  color: var(--agent-text-tertiary);
  transition: transform 0.2s;
  flex-shrink: 0;
}

.seg-chevron.expanded {
  transform: rotate(90deg);
}

/* 段体 */
.seg-body {
  border-top: 1px solid rgba(255, 255, 255, 0.04);
  padding: 8px 12px;
}

.thinking-text {
  font-size: 12px;
  line-height: 1.6;
  color: var(--agent-text-secondary);
  white-space: pre-wrap;
  max-height: 300px;
  overflow-y: auto;
}

/* 阶段头特殊样式 */
.phase-header {
  gap: 6px;
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
  background: color-mix(in srgb, var(--bg-surface) 6%, transparent);
  border: 1.5px solid var(--agent-border-strong);
  color: var(--agent-text-tertiary);
}

.done .phase-marker {
  background: color-mix(in srgb, var(--agent-segment-output, #34d399) 15%, transparent);
  border-color: color-mix(in srgb, var(--agent-segment-output, #34d399) 40%, transparent);
  color: var(--agent-segment-output, #34d399);
}

.active .phase-marker {
  background: color-mix(in srgb, var(--agent-segment-tooling, #38bdf8) 15%, transparent);
  border-color: color-mix(in srgb, var(--agent-segment-tooling, #38bdf8) 50%, transparent);
  color: var(--agent-segment-tooling, #38bdf8);
}

.phase-check {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--agent-segment-output, #34d399);
}

.phase-pulse {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--agent-segment-tooling, #38bdf8);
  animation: ph-pulse 1.5s infinite;
}

.phase-num {
  font-size: 9px;
}

.phase-bar-track {
  flex: 1;
  height: 3px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--bg-surface) 6%, transparent);
  overflow: hidden;
  min-width: 30px;
}

.phase-bar-fill {
  height: 100%;
  border-radius: 2px;
  background: var(--agent-segment-tooling, #38bdf8);
  transition: width 0.4s ease;
}

.done .phase-bar-fill {
  background: var(--agent-segment-output, #34d399);
}

.phase-bar-fill.pulsing {
  animation: bar-pulse 1.8s ease-in-out infinite;
}

/* 阶段展开体 */
.phase-body {
  padding: 4px 12px 8px 40px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* 中间输出 */
.phase-output {
  margin-top: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--agent-segment-output, #34d399) 3%, transparent);
  border: 1px solid color-mix(in srgb, var(--agent-segment-output, #34d399) 8%, transparent);
}

.phase-output-header {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 4px;
}

.phase-output-icon {
  color: var(--agent-segment-output, #34d399);
  display: flex;
  align-items: center;
}

.phase-output-label {
  font-size: 10px;
  font-weight: 600;
  color: color-mix(in srgb, var(--agent-segment-output, #34d399) 70%, transparent);
}

.phase-output-badge {
  font-size: 9px;
  padding: 0 4px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--agent-segment-output, #34d399) 10%, transparent);
  color: var(--agent-segment-output, #34d399);
  animation: badge-pulse 1.5s infinite;
}

.phase-output-content {
  font-size: 12px;
  line-height: 1.6;
  color: var(--agent-text);
}

.phase-output-content :deep(code) {
  background: color-mix(in srgb, var(--bg-surface) 6%, transparent);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 11px;
}

/* 展开动画 */
.seg-expand-enter-active,
.seg-expand-leave-active {
  transition: max-height 0.2s ease, opacity 0.15s ease;
  max-height: 500px;
  overflow: hidden;
}

.seg-expand-enter-from,
.seg-expand-leave-to {
  max-height: 0;
  opacity: 0;
}

@keyframes seg-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes badge-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

@keyframes ph-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

@keyframes bar-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}
</style>
