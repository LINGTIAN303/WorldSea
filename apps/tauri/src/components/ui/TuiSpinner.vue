<script setup lang="ts">
/**
 * TuiSpinner：Tauri 端统一加载指示器（替代 ui-kit 遗留 WsSpinner）
 * 尺寸：sm / md / lg；语义：忙碌而非禁用，故不降透明度。
 * 与 TuiButton 内 loading 转圈一致：环形旋转 + 主题色（--accent），
 * 详细why请见 docs/details/注释/tauri/components/TuiSpinner.md
 */
withDefaults(
  defineProps<{
    size?: 'sm' | 'md' | 'lg'
    /** 无障碍标签 */
    label?: string
  }>(),
  { size: 'md', label: '加载中' },
)
</script>

<template>
  <span
    :class="['tui-spinner', `is-${size}`]"
    role="status"
    :aria-label="label"
  >
    <span class="tui-spinner__sr">{{ label }}</span>
  </span>
</template>

<style scoped>
.tui-spinner {
  display: inline-block;
  border-radius: 50%;
  border: 2px solid var(--border-strong);
  border-top-color: var(--accent);
  animation: tui-spinner-rotate 0.7s linear infinite;
  flex-shrink: 0;
}
.tui-spinner.is-sm { width: 14px; height: 14px; border-width: 2px; }
.tui-spinner.is-md { width: 20px; height: 20px; border-width: 2px; }
.tui-spinner.is-lg { width: 30px; height: 30px; border-width: 3px; }

.tui-spinner__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}

@keyframes tui-spinner-rotate {
  to { transform: rotate(360deg); }
}

/* 减弱动态偏好：减速而非停止（加载语义不可丢失） */
@media (prefers-reduced-motion: reduce) {
  .tui-spinner {
    animation-duration: 1.6s;
  }
}
</style>
