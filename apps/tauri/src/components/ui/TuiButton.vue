<script setup lang="ts">
/**
 * TuiButton：Tauri 端统一按钮（消除各视图按钮样式分叉）
 *
 * 变体：primary（主操作）/ secondary（次操作/描边）/ ghost（弱操作）/ danger（危险）
 * 尺寸：sm / md；可选 icon 前缀；统一 hover/active/disabled 反馈与按压回弹。
 * 详细why请见 docs/details/注释/tauri/components/TuiButton.md
 */
import { computed } from 'vue'
import TuiIcon from './TuiIcon.vue'

const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost'
    size?: 'sm' | 'md'
    icon?: string
    disabled?: boolean
    type?: 'button' | 'submit'
    title?: string
    loading?: boolean
  }>(),
  { variant: 'secondary', size: 'md', icon: '', disabled: false, type: 'button', title: '', loading: false },
)

const emit = defineEmits<{
  (e: 'click', ev: MouseEvent): void
}>()

const cls = computed(() => [`is-${props.variant}`, `is-${props.size}`, { 'is-loading': props.loading }])
</script>

<template>
  <button
    :type="type"
    class="tui-btn"
    :class="cls"
    :disabled="disabled || loading"
    :title="title"
    @click="emit('click', $event)"
  >
    <TuiIcon v-if="loading" name="dots" :size="size === 'sm' ? 12 : 14" class="tui-btn__spin" />
    <TuiIcon v-else-if="icon" :name="icon" :size="size === 'sm' ? 13 : 15" />
    <span v-if="$slots.default" class="tui-btn__label"><slot /></span>
  </button>
</template>

<style scoped>
.tui-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: var(--radius-sm);
  font-size: var(--fs-md);
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease-spring);
  font-family: inherit;
}
.tui-btn.is-sm {
  height: 28px;
  padding: 0 10px;
  font-size: var(--fs-sm);
}
.tui-btn.is-md {
  height: 34px;
  padding: 0 14px;
}
.tui-btn:active:not(:disabled) {
  transform: scale(var(--press-scale));
}
.tui-btn:disabled {
  opacity: var(--disabled-opacity);
  cursor: not-allowed;
}
/* loading 态：忙碌而非禁用——不降透明度、progress 光标，spinner 已传达进行中（批次89 8.3 语义修正） */
.tui-btn.is-loading:disabled {
  opacity: 1;
  cursor: progress;
}
.tui-btn__spin {
  animation: tui-btn-spin 1s linear infinite;
}
@keyframes tui-btn-spin {
  to { transform: rotate(360deg); }
}

/* 变体 */
.tui-btn.is-primary {
  background: var(--accent);
  color: var(--on-accent);
  border: 1px solid transparent;
}
.tui-btn.is-primary:hover:not(:disabled) {
  background: var(--accent-hover);
}
.tui-btn.is-secondary {
  background: var(--bg-surface);
  color: var(--text-secondary);
  border: 1px solid var(--border-strong);
}
.tui-btn.is-secondary:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}
.tui-btn.is-ghost {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid transparent;
}
.tui-btn.is-ghost:hover:not(:disabled) {
  background: var(--bg-muted);
  color: var(--text-primary);
}
.tui-btn.is-danger {
  background: var(--danger);
  color: var(--on-accent);
  border: 1px solid transparent;
}
.tui-btn.is-danger:hover:not(:disabled) {
  background: var(--danger-hover);
}
.tui-btn.is-danger-ghost {
  background: transparent;
  color: var(--danger);
  border: 1px solid var(--danger-soft);
}
.tui-btn.is-danger-ghost:hover:not(:disabled) {
  background: var(--danger);
  border-color: var(--danger);
  color: var(--on-accent);
}
</style>
