<script setup lang="ts">
/**
 * TuiButton：统一按钮（消除各视图按钮样式分叉）。2026-10-01 自 apps/tauri 下沉至 ui-kit，使 plugin-sdk
 * 也能消费，作为全仓唯一按钮组件。变体 primary/secondary/ghost/danger/danger-ghost，尺寸 sm/md，可选
 * icon 前缀，统一反馈与按压回弹，`active` 为切换态高亮。详细 why 见 docs/details/注释/tauri/components/TuiButton.md
 */
import { computed } from 'vue'
import WsIcon from './WsIcon.vue'

const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost'
    size?: 'sm' | 'md'
    icon?: string
    disabled?: boolean
    type?: 'button' | 'submit'
    title?: string
    loading?: boolean
    active?: boolean
  }>(),
  { variant: 'secondary', size: 'md', icon: '', disabled: false, type: 'button', title: '', loading: false, active: false },
)

const emit = defineEmits<{
  (e: 'click', ev: MouseEvent): void
}>()

const cls = computed(() => [`is-${props.variant}`, `is-${props.size}`, { 'is-loading': props.loading, 'is-active': props.active }])
</script>

<template>
  <button
    :type="type"
    class="tui-btn"
    :class="cls"
    :disabled="disabled || loading"
    :title="title"
    :aria-pressed="active || undefined"
    @click="emit('click', $event)"
  >
    <WsIcon v-if="loading" name="dots" :size="size === 'sm' ? 12 : 14" class="tui-btn__spin" :stroke-width="1.7" />
    <WsIcon v-else-if="icon" :name="icon" :size="size === 'sm' ? 13 : 15" :stroke-width="1.7" />
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
  padding: 0 var(--spacing-btn-sm-x, 10px);
  font-size: var(--fs-sm);
}
.tui-btn.is-md {
  height: 34px;
  padding: 0 var(--spacing-btn-x, 14px);
}
.tui-btn:active:not(:disabled) {
  transform: scale(var(--press-scale));
}
.tui-btn:disabled {
  opacity: var(--disabled-opacity);
  cursor: not-allowed;
}
/* loading 态：忙碌而非禁用——不降透明度、progress 光标，spinner 已传达进行中 */
.tui-btn.is-loading:disabled {
  opacity: 1;
  cursor: progress;
}
.tui-btn__spin {
  animation: tui-btn-spin 1s linear infinite;
}
.tui-btn__label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
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
/* 切换类按钮的当前态：accent 描边 + 浅底（2026-10-01 批量态/视图模式切换共用） */
.tui-btn.is-active {
  border-color: var(--accent);
  background: var(--accent-soft, color-mix(in srgb, var(--accent) 12%, transparent));
  color: var(--accent);
}
/* 减弱动态偏好：去掉按压位移，保留颜色过渡（Emil 可访问性规则） */
:root[data-anim-overlays='off'] .tui-btn {
  transition: background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}
:root[data-anim-overlays='off'] .tui-btn:active:not(:disabled) {
  transform: none;
}
</style>
