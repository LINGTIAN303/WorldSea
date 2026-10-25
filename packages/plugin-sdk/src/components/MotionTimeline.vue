<template>
  <div class="mtl">
    <!-- 时间轴轨道：帧点拖动改 t、双击空白加帧、点击选中；刻度按秒 -->
    <div
      ref="railEl"
      class="mtl-rail"
      :title="`时长 ${track.duration}s · 帧点可拖 · 双击加帧`"
      @dblclick="onRailDblClick"
      @pointerdown.self="onRailBgDown"
    >
      <span
        v-for="s in tickSeconds"
        :key="s"
        class="mtl-tick"
        :style="{ left: `${(s / track.duration) * 100}%` }"
      >{{ s }}s</span>
      <button
        v-for="(k, i) in frames"
        :key="i"
        class="mtl-dot"
        :class="{ selected: i === selectedIdx }"
        :style="{ left: `${(k.t / track.duration) * 100}%` }"
        :aria-label="`关键帧 ${k.t}s`"
        @pointerdown.stop="onDotDown($event, i)"
        @click.stop="selectedIdx = i"
      ></button>
    </div>
    <!-- 选中帧编辑：t 与四值（直接改 track.keyframes；首次编辑把单段转多帧） -->
    <div v-if="selectedFrame" class="mtl-editor">
      <label>t(s)<input v-model.number="selectedFrame.t" type="number" min="0" :max="track.duration" step="0.1" @change="touch" /></label>
      <label>横移<input v-model.number="selectedFrame.dx" type="number" step="1" @change="touch" /></label>
      <label>竖移<input v-model.number="selectedFrame.dy" type="number" step="1" @change="touch" /></label>
      <label>旋转<input v-model.number="selectedFrame.rotate" type="number" step="1" @change="touch" /></label>
      <label>缩放<input v-model.number="selectedFrame.scale" type="number" step="0.1" @change="touch" /></label>
      <button class="mtl-del" aria-label="删除关键帧" @click="removeFrame(selectedIdx)">删帧</button>
    </div>
    <p v-else class="mtl-hint">双击轨道加关键帧（当前 {{ frames.length }} 帧）</p>
  </div>
</template>

<script setup lang="ts">
/**
 * 关键帧时间轴（E 批多关键帧）：横轨=时长刻度，帧点拖动改 t、双击空白加帧、
 * 点击选中后数值编辑/删帧。track 为编辑器草稿引用直接 mutate（同 MotionEditorSide
 * 惯例）；**首次编辑把单段轨迹转多帧**（以单段终值为首帧，t=duration；t=0 恒等隐式），
 * 未触碰的旧数据保持单段（渲染两路等价）。
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import type { MotionTrack, MotionKeyframe } from '@worldsea/entity-core'

const props = defineProps<{ track: MotionTrack }>()
const emit = defineEmits<{ change: [] }>()

const railEl = ref<HTMLElement | null>(null)
const selectedIdx = ref<number | null>(null)
const MIN_GAP = 0.05

/** 帧视图：未初始化 keyframes 时以单段终值合成一帧（显示用，touch 时落盘初始化） */
const frames = computed<MotionKeyframe[]>(() =>
  props.track.keyframes ?? [{ t: props.track.duration, dx: props.track.dx, dy: props.track.dy, rotate: props.track.rotate, scale: props.track.scale }],
)
const selectedFrame = computed(() => (selectedIdx.value !== null ? frames.value[selectedIdx.value] ?? null : null))
const tickSeconds = computed(() => {
  const n = Math.min(8, Math.max(2, Math.round(props.track.duration)))
  const step = props.track.duration / n
  return Array.from({ length: n + 1 }, (_, i) => Math.round(i * step * 10) / 10)
})

const touch = () => emit('change')

/** 单段 → 多帧初始化（保留单段终值为末帧） */
function ensureKeyframes() {
  if (!props.track.keyframes) {
    props.track.keyframes = frames.value.map(k => ({ ...k }))
  }
}

function clampedT(t: number, skipIdx?: number): number {
  const dur = props.track.duration
  const c = Math.max(0, Math.min(dur, t))
  // 与相邻帧保持最小间隔（防过密抖动，见计划风险 2）
  for (let i = 0; i < frames.value.length; i++) {
    if (i === skipIdx) continue
    if (Math.abs(frames.value[i].t - c) < MIN_GAP) return frames.value[i].t <= c ? frames.value[i].t + MIN_GAP : frames.value[i].t - MIN_GAP
  }
  return Math.max(0, Math.min(dur, c))
}

// ── 帧点拖动 ──
let dragIdx: number | null = null
function onDotDown(e: PointerEvent, i: number) {
  selectedIdx.value = i
  ensureKeyframes()
  dragIdx = i
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  const el = e.currentTarget as HTMLElement
  const onMove = (ev: PointerEvent) => {
    if (dragIdx === null) return
    const rect = railEl.value!.getBoundingClientRect()
    const ratio = (ev.clientX - rect.left) / rect.width
    const kf = props.track.keyframes![dragIdx]
    kf.t = Math.round(clampedT(ratio * props.track.duration, dragIdx) * 100) / 100
    touch()
  }
  const onUp = () => {
    dragIdx = null
    el.removeEventListener('pointermove', onMove)
    el.removeEventListener('pointerup', onUp)
  }
  el.addEventListener('pointermove', onMove)
  el.addEventListener('pointerup', onUp)
}
function onRailBgDown() {
  selectedIdx.value = null
}

// ── 双击加帧 ──
function onRailDblClick(e: MouseEvent) {
  const rect = railEl.value!.getBoundingClientRect()
  const t = Math.round(clampedT(((e.clientX - rect.left) / rect.width) * props.track.duration) * 100) / 100
  ensureKeyframes()
  const kfs = props.track.keyframes!
  kfs.push({ t })
  kfs.sort((a, b) => a.t - b.t)
  selectedIdx.value = kfs.findIndex(k => k.t === t)
  touch()
}

function removeFrame(i: number | null) {
  if (i === null || !props.track.keyframes) return
  props.track.keyframes.splice(i, 1)
  selectedIdx.value = null
  touch()
}

onBeforeUnmount(() => { dragIdx = null })
</script>

<style scoped>
.mtl { display: flex; flex-direction: column; gap: 4px; width: 100%; }
.mtl-rail {
  position: relative;
  height: 30px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-secondary, #f3f4f6);
  cursor: crosshair;
  touch-action: none;
  user-select: none;
}
.mtl-tick {
  position: absolute;
  top: 1px;
  transform: translateX(-50%);
  font-size: 9px;
  color: var(--text-tertiary);
  pointer-events: none;
  line-height: 1;
}
.mtl-rail::after { /* 刻度基线 */
  content: '';
  position: absolute;
  left: 4px;
  right: 4px;
  top: 18px;
  height: 1px;
  background: var(--border-color);
  pointer-events: none;
}
.mtl-dot {
  position: absolute;
  top: 14px;
  width: 10px;
  height: 10px;
  transform: translate(-50%, -50%);
  border: 1.5px solid #fff;
  border-radius: 50%;
  background: var(--primary);
  cursor: grab;
  padding: 0;
}
.mtl-dot.selected { box-shadow: 0 0 0 2px var(--primary); }
.mtl-editor { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.mtl-editor label {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 10px;
  color: var(--text-tertiary);
}
.mtl-editor input {
  width: 46px;
  padding: 2px 4px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  background: var(--input-bg);
  color: var(--text-color);
}
.mtl-del {
  border: none;
  background: none;
  color: var(--danger, #dc2626);
  font-size: var(--font-size-xs);
  cursor: pointer;
  padding: 0 2px;
}
.mtl-hint { margin: 0; font-size: 10px; color: var(--text-tertiary); }
</style>
