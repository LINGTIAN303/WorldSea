<template>
  <Teleport to="body">
    <div
      ref="boxEl"
      class="efollower"
      :class="{ 'ef-follow': follow, 'ef-dragging': dragging }"
      :style="boxStyle"
      @pointerdown="onPointerDown"
    >
      <div class="ef-stage" :title="follow ? '' : '点击形象图播放'" @click.stop="onPlay">
        <PortraitRenderer ref="rendererEl" :src="entity.portrait!" :kind="entity.portraitKind || 'static'" :autoplay="true" :actions="entity.portraitMeta?.model" :motion="entity.portraitMeta?.motion" />
      </div>
      <!-- Lottie 微型控制条（F4）：仅 lottie 形象显示 -->
      <div v-if="entity.portraitKind === 'lottie'" class="ef-controls">
        <button
          class="ef-play"
          :aria-label="lottiePaused ? '播放' : '暂停'"
          :title="lottiePaused ? '播放' : '暂停'"
          @click.stop="toggleLottie"
        >
          <WsIcon :name="lottiePaused ? 'play' : 'pause'" size="xs" />
        </button>
      </div>
      <span class="ef-name">{{ entity.name }}</span>
      <button class="ef-close" aria-label="关闭形象浮层" @click.stop="$emit('close')">×</button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 追踪鼠标的形象图浮层（2026-10-25 形象图批 D1，需求 #10/#11/#12）：点击实体（详情打开）后
 * 置顶显示其形象图。跟踪开关（settings.portraitFollowMouse，默认关）：
 * - 开：mousemove 跟随鼠标（rAF 节流 + transform，不触发重排）；
 * - 关：固定屏幕左下角（「放在一边」，避开右侧详情面板），可拖动到任意位置。
 * 点击浮层形象触发 PortraitRenderer.play()（#12：模型随机/指定动作、动图/Lottie 重头播、静态 no-op）。
 * 生命周期绑定详情（selectedEntity 置空即卸载），Esc / 关闭按钮即时退出。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useSettingsStore, type Entity } from '@worldsea/entity-core'
import { WsIcon } from '@worldsea/ui-kit'
import PortraitRenderer from './PortraitRenderer.vue'

const props = defineProps<{ entity: Entity }>()
const emit = defineEmits<{ close: [] }>()

const settings = useSettingsStore()
const rendererEl = ref<InstanceType<typeof PortraitRenderer> | null>(null)

const follow = computed(() => settings.portraitFollowMouse)

// ── 跟随鼠标：rAF 节流（mousemove 高频，transform 直写）──
const pos = ref({ x: 24, y: 0 }) // 非跟踪默认左下（y 由 CSS bottom 定位，拖动后转 top）
const tracking = { x: 0, y: 0, raf: 0 }

function onMouseMove(e: MouseEvent) {
  if (!follow.value) return
  tracking.x = e.clientX + 18
  tracking.y = e.clientY + 18
  if (!tracking.raf) {
    tracking.raf = requestAnimationFrame(() => {
      tracking.raf = 0
      pos.value = { x: clamp(tracking.x, 0, innerWidth - 140), y: clamp(tracking.y, 0, innerHeight - 140) }
    })
  }
}
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

// ── 非跟踪：拖动换位（pointerdown 捕获差值移动）──
const dragging = ref(false)
let dragBase = { px: 0, py: 0, x: 0, y: 0 }
const boxEl = ref<HTMLElement | null>(null)

function onPointerDown(e: PointerEvent) {
  if (follow.value || (e.target as HTMLElement).closest('.ef-close, .ef-stage, .ef-controls')) return // 跟踪态/点播放区/控制条不拖
  dragging.value = true
  dragBase = { px: e.clientX, py: e.clientY, x: pos.value.x, y: pos.value.y }
  boxEl.value?.setPointerCapture(e.pointerId)
}
function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return
  dragged.value = true // 拖过即脱离左下角锚定，转 top/left 定位
  pos.value = {
    x: clamp(dragBase.x + e.clientX - dragBase.px, 0, innerWidth - 120),
    y: clamp(dragBase.y + e.clientY - dragBase.py, 0, innerHeight - 120),
  }
}
function onPointerUp() {
  dragging.value = false
}

/** 非跟踪且未被拖过 → 用 CSS 左下锚（y:0 哨兵）；否则 top/left 定位 */
const dragged = ref(false)
const boxStyle = computed(() => {
  if (follow.value || dragged.value) {
    return { left: `${pos.value.x}px`, top: `${pos.value.y}px`, bottom: 'auto' }
  }
  return {}
})

function onPlay() {
  rendererEl.value?.play('click')
  lottiePaused.value = false // 点形象播放时同步控制条状态
}

/** Lottie 暂停/恢复（F4）：按钮状态与渲染器实例同步 */
const lottiePaused = ref(false)
function toggleLottie() {
  if (lottiePaused.value) {
    rendererEl.value?.resume()
    lottiePaused.value = false
  } else {
    rendererEl.value?.pause()
    lottiePaused.value = true
  }
}

// 切换实体（浮层复用）时控制条复位到播放态
watch(() => props.entity.id, () => { lottiePaused.value = false })
function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => {
  window.addEventListener('mousemove', onMouseMove, { passive: true })
  window.addEventListener('pointermove', onPointerMove, { passive: true })
  window.addEventListener('pointerup', onPointerUp, { passive: true })
  window.addEventListener('keydown', onEsc)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(tracking.raf)
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('keydown', onEsc)
})
</script>

<style scoped>
.efollower {
  position: fixed;
  left: 24px;
  bottom: 24px;
  z-index: 2200; /* 悬停预览(2100)之上，弹层族之下不参与 */
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: transparent; /* 透明背景（形象图透明区透出页面） */
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  width: 180px;
  touch-action: none;
  user-select: none;
}
.ef-follow { cursor: default; }
.ef-dragging { cursor: grabbing; border-color: var(--primary); }
.ef-stage {
  width: 100%;
  height: 180px;
  border-radius: var(--radius-sm);
  overflow: hidden;
  cursor: pointer;
  background:
    conic-gradient(var(--border-color, #d1d5db) 0 25%, transparent 0 50%) 0 0 / 16px 16px,
    conic-gradient(var(--border-color, #d1d5db) 0 25%, transparent 0 50%) 8px 8px / 16px 16px;
}
.ef-name {
  font-size: var(--font-size-xs, 12px);
  color: var(--text-secondary);
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ef-controls {
  position: absolute;
  top: 4px;
  left: 4px;
  display: flex;
  gap: 4px;
}
.ef-play {
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.4);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ef-play:hover { background: rgba(0, 0, 0, 0.6); }
.ef-close {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.35);
  color: #fff;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ef-close:hover { background: rgba(0, 0, 0, 0.55); }
</style>
