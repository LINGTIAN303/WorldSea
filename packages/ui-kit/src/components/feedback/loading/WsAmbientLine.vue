<script setup lang="ts">
/**
 * WsAmbientLine：R4 背景态顶部测线（非阻断，仅 >1s 的后台任务）。
 * 详细 why 见 docs/details/注释/tauri/components/加载反馈.md
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    active: boolean
    label?: string
    /** 真实进度 0–100；缺省为不确定态 */
    progress?: number
  }>(),
  { label: '后台处理中' },
)

const determinate = computed(() => typeof props.progress === 'number' && Number.isFinite(props.progress))
const percent = computed(() => Math.min(100, Math.max(0, Math.round(props.progress ?? 0))))
</script>

<template>
  <div v-if="active" class="ws-ambient" role="status" aria-live="off" :aria-label="label">
    <span class="ws-ambient__sr">{{ label }}</span>
    <span class="ws-ambient__track" aria-hidden="true">
      <template v-if="determinate">
        <span class="ws-ambient__fill" :style="{ width: `${percent}%` }"></span>
        <span class="ws-ambient__star" :style="{ left: `${percent}%` }"></span>
      </template>
      <span v-else class="ws-ambient__runner">
        <span class="ws-ambient__fill"></span>
        <span class="ws-ambient__star"></span>
      </span>
    </span>
  </div>
</template>

<style scoped>
.ws-ambient {
  width: 100%;
  height: 1px;
  position: relative;
  pointer-events: none;
}

.ws-ambient__track {
  position: relative;
  display: block;
  width: 100%;
  height: 1px;
  background: var(--loading-track, color-mix(in srgb, var(--accent, #4f46e5) 24%, transparent));
}

.ws-ambient__fill {
  position: absolute;
  left: 0;
  top: 0;
  height: 1px;
  width: 0;
  background: var(--loading-accent, var(--accent, #4f46e5));
  transition: width 0.3s var(--ease, cubic-bezier(0.4, 0, 0.2, 1));
}

.ws-ambient__star {
  position: absolute;
  top: 50%;
  width: 4.5px;
  height: 4.5px;
  border-radius: 50%;
  background: var(--loading-accent, var(--accent, #4f46e5));
  transform: translate(-50%, -50%);
  box-shadow: 0 0 7px color-mix(in srgb, var(--loading-accent, #4f46e5) 55%, transparent);
  transition: left 0.3s var(--ease, cubic-bezier(0.4, 0, 0.2, 1));
}

/* 不确定态：26% 的光段 + 星点从左向右循环 */
.ws-ambient__runner {
  position: absolute;
  top: 0;
  left: 0;
  width: 26%;
  height: 1px;
  animation: ws-ambient-run var(--loading-survey-duration, 2.6s) ease-in-out infinite;
}

.ws-ambient__runner .ws-ambient__fill {
  width: 100%;
}

.ws-ambient__runner .ws-ambient__star {
  left: 100%;
}

.ws-ambient__sr {
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

@keyframes ws-ambient-run {
  0% { left: -30%; opacity: 0; }
  12% { opacity: 1; }
  88% { opacity: 1; }
  100% { left: 104%; opacity: 0; }
}

:root[data-reduce-motion='on'] .ws-ambient__runner {
  animation: none;
  left: 0;
  opacity: 0.8;
}
</style>
