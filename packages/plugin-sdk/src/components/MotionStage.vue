<template>
  <div class="mstage">
    <!-- 底图（静态显示；区域层叠加其上）。onload 读原始尺寸算 letterbox 补偿（D4） -->
    <img ref="baseImg" :src="src" class="mstage-base" :alt="alt" @load="onBaseLoad" />
    <!-- 区域层：同图同 contain 布局保证像素对齐，clip-path 经显示区换算裁出区域，WAAPI 驱动变换 -->
    <img
      v-for="layer in layers"
      :key="layer.track.id"
      ref="layerEls"
      :src="src"
      class="mstage-layer"
      :style="{ clipPath: regionToClip(layer.region, displayBox) }"
      alt=""
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 区域运动执行器（2026-10-25 形象图批 D3/D4，需求 #8/#20）：同一图源叠 N 层，每层
 * clip-path 裁出所配区域（什么时候动=trigger / 向哪动=dx dy rotate / 动多少=数值），
 * WAAPI 驱动 transform。loop 轨自动播；hover/click 由外部调 playTrigger；
 * **mouse 轨（#20 内容追踪）**：监听全局鼠标位置，区域层朝指针方向连续偏移
 * （dx/dy=跟随幅度上限），rAF + lerp 平滑——兔眼视线追踪指针的实现。
 * 区域百分比统一相对图面显示区（不含 letterbox），经 computeDisplayBox 换算到层盒
 * ——编辑器画布（D4）与各渲染容器比例不同仍像素对齐。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { MotionConfig, MotionRegion, MotionTrack } from '@worldsea/entity-core'
import { regionToClip, computeDisplayBox, trackToKeyframes, type DisplayBox } from '@worldsea/entity-core/core'

const props = defineProps<{
  src: string
  motion: MotionConfig
  alt?: string
}>()

const layerEls = ref<HTMLElement[]>([])
const baseImg = ref<HTMLImageElement | null>(null)
const displayBox = ref<DisplayBox>({ oX: 0, oY: 0, dW: 100, dH: 100 })

function onBaseLoad(e: Event) {
  const img = e.target as HTMLImageElement
  const host = baseImg.value?.parentElement
  displayBox.value = computeDisplayBox(img.naturalWidth, img.naturalHeight, host?.clientWidth ?? 0, host?.clientHeight ?? 0)
}

/** 层定义：track 关联的 region（region 缺失的 track 不渲染） */
const layers = computed(() =>
  props.motion.tracks
    .map((track) => ({ track, region: props.motion.regions.find((r) => r.id === track.regionId) }))
    .filter((l): l is { track: MotionTrack; region: MotionRegion } => Boolean(l.region)),
)

/** WAAPI 关键帧：trackToKeyframes 统一换算（E 批起单段/多关键帧同路径） */
function keyframesOf(track: MotionTrack) {
  return trackToKeyframes(track).map(k => ({ offset: k.offset, transform: k.transform }))
}

const running = new Map<string, Animation>()

/** 按 trigger 启动对应轨迹（loop 在挂载/配置变化时自动跑） */
function start(trigger: 'loop' | 'hover' | 'click') {
  for (const [i, layer] of layers.value.entries()) {
    if (layer.track.trigger !== trigger) continue
    const el = layerEls.value[i]
    // jsdom 无 WAAPI（测试环境容错；真机浏览器恒有）
    if (!el || typeof el.animate !== 'function') continue
    running.get(layer.track.id)?.cancel()
    const anim = el.animate(keyframesOf(layer.track), {
      duration: Math.max(0.1, layer.track.duration) * 1000,
      delay: 0,
      iterations: layer.track.loop ? Infinity : 1,
      direction: layer.track.alternate ? 'alternate' : 'normal',
      fill: 'both',
    })
    running.set(layer.track.id, anim)
  }
}

/** 外部触发入口（hover/click；PortraitRenderer 路由） */
function playTrigger(trigger: 'hover' | 'click') {
  start(trigger)
}

function restartAll() {
  for (const a of running.values()) a.cancel()
  running.clear()
  start('loop')
}

// ── mouse 驱动（#20 内容追踪）：全局鼠标位置 → 轨迹层朝指针连续偏移 ──
const mousePos = { x: 0.5, y: 0.5 } // 视口归一化（0-1）
let mouseRaf = 0
const followed = new Map<string, { x: number; y: number }>() // 各层当前偏移（lerp 状态）

const hasMouseTracks = computed(() => props.motion.tracks.some((t) => t.trigger === 'mouse'))

function onGlobalMouse(e: MouseEvent) {
  mousePos.x = e.clientX / (window.innerWidth || 1)
  mousePos.y = e.clientY / (window.innerHeight || 1)
  scheduleFollow()
}
function scheduleFollow() {
  if (mouseRaf || !hasMouseTracks.value) return
  mouseRaf = requestAnimationFrame(followStep)
}

function followStep() {
  mouseRaf = 0
  if (!hasMouseTracks.value) return
  for (const [i, layer] of layers.value.entries()) {
    if (layer.track.trigger !== 'mouse') continue
    const el = layerEls.value[i]
    if (!el) continue
    // 目标偏移：指针相对视口中心的归一化方向 × 幅度上限（区域尺寸百分比）
    const tx = (mousePos.x - 0.5) * 2 * (layer.track.dx ?? 0)
    const ty = (mousePos.y - 0.5) * 2 * (layer.track.dy ?? 0)
    const cur = followed.get(layer.track.id) ?? { x: 0, y: 0 }
    // lerp 平滑（0.12/帧 ≈ 200ms 收敛）
    cur.x += (tx - cur.x) * 0.12
    cur.y += (ty - cur.y) * 0.12
    followed.set(layer.track.id, cur)
    el.style.transform = `translate(${cur.x}%, ${cur.y}%)`
  }
  scheduleFollow()
}

window.addEventListener('mousemove', onGlobalMouse, { passive: true })

onMounted(restartAll)
watch(() => props.motion, restartAll, { deep: true })
onBeforeUnmount(() => {
  for (const a of running.values()) a.cancel()
  running.clear()
  window.removeEventListener('mousemove', onGlobalMouse)
  cancelAnimationFrame(mouseRaf)
})

defineExpose({ playTrigger })
</script>

<style scoped>
.mstage {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.mstage-base,
.mstage-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
}
</style>
