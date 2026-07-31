<template>
  <!-- 选择型：浮出卡片，独立于折叠容器 -->
  <div class="itc-choice" :class="tc.status">
    <div class="itc-choice-header">
      <span class="itc-choice-icon"><WsIcon name="target" size="s" /></span>
      <span class="itc-choice-title">{{ choiceBlock?.title || getToolLabel(tc.name) }}</span>
      <span v-if="tc.status === 'running'" class="itc-choice-badge">生成中</span>
      <span v-else-if="choiceSelected" class="itc-choice-badge done">已选择</span>
    </div>
    <div v-if="choiceBlock && tc.status !== 'running'" class="itc-choice-options">
      <button
        v-for="opt in choiceBlock.options"
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
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import WsIcon from '../../../ui/WsIcon.vue'
import type { ToolCallView } from '../../composables/useAgent'
import type { ChoiceBlock } from '@agent/index'
import type { BlockActionEvent } from '../index'
import { getToolLabel } from './utils'

const props = defineProps<{
  tc: ToolCallView
}>()

const emit = defineEmits<{
  'block-action': [event: BlockActionEvent]
}>()

/** 已选中的选项 value（单选模式下首个选中后锁定） */
const choiceSelected = ref<string | null>(null)

/** 选择型工具的 ChoiceBlock（类型收窄，模板中安全访问 title/options） */
const choiceBlock = computed<ChoiceBlock | null>(() => {
  if (props.tc.block?.type === 'choice') return props.tc.block as ChoiceBlock
  return null
})

function onChoiceSelect(value: string, label: string): void {
  if (choiceSelected.value) return
  choiceSelected.value = value
  emit('block-action', {
    blockId: props.tc.block?.id || props.tc.id,
    action: 'choice_select',
    data: { value, label, mode: 'single' },
  })
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

/* ─── 选择型动画 ─── */
@keyframes itc-slide-in {
  from { opacity: 0; transform: translateX(24px); }
  to { opacity: 1; transform: translateX(0); }
}

@keyframes itc-badge-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

@keyframes itc-pulse-dot {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.5; }
  40% { transform: scale(1); opacity: 1; }
}

@keyframes itc-caret-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

@keyframes itc-bounce {
  0% { transform: scale(1); }
  50% { transform: scale(1.05); }
  100% { transform: scale(1); }
}
</style>
