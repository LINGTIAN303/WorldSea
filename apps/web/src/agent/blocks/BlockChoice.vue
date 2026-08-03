<template>
  <div class="block-choice">
    <div v-if="block.title" class="choice-title">{{ block.title }}</div>
    <div class="choice-options">
      <button
        v-for="opt in block.options"
        :key="opt.value"
        :class="['choice-btn', { active: isSelected(opt.value) }]"
        @click="onSelect(opt.value)"
      >
        <span class="choice-label">{{ opt.label }}</span>
        <span v-if="opt.description" class="choice-desc">{{ opt.description }}</span>
      </button>
    </div>
    <button
      v-if="block.mode === 'multi' && selectedValues.length > 0"
      class="choice-confirm"
      @click="onConfirm"
    >确认选择 ({{ selectedValues.length }})</button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { ChoiceBlock } from '@agent/index'
import type { BlockActionEvent } from './index'

const props = defineProps<{
  block: ChoiceBlock
}>()

const emit = defineEmits<{
  action: [event: BlockActionEvent]
}>()

const selectedValues = ref<string[]>([])

function isSelected(value: string): boolean {
  return selectedValues.value.includes(value)
}

function onSelect(value: string): void {
  if (props.block.mode === 'single') {
    selectedValues.value = [value]
    const opt = props.block.options.find(o => o.value === value)
    emit('action', {
      blockId: props.block.id,
      action: 'choice_select',
      data: { value, label: opt?.label || value, mode: 'single' },
    })
  } else {
    const idx = selectedValues.value.indexOf(value)
    if (idx === -1) {
      selectedValues.value = [...selectedValues.value, value]
    } else {
      selectedValues.value = selectedValues.value.filter(v => v !== value)
    }
  }
}

function onConfirm(): void {
  const labels = selectedValues.value.map(v => {
    const opt = props.block.options.find(o => o.value === v)
    return opt?.label || v
  })
  emit('action', {
    blockId: props.block.id,
    action: 'choice_select',
    data: { values: selectedValues.value, labels, mode: 'multi' },
  })
}
</script>

<style scoped>
.block-choice {
  padding: 10px 12px; border-radius: 8px; margin: 4px 0;
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);
  border-left: 3px solid var(--agent-primary, #6c5ce7);
}
.choice-title { font-size: 12px; color: var(--agent-text-secondary, #888); margin-bottom: 8px; }
.choice-options { display: flex; flex-wrap: wrap; gap: 6px; }
.choice-btn {
  padding: 4px 10px; border-radius: 14px; cursor: pointer;
  border: 1px solid rgba(108,92,231,0.3); background: transparent;
  color: var(--agent-accent, #b388ff); font-size: 12px;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; display: flex; flex-direction: column; align-items: center;
  position: relative; overflow: hidden;
}
.choice-btn:active { transform: scale(0.95); }
.choice-btn:hover { background: rgba(108,92,231,0.1); border-color: rgba(108,92,231,0.5); }
.choice-btn.active { background: var(--agent-accent, #b388ff); color: #fff; border-color: transparent; animation: ws-bounce 0.2s ease; }

.choice-label { }
.choice-desc { font-size: 10px; opacity: 0.7; margin-top: 2px; }
.choice-confirm {
  margin-top: 8px; padding: 4px 12px; border-radius: 6px;
  background: var(--agent-accent, #b388ff); color: #fff; border: none;
  font-size: 12px; cursor: pointer;
}
</style>
