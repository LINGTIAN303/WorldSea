<!--
  ThinkRow：动态折叠推理行（对齐 Harness ReasoningRow）
  - running（流式）：默认展开，标题「推理过程」+ 末行摘要，data-follow-end 标记，正文自动跟随末尾；
  - complete（完成）：默认折叠为「推理过程 ▸ 首行摘要」单行，点击展开全文。
  纯文本/浅底单行扁平样式，无卡片边框。
-->
<template>
  <div
    class="ws-stream-row ws-stream-think"
    :class="{ open: isOpen }"
    :data-msg-id="item.id"
    :data-animating="animating ? '' : undefined"
    :data-follow-end="isStreaming ? '' : undefined"
    @mouseenter="emit('hover', item.id)"
    @mouseleave="emit('leave')"
  >
    <!-- 2026-09-04 折叠条文字化 v2：仅前缀文字（title）可点击展开/折叠，整行与摘要不可点、
         无 hover 背景高亮；仅 running 时 title 文字字形内流光（ws-shine-text），非运行静止 -->
    <div class="ws-stream-think-head">
      <span
        class="ws-stream-think-title"
        role="button"
        tabindex="0"
        :aria-expanded="isOpen"
        @click="toggle"
        @keydown.enter.prevent="toggle"
        @keydown.space.prevent="toggle"
      >
        <WsIcon name="chevron-right" size="xs" class="ws-stream-think-chevron" />
        <!-- 流光只挂文字本身（图标不受 background-clip:text 影响） -->
        <span :class="{ 'ws-shine-text': isStreaming }">{{ label }}</span>
      </span>
      <!-- 折叠态：单行摘要（只读展示，不可点击） -->
      <span v-if="!isOpen" class="ws-stream-think-summary">{{ summary }}</span>
    </div>
    <!-- 展开态：可折叠容器（grid-rows 0fr→1fr 高度动画 + 内容虚化→凝实）。
         标题行位置不动，下方内容被展开高度顺滑推下（accordion 语义）。 -->
    <div class="ws-stream-think-collapse" :class="{ open: isOpen }" :aria-hidden="!isOpen">
      <div ref="bodyEl" class="ws-stream-think-body" @click.stop>{{ item.text }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { useThinkingFold } from '../../bubbles/useThinkingFold'

/** Think 行的最小形参与事件流项一致 */
interface ThinkItem {
  id: string
  text: string
  status: 'streaming' | 'complete'
}

const props = defineProps<{
  item: ThinkItem
}>()

const emit = defineEmits<{
  (e: 'hover', id: string): void
  (e: 'leave'): void
  (e: 'expand'): void
}>()

/** streaming 视为 running（默认展开），complete 折叠 */
const isStreaming = computed(() => props.item.status === 'streaming')

/**
 * 展开/收起动画进行中标记：grid-rows 高度渐变期间 ResizeObserver 会每帧测到中间高度，
 * 若写入窗口化高度缓存 → 前缀和每帧重建 → 占位高度变化 → 切片可能卸载重挂 → 动画重跑 =
 * 疯狂闪烁反馈环。动画期间置 data-animating，窗口化测量跳过该行；动画结束（窗口化一次到位，④锚定兜底）。
 */
const animating = ref(false)
let animTimer: number | null = null
function markAnimating(): void {
  animating.value = true
  if (animTimer !== null) window.clearTimeout(animTimer)
  animTimer = window.setTimeout(() => {
    animating.value = false
    animTimer = null
  }, 320) // 展开 200ms + 内容 delay 80ms + 余量
}

// ===== 思维折叠（label='模型推理'，defaultOpen=running）；N5：标题统一「模型推理」——
// 判型/回答阶段推理块语言可能混排（中英），统一标题弱化观感差异 =====
const { label, isOpen, toggle: toggleFold } = useThinkingFold(
  () => '模型推理',
  () => isStreaming.value,
)

/**
 * 上抛 expand：用户主动展开时置该轮次的 userEverExpanded latch
 * 折叠三条件靠这个 latch 区分「立即折叠」与「延迟/离开视口才折叠」。
 * running 态的默认展开不算用户操作（只有由关到开才上抛）。
 */
function toggle() {
  const wasOpen = isOpen.value
  toggleFold()
  markAnimating() // 折叠/展开都有高度动画，标记防窗口化测高反馈环
  if (!wasOpen && isOpen.value) emit('expand')
}

// ===== 摘要：running=末行 / complete=首行 =====
const lines = computed(() =>
  props.item.text.split('\n').map(s => s.trim()).filter(Boolean),
)
const summary = computed(() => {
  const l = lines.value
  const src = isStreaming.value ? l[l.length - 1] : l[0]
  return (src || '').slice(0, 80)
})

// ===== 运行中自动跟随末尾（对齐 scrollLeft=scrollWidth-clientWidth） =====
const bodyEl = ref<HTMLDivElement | null>(null)
function followEnd() {
  if (!bodyEl.value) return
  bodyEl.value.scrollLeft = bodyEl.value.scrollWidth - bodyEl.value.clientWidth
}
watch(
  () => props.item.text,
  () => {
    if (isOpen.value && isStreaming.value) {
      nextTick(followEnd)
    }
  },
)
// 监听锚点：open 变化为 true 且 running 时也跟随一次
watch(isOpen, () => {
  if (isOpen.value && isStreaming.value) nextTick(followEnd)
})
onBeforeUnmount(() => {
  bodyEl.value = null
  if (animTimer !== null) {
    window.clearTimeout(animTimer)
    animTimer = null
  }
})
</script>