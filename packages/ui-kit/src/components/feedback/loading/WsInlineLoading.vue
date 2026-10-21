<script setup lang="ts">
/**
 * WsInlineLoading：R1 行内加载（星轨/测线）。
 * 详细 why 见 docs/details/注释/tauri/components/加载反馈.md
 */
withDefaults(
  defineProps<{
    size?: 'sm' | 'md' | 'lg'
    variant?: 'orbit' | 'line'
    label?: string
    /** 同一区域重复出现时保持 off，避免读屏刷屏 */
    live?: boolean
  }>(),
  { size: 'md', variant: 'orbit', label: '加载中', live: false },
)
</script>

<template>
  <span
    class="ws-inline-loading"
    :class="[`is-${size}`, `is-${variant}`]"
    role="status"
    :aria-label="label"
    :aria-live="live ? 'polite' : 'off'"
  >
    <span class="ws-inline-loading__sr">{{ label }}</span>

    <span v-if="variant === 'orbit'" class="ws-inline-loading__orbit" aria-hidden="true">
      <span class="ws-inline-loading__track"></span>
      <span class="ws-inline-loading__spinner">
        <span class="ws-inline-loading__star"></span>
      </span>
    </span>

    <span v-else class="ws-inline-loading__line" aria-hidden="true">
      <span class="ws-inline-loading__line-star"></span>
    </span>
  </span>
</template>

<style scoped>
.ws-inline-loading {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  position: relative;
  color: var(--loading-accent, var(--accent, #4f46e5));
}

/* 尺寸档：星头/尾迹随尺寸收放 */
.ws-inline-loading.is-sm { width: var(--loading-size-sm, 14px); height: var(--loading-size-sm, 14px); --_head: 3.5px; --_glow: 4px; --_trail: 12px; }
.ws-inline-loading.is-md { width: var(--loading-size-md, 20px); height: var(--loading-size-md, 20px); --_head: 4.5px; --_glow: 6px; --_trail: 16px; }
.ws-inline-loading.is-lg { width: var(--loading-size-lg, 30px); height: var(--loading-size-lg, 30px); --_head: 5.5px; --_glow: 8px; --_trail: 22px; }

.ws-inline-loading__orbit {
  position: relative;
  width: 100%;
  height: 100%;
}

.ws-inline-loading__track {
  position: absolute;
  inset: 0;
  border: 1px dashed var(--loading-track, color-mix(in srgb, var(--accent, #4f46e5) 24%, transparent));
  border-radius: 50%;
}

.ws-inline-loading__spinner {
  position: absolute;
  inset: 0;
  animation: ws-inline-orbit var(--loading-orbit-duration, 1.15s) linear infinite;
}

.ws-inline-loading__star {
  position: absolute;
  left: 50%;
  top: 0;
  width: var(--_head);
  height: var(--_head);
  border-radius: 50%;
  background: var(--loading-accent, var(--accent, #4f46e5));
  transform: translate(-50%, -50%);
  box-shadow: 0 0 var(--_glow) color-mix(in srgb, var(--loading-accent, #4f46e5) 55%, transparent);
}

.ws-inline-loading__star::before {
  content: '';
  position: absolute;
  right: 2px;
  top: 50%;
  width: var(--_trail);
  height: 1px;
  transform: translateY(-50%) rotate(78deg);
  transform-origin: right center;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--loading-accent, #4f46e5) 55%, transparent));
  pointer-events: none;
}

/* 测线：菜单头/极窄行内 */
.ws-inline-loading.is-line { width: 26px; height: 14px; }
.ws-inline-loading.is-line.is-md { width: 34px; height: 20px; }
.ws-inline-loading.is-line.is-lg { width: 44px; height: 30px; }

.ws-inline-loading__line {
  position: relative;
  width: 100%;
  height: 1px;
  background: repeating-linear-gradient(
    90deg,
    var(--loading-track, color-mix(in srgb, var(--accent, #4f46e5) 24%, transparent)) 0 2px,
    transparent 2px 4px
  );
}

.ws-inline-loading__line-star {
  position: absolute;
  top: 50%;
  width: var(--_head);
  height: var(--_head);
  border-radius: 50%;
  background: var(--loading-accent, var(--accent, #4f46e5));
  transform: translate(-50%, -50%);
  box-shadow: 0 0 var(--_glow) color-mix(in srgb, var(--loading-accent, #4f46e5) 55%, transparent);
  animation: ws-inline-line var(--loading-survey-duration, 2.6s) ease-in-out infinite;
}

.ws-inline-loading__sr {
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

@keyframes ws-inline-orbit {
  to { transform: rotate(360deg); }
}

@keyframes ws-inline-line {
  0% { left: 0; opacity: 0.25; }
  15% { opacity: 1; }
  85% { opacity: 1; }
  100% { left: 100%; opacity: 0.25; }
}

/* 减弱动态：减速而非停止（加载语义不可丢失） */
:root[data-reduce-motion='on'] .ws-inline-loading__spinner {
  animation-duration: 2.4s;
}
:root[data-reduce-motion='on'] .ws-inline-loading__line-star {
  animation-duration: 4.6s;
}
</style>
