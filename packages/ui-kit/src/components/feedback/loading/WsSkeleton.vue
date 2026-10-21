<script setup lang="ts">
/**
 * WsSkeleton：R2 测线骨架（card / row / text / image）。
 * 详细 why 见 docs/details/注释/tauri/components/加载反馈.md
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    variant?: 'card' | 'row' | 'text' | 'image'
    lines?: number
    aspect?: string
    label?: string
  }>(),
  { variant: 'text', lines: 3, aspect: '16 / 9', label: '正在加载' },
)

const lineCount = computed(() => Math.max(1, Math.min(8, props.lines)))
</script>

<template>
  <div
    class="ws-skeleton"
    :class="`is-${variant}`"
    role="status"
    aria-busy="true"
    :aria-label="label"
  >
    <span class="ws-skeleton__sr">{{ label }}</span>
    <div class="ws-skeleton__body" aria-hidden="true">
      <template v-if="variant === 'card'">
        <div class="ws-skeleton__thumb"></div>
        <div class="ws-skeleton__line is-wide"></div>
        <div class="ws-skeleton__line is-mid"></div>
      </template>

      <template v-else-if="variant === 'row'">
        <div class="ws-skeleton__avatar"></div>
        <div class="ws-skeleton__lines">
          <div
            v-for="n in lineCount"
            :key="n"
            class="ws-skeleton__line"
            :class="{ 'is-wide': n === 1, 'is-mid': n === lineCount && lineCount > 1 }"
          ></div>
        </div>
      </template>

      <template v-else-if="variant === 'image'">
        <div class="ws-skeleton__image" :style="{ aspectRatio: aspect }"></div>
      </template>

      <template v-else>
        <div
          v-for="n in lineCount"
          :key="n"
          class="ws-skeleton__line"
          :class="{ 'is-wide': n === 1, 'is-mid': n === lineCount && lineCount > 1 }"
        ></div>
      </template>
    </div>
    <span class="ws-skeleton__survey" aria-hidden="true"></span>
  </div>
</template>

<style scoped>
.ws-skeleton {
  position: relative;
  overflow: hidden;
  min-width: 0;
}

.ws-skeleton.is-card {
  padding: 12px;
  border: 1px solid var(--border, #ececec);
  border-radius: var(--radius-md, 10px);
  background: var(--bg-surface, #ffffff);
}

.ws-skeleton__body { display: flex; flex-direction: column; gap: 8px; min-width: 0; }

.ws-skeleton.is-row .ws-skeleton__body { flex-direction: row; align-items: center; gap: 10px; }
.ws-skeleton.is-row .ws-skeleton__lines { flex: 1; display: flex; flex-direction: column; gap: 7px; min-width: 0; }

.ws-skeleton__thumb,
.ws-skeleton__image,
.ws-skeleton__avatar,
.ws-skeleton__line {
  background: var(--loading-skeleton-base, var(--bg-muted, #f4f4f5));
}

.ws-skeleton__thumb {
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: var(--radius-sm, 6px);
  margin-bottom: 10px;
}

.ws-skeleton__image {
  width: 100%;
  border-radius: var(--radius-md, 10px);
}

.ws-skeleton__avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  flex-shrink: 0;
}

.ws-skeleton__line {
  height: 9px;
  border-radius: var(--radius-pill, 999px);
  width: 100%;
}
.ws-skeleton__line.is-wide { width: 88%; }
.ws-skeleton__line.is-mid { width: 62%; }

/* 测线：一条 1px 光丝缓慢扫过；不做呼吸/缩放 */
.ws-skeleton__survey {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -8%;
  width: 1px;
  background: linear-gradient(
    180deg,
    transparent,
    color-mix(in srgb, var(--loading-accent, #4f46e5) 55%, transparent),
    transparent
  );
  animation: ws-skeleton-survey var(--loading-survey-duration, 2.6s) ease-in-out infinite;
  pointer-events: none;
}

.ws-skeleton__sr {
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

@keyframes ws-skeleton-survey {
  0% { left: -8%; opacity: 0; }
  12% { opacity: 1; }
  88% { opacity: 1; }
  100% { left: 108%; opacity: 0; }
}

/* 减弱动态：测线静止，占位块保留 */
:root[data-reduce-motion='on'] .ws-skeleton__survey {
  animation: none;
  opacity: 0;
}
</style>
