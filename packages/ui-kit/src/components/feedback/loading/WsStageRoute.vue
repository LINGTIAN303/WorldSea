<script setup lang="ts">
/**
 * WsStageRoute：R3 B 弧形航线视觉（4 节点上限；阶段式进度）。
 * 详细 why 见 docs/details/注释/tauri/components/加载反馈.md
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { LoadingStage, LoadingStatus } from './types'

const props = withDefaults(
  defineProps<{
    stages: LoadingStage[]
    current: number
    status?: LoadingStatus
    /** 只有真实可测的连续进度才传；缺省用阶段位置 */
    progress?: number
  }>(),
  { status: 'loading' },
)

const PATH_D = 'M18 64 C 96 12, 224 12, 302 64'
const VIEW_W = 320
const VIEW_H = 72

const pathEl = ref<SVGPathElement | null>(null)
const totalLength = ref(0)
const fillOffset = ref(0)
const positions = ref<Array<{ left: string; top: string }>>([])
const starPos = ref({ left: '0%', top: '50%' })

const isDone = computed(() => props.status === 'success')
const isError = computed(() => props.status === 'error')
const ratio = computed(() => {
  const maxIndex = Math.max(1, props.stages.length - 1)
  if (isDone.value) return 1
  if (typeof props.progress === 'number' && Number.isFinite(props.progress)) {
    return Math.min(1, Math.max(0, props.progress))
  }
  return Math.min(1, Math.max(0, props.current / maxIndex))
})

function layout(): void {
  const el = pathEl.value
  if (!el || typeof el.getTotalLength !== 'function') return
  const total = el.getTotalLength()
  if (!Number.isFinite(total) || total <= 0) return
  totalLength.value = total
  const maxIndex = Math.max(1, props.stages.length - 1)
  positions.value = props.stages.map((_, i) => {
    const point = el.getPointAtLength(total * (i / maxIndex))
    return {
      left: `${(point.x / VIEW_W) * 100}%`,
      top: `${(point.y / VIEW_H) * 100}%`,
    }
  })
  const star = el.getPointAtLength(total * ratio.value)
  starPos.value = {
    left: `${(star.x / VIEW_W) * 100}%`,
    top: `${(star.y / VIEW_H) * 100}%`,
  }
  fillOffset.value = total * (1 - ratio.value)
}

onMounted(() => nextTick(layout))
watch(
  () => [props.stages.length, props.current, props.status, props.progress],
  () => nextTick(layout),
)

function nodeClass(index: number): Record<string, boolean> {
  return {
    'is-done': isDone.value || index < props.current,
    'is-active': !isDone.value && index === props.current,
    'is-error': isError.value && index === props.current,
  }
}

function labelClass(index: number): Record<string, boolean> {
  return {
    'is-done': isDone.value || index < props.current,
    'is-active': !isDone.value && index === props.current,
    'is-error': isError.value && index === props.current,
  }
}
</script>

<template>
  <div class="ws-stage-route" aria-hidden="true">
    <div class="ws-stage-route__canvas">
      <svg :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`" preserveAspectRatio="none">
        <path ref="pathEl" class="ws-stage-route__track" :d="PATH_D" />
        <path
          class="ws-stage-route__fill"
          :d="PATH_D"
          :style="{ strokeDasharray: `${totalLength}`, strokeDashoffset: `${fillOffset}` }"
        />
      </svg>
      <span
        v-for="(pos, i) in positions"
        :key="i"
        class="ws-stage-route__node"
        :class="nodeClass(i)"
        :style="{ left: pos.left, top: pos.top }"
      />
      <span
        class="ws-stage-route__star"
        :class="{ 'is-done': isDone, 'is-error': isError }"
        :style="starPos"
      />
    </div>

    <div
      class="ws-stage-route__labels"
      :style="{ gridTemplateColumns: `repeat(${stages.length}, 1fr)` }"
    >
      <span
        v-for="(stage, i) in stages"
        :key="i"
        class="ws-stage-route__label"
        :class="labelClass(i)"
      >{{ stage.short }}</span>
    </div>
  </div>
</template>

<style scoped>
.ws-stage-route { width: 100%; }

.ws-stage-route__canvas {
  position: relative;
  width: 100%;
  aspect-ratio: 320 / 72;
  margin-top: 10px;
}

.ws-stage-route__canvas svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.ws-stage-route__track {
  fill: none;
  stroke: var(--loading-track, color-mix(in srgb, var(--accent, #4f46e5) 24%, transparent));
  stroke-width: 1.2;
  stroke-linecap: round;
  stroke-dasharray: 2 4;
}

.ws-stage-route__fill {
  fill: none;
  stroke: var(--loading-accent, var(--accent, #4f46e5));
  stroke-width: 1.6;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.6s var(--ease, cubic-bezier(0.4, 0, 0.2, 1));
}

.ws-stage-route__node {
  position: absolute;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--bg-surface, #ffffff);
  border: 1.5px solid var(--border-strong, #d9d9de);
  transform: translate(-50%, -50%);
  transition:
    width var(--dur-base, 0.22s) var(--ease, cubic-bezier(0.4, 0, 0.2, 1)),
    height var(--dur-base, 0.22s) var(--ease, cubic-bezier(0.4, 0, 0.2, 1)),
    background var(--dur-base, 0.22s) var(--ease, cubic-bezier(0.4, 0, 0.2, 1)),
    border-color var(--dur-base, 0.22s) var(--ease, cubic-bezier(0.4, 0, 0.2, 1));
}

.ws-stage-route__node.is-active {
  width: 11px;
  height: 11px;
  border-color: var(--loading-accent, var(--accent, #4f46e5));
  background: var(--loading-accent, var(--accent, #4f46e5));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--loading-accent, #4f46e5) 16%, transparent);
}

.ws-stage-route__node.is-done {
  background: var(--loading-accent, var(--accent, #4f46e5));
  border-color: var(--loading-accent, var(--accent, #4f46e5));
}

.ws-stage-route__node.is-error {
  border-color: var(--warning, #d97706);
  background: var(--warning, #d97706);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--warning, #d97706) 16%, transparent);
}

.ws-stage-route__star {
  position: absolute;
  width: 4.5px;
  height: 4.5px;
  border-radius: 50%;
  background: var(--loading-accent, var(--accent, #4f46e5));
  transform: translate(-50%, -50%);
  box-shadow:
    0 0 0 2px var(--bg-surface, #ffffff),
    0 0 7px color-mix(in srgb, var(--loading-accent, #4f46e5) 55%, transparent);
  transition:
    left 0.6s var(--ease, cubic-bezier(0.4, 0, 0.2, 1)),
    top 0.6s var(--ease, cubic-bezier(0.4, 0, 0.2, 1)),
    background var(--dur-base, 0.22s) var(--ease, cubic-bezier(0.4, 0, 0.2, 1)),
    opacity var(--dur-base, 0.22s) var(--ease, cubic-bezier(0.4, 0, 0.2, 1)),
    scale var(--dur-base, 0.22s) var(--ease, cubic-bezier(0.4, 0, 0.2, 1));
  z-index: 3;
}

.ws-stage-route__star::before {
  content: '';
  position: absolute;
  right: 2px;
  top: 50%;
  width: 26px;
  height: 1px;
  transform: translateY(-50%) rotate(78deg);
  transform-origin: right center;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--loading-accent, #4f46e5) 55%, transparent));
  pointer-events: none;
}

.ws-stage-route__star.is-done {
  opacity: 0;
  scale: 2.6;
}

.ws-stage-route__star.is-error {
  background: var(--warning, #d97706);
}

.ws-stage-route__star.is-error::before {
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--warning, #d97706) 55%, transparent));
}

.ws-stage-route__labels {
  display: grid;
  gap: 4px;
  margin-top: 2px;
}

.ws-stage-route__label {
  position: relative;
  padding-top: 8px;
  text-align: center;
  font-size: 11px;
  line-height: 1.25;
  color: var(--loading-label, var(--text-secondary, #6b7280));
  transition: color var(--dur-base, 0.22s);
}

.ws-stage-route__label::before {
  content: '';
  position: absolute;
  top: 0;
  left: 50%;
  width: 1px;
  height: 5px;
  background: var(--loading-track, color-mix(in srgb, var(--accent, #4f46e5) 24%, transparent));
  transform: translateX(-50%);
}

.ws-stage-route__label.is-active {
  color: var(--loading-accent, var(--accent, #4f46e5));
  font-weight: 600;
}

.ws-stage-route__label.is-active::before {
  background: var(--loading-accent, var(--accent, #4f46e5));
}

.ws-stage-route__label.is-done::before {
  content: '✓';
  top: -1px;
  width: auto;
  height: auto;
  background: none;
  color: var(--loading-accent, var(--accent, #4f46e5));
  font-size: 9px;
}

.ws-stage-route__label.is-error {
  color: var(--warning, #d97706);
}

.ws-stage-route__label.is-error::before {
  background: var(--warning, #d97706);
}

/* 减弱动态：节点/星点跳转，不补间 */
:root[data-reduce-motion='on'] .ws-stage-route__fill,
:root[data-reduce-motion='on'] .ws-stage-route__node,
:root[data-reduce-motion='on'] .ws-stage-route__star,
:root[data-reduce-motion='on'] .ws-stage-route__label {
  transition-duration: 0.01ms;
}
</style>
