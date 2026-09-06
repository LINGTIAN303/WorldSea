<template>
  <button
    class="create-btn"
    :class="{ 'create-btn-sm': size === 'small' }"
    :disabled="disabled"
    :title="label"
    data-ws-tip-keys="N"
    @click="$emit('click')"
  >
    <WsIcon name="plus" :size="14" :stroke-width="2" class="create-btn-icon" />
    <span class="create-btn-text">{{ label }}</span>
  </button>
</template>

<script setup lang="ts">
import { WsIcon } from '@worldsmith/ui-kit'

defineProps<{
  label?: string
  disabled?: boolean
  size?: 'default' | 'small'
}>()

defineEmits<{
  click: []
}>()
</script>

<style scoped>
.create-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 16px;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  font-family: inherit;
  color: #fff;
  background: var(--gradient-accent, var(--primary));
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  /* 只过渡视觉属性，避免位置/尺寸变化被动画化导致布局抖动 */
  transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast), filter var(--transition-fast);
  position: relative;
  overflow: hidden;
  white-space: nowrap;
  letter-spacing: 0.02em;
}

.create-btn::before {
  content: '';
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0);
  transition: background var(--transition-fast);
}

.create-btn:hover:not(:disabled) {
  box-shadow: var(--shadow-glow);
  transform: translateY(-1px);
}

.create-btn:hover:not(:disabled)::before {
  background: rgba(255, 255, 255, 0.08);
}

.create-btn:active:not(:disabled) {
  transform: translateY(0);
  filter: brightness(0.95);
}

.create-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  filter: grayscale(0.4);
}

.create-btn-sm {
  padding: 5px 12px;
  font-size: var(--font-size-sm);
  gap: 4px;
}

.create-btn-sm .create-btn-icon {
  width: 12px;
  height: 12px;
}

.create-btn-icon {
  flex-shrink: 0;
  opacity: 0.9;
}

.create-btn-text {
  line-height: 1;
}
</style>
