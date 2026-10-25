<template>
  <Teleport to="body">
    <div class="echp" :class="{ 'echp-frameless': frameless }" :style="boxStyle" @mouseenter="$emit('enter')" @mouseleave="$emit('leave')">
    <PortraitRenderer :src="src" :kind="kind" :actions="actions" :motion="motion" />
  </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 实体卡片悬停预览浮层（需求 #1/#4/#13）：卡片 hover 时 Teleport 到 body 的 fixed 浮层，
 * 装载形象图。默认有框（细描边+阴影）；无框为设置项（hoverPreviewFrameless）。
 * 透明背景：容器不铺底色——透明形象图（png/webp/模型）直接透出页面底色（需求 #4）。
 * 定位：锚定卡片右侧，视口越界翻转（左/上/下），由调用方传卡片元素。
 */
import { computed } from 'vue'
import type { PortraitKind, MotionConfig } from '@worldsea/entity-core'
import PortraitRenderer from './PortraitRenderer.vue'

const props = defineProps<{
  anchor: HTMLElement
  src: string
  kind: PortraitKind
  frameless?: boolean
  /** 模型动作绑定（悬停触发用 hover 项；D2） */
  actions?: { hover?: string | 'random'; click?: string | 'random' }
  /** 区域运动编排（D3） */
  motion?: MotionConfig
}>()

defineEmits<{ enter: []; leave: [] }>()

const W = 280
const GAP = 12
const VW = typeof window !== 'undefined' ? window.innerWidth : 1280
const VH = typeof window !== 'undefined' ? window.innerHeight : 800

const boxStyle = computed(() => {
  const r = props.anchor.getBoundingClientRect()
  let left = r.right + GAP
  if (left + W > VW - GAP) left = Math.max(GAP, r.left - W - GAP) // 右侧放不下翻左侧
  // 垂直：对齐卡片上缘，下溢则上提
  let top = r.top
  const maxH = VH * 0.6
  if (top + maxH > VH - GAP) top = Math.max(GAP, VH - GAP - maxH)
  return { left: `${Math.round(left)}px`, top: `${Math.round(top)}px`, width: `${W}px`, maxHeight: `${Math.round(maxH)}px` }
})
</script>

<style scoped>
.echp {
  position: fixed;
  z-index: 2100; /* 弹层层级之上（--z-popover 族），悬停预览独立层 */
  padding: 8px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: transparent; /* 透明背景：不铺底（需求 #4），有框模式仅描边+阴影 */
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  pointer-events: none; /* 不挡卡片交互；浮层自身无需鼠标（跟踪交互属 D1） */
  overflow: hidden;
  /* 内容高度兜底：img 自带高度，但 MotionStage/div 类内容是 height:100%——
     无最小高度会被压成 0 高（D4 走查：带 motion 的静态图预览"消失"实为零高） */
  min-height: 160px;
  aspect-ratio: 7 / 9;
  box-sizing: border-box;
}
.echp-frameless {
  border-color: transparent;
  box-shadow: none;
  padding: 0;
}
</style>
