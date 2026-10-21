<script setup lang="ts">
/**
 * WsScanRadar：R3-L 扫描雷达（36px，仅设置/诊断场景）。
 * 详细 why 见 docs/details/注释/tauri/components/加载反馈.md
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 真实进度 0–100 */
    progress: number
    label?: string
  }>(),
  { label: '正在扫描' },
)

const percent = computed(() => Math.min(100, Math.max(0, Math.round(props.progress))))
const done = computed(() => percent.value >= 100)
const ariaLabel = computed(() => `${props.label} ${percent.value}%`)
</script>

<template>
  <span
    class="ws-scan-radar"
    :class="{ 'is-done': done }"
    role="status"
    :aria-label="ariaLabel"
  >
    <span class="ws-scan-radar__sr">{{ ariaLabel }}</span>
    <span class="ws-scan-radar__ring" aria-hidden="true">
      <span class="ws-scan-radar__dot" :class="{ 'is-found': percent >= 30 }" style="--x: 62%; --y: 38%;"></span>
      <span class="ws-scan-radar__dot" :class="{ 'is-found': percent >= 60 }" style="--x: 38%; --y: 62%;"></span>
      <span class="ws-scan-radar__dot" :class="{ 'is-found': percent >= 90 }" style="--x: 68%; --y: 68%;"></span>
    </span>
  </span>
</template>

<style scoped>
.ws-scan-radar {
  position: relative;
  display: inline-flex;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
}

.ws-scan-radar__ring {
  position: relative;
  width: 100%;
  height: 100%;
  border: 1px dashed var(--loading-track, color-mix(in srgb, var(--accent, #4f46e5) 24%, transparent));
  border-radius: 50%;
  overflow: hidden;
}

.ws-scan-radar__ring::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: conic-gradient(
    from 0deg,
    transparent 0deg,
    transparent 300deg,
    color-mix(in srgb, var(--loading-accent, #4f46e5) 60%, transparent) 360deg
  );
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px));
  animation: ws-scan-radar var(--loading-radar-duration, 2.2s) linear infinite;
}

.ws-scan-radar.is-done .ws-scan-radar__ring::before {
  animation: none;
  opacity: 0;
}

.ws-scan-radar__ring::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 2px;
  height: 2px;
  border-radius: 50%;
  background: var(--loading-accent, var(--accent, #4f46e5));
  transform: translate(-50%, -50%);
}

.ws-scan-radar__dot {
  position: absolute;
  left: var(--x);
  top: var(--y);
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--loading-accent, var(--accent, #4f46e5));
  transform: translate(-50%, -50%) scale(0.4);
  opacity: 0;
  transition: opacity 0.3s var(--ease, cubic-bezier(0.4, 0, 0.2, 1)), transform 0.3s var(--ease, cubic-bezier(0.4, 0, 0.2, 1));
}

.ws-scan-radar__dot.is-found {
  opacity: 1;
  transform: translate(-50%, -50%) scale(1);
}

.ws-scan-radar__sr {
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

@keyframes ws-scan-radar {
  to { transform: rotate(360deg); }
}

:root[data-reduce-motion='on'] .ws-scan-radar__ring::before {
  animation-duration: 4.4s;
}
</style>
