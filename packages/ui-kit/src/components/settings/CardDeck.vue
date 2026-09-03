<template>
  <div class="card-deck" :class="{ 'card-deck--flat': props.flat }" @wheel="onWheelHandler" aria-label="设置卡片区">
    <template v-for="i in props.count" :key="i">
      <slot name="card" :idx="i - 1" :cls="props.flat ? '' : (deckCardClass(i - 1) + ' ' + (cardAnim[i - 1] ?? ''))" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { useCardDeck } from '../../composables/useCardDeck'

const props = withDefaults(defineProps<{ count: number; flat?: boolean }>(), { count: 1, flat: false })
const emit = defineEmits<{ change: [index: number] }>()

const { cardAnim, deckCardClass, goToCard, onDeckWheel } = useCardDeck(props.count, (i) => emit('change', i))

/** 平铺模式（搜索）不响应滚轮翻卡，仅叠放模式响应 */
function onWheelHandler(e: WheelEvent): void {
  if (!props.flat) onDeckWheel(e)
}

defineExpose({ goToCard })
</script>

<style>
/* ── 叠放翻卡共享样式（从 Agent 主设置抽取，2026-08-23 推广到全部分类面板）──
   上条（上一张·窄居中）[0,peek] + 主卡（全宽最高）[peek, H-peek] + 下条（下一张·窄居中）[H-peek, H]；
   位移交 top/height 过渡负责，rotateX 翻转增强立体感 */
.card-deck {
  --deck-peek: 16px;
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  perspective: 900px;
}
.deck-card {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  opacity: 1;
  transition: top 0.4s cubic-bezier(0.22, 0.8, 0.36, 1), height 0.4s cubic-bezier(0.22, 0.8, 0.36, 1), left 0.4s cubic-bezier(0.22, 0.8, 0.36, 1), right 0.4s cubic-bezier(0.22, 0.8, 0.36, 1), opacity 0.3s ease, box-shadow 0.3s ease;
}
/* 主卡：全宽居中最高，最亮最前，内容超高时卡片内部滚动。
   阴影用内阴影（inset）：不向下外投，避免在下条（窄于主卡）左右两侧露出「直角阴影」 */
.deck-card--mid {
  left: 0;
  right: 0;
  top: var(--deck-peek);
  height: calc(100% - 2 * var(--deck-peek));
  z-index: 1;
  overflow-y: auto;
  opacity: 1;
  box-shadow: inset 0 1px 5px rgba(0, 0, 0, 0.05), 0 0 0 1px var(--border, var(--color-border));
}
/* 上条（上一张）：窄居中、矮，顶部露边，略暗略远；底部两角直角与主卡顶边贴合。
   padding 用 !important 覆盖面板卡片（.set-card/.agent-set-card）的 14px 垂直内边距，保证条高 = peek */
.deck-card--up {
  left: 5%;
  right: 5%;
  top: 0;
  height: var(--deck-peek);
  min-height: 0;
  padding: 2px 16px !important;
  border-radius: var(--radius-md, 8px) var(--radius-md, 8px) 0 0;
  z-index: 2;
  overflow: hidden;
  opacity: 0.55;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1), 0 0 0 1px var(--border, var(--color-border));
}
/* 下条（下一张）：窄居中、矮，底部露边，略暗；顶部两角直角与主卡底边贴合 */
.deck-card--down {
  left: 5%;
  right: 5%;
  top: calc(100% - var(--deck-peek));
  height: var(--deck-peek);
  min-height: 0;
  padding: 2px 16px !important;
  border-radius: 0 0 var(--radius-md, 8px) var(--radius-md, 8px);
  z-index: 2;
  overflow: hidden;
  opacity: 0.75;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1), 0 0 0 1px var(--border, var(--color-border));
}
.deck-card--hidden { visibility: hidden; }
/* 平铺模式（搜索模式）：卡片静态排列、完整显示，不叠放翻卡；由 v-show 过滤匹配项 */
.card-deck--flat {
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
}
.card-deck--flat .deck-card {
  position: static;
  height: auto;
  transform: none;
  opacity: 1;
  transition: none;
  border-radius: var(--radius-md, 8px);
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.06), 0 0 0 1px var(--border, var(--color-border));
  padding: 14px 16px;
}
/* 上/下条仅作「露边提示」，内部控件不可交互（不误触） */
.deck-card--up .settings-row,
.deck-card--down .settings-row,
.deck-card--up .set-row,
.deck-card--down .set-row,
.deck-card--up .sm-row,
.deck-card--down .sm-row { pointer-events: none; }

/* ── 翻卡翻转动画：位移交 top/height 过渡，动画内不含 translateY（避免闪烁）── */
/* 下一张从顶部翻下进入主卡 */
@keyframes anim-in-top {
  from { transform: rotateX(28deg) scale(0.95); opacity: 0.35; }
  60%  { transform: rotateX(8deg) scale(0.99); opacity: 0.9; }
  to   { transform: rotateX(0) scale(1); opacity: 1; }
}
/* 上一张从底部翻上进入主卡 */
@keyframes anim-in-bottom {
  from { transform: rotateX(-28deg) scale(0.95); opacity: 0.35; }
  60%  { transform: rotateX(-8deg) scale(0.99); opacity: 0.9; }
  to   { transform: rotateX(0) scale(1); opacity: 1; }
}
/* 主卡向下翻走（翻上一张 → 下条位） */
@keyframes anim-out-bottom {
  from { transform: rotateX(0) scale(1); opacity: 1; }
  45%  { transform: rotateX(18deg) scale(0.97); opacity: 0.82; }
  to   { transform: rotateX(14deg) scale(0.96); opacity: 0.75; }
}
/* 主卡向上翻走（翻下一张 → 上条位） */
@keyframes anim-out-top {
  from { transform: rotateX(0) scale(1); opacity: 1; }
  45%  { transform: rotateX(-18deg) scale(0.97); opacity: 0.82; }
  to   { transform: rotateX(-14deg) scale(0.96); opacity: 0.55; }
}
.anim-in-top { will-change: transform, opacity; animation: anim-in-top 0.4s cubic-bezier(0.22, 0.8, 0.36, 1); }
.anim-in-bottom { will-change: transform, opacity; animation: anim-in-bottom 0.4s cubic-bezier(0.22, 0.8, 0.36, 1); }
.anim-out-bottom { will-change: transform, opacity; animation: anim-out-bottom 0.4s cubic-bezier(0.22, 0.8, 0.36, 1); }
.anim-out-top { will-change: transform, opacity; animation: anim-out-top 0.4s cubic-bezier(0.22, 0.8, 0.36, 1); }

/* 无障碍「减弱动态效果」：由应用配置控制（根元素 data-reduce-motion，默认不减弱=保留动画） */
:root[data-reduce-motion='on'] .deck-card { transition: none; }
:root[data-reduce-motion='on'] .anim-in-top,
:root[data-reduce-motion='on'] .anim-in-bottom,
:root[data-reduce-motion='on'] .anim-out-bottom,
:root[data-reduce-motion='on'] .anim-out-top { animation: none; }
</style>
