<template>
  <!-- 用户消息点状导航：点击/悬停可跳转并预览（2026-09-05 改造） -->
  <div class="dot-nav">
    <div
      v-for="um in visibleDots"
      :key="um.id"
      class="dot-item"
      role="button"
      tabindex="0"
      @mouseenter="hoveredDot = um.id"
      @mouseleave="hoveredDot = ''"
      @click="emit('scroll-to-message', um.id)"
      @keydown.enter="emit('scroll-to-message', um.id)"
    >
      <!-- 单点高亮：只亮「当前可见头部」那条用户消息（视口内最靠前的） -->
      <div class="dot-point" :class="{ active: um.id === activeUserId }"></div>
      <Transition name="ws-fade">
        <!-- 悬停摘要：悬停点前后各一条共三条用户消息，悬停条最突出 -->
        <div v-if="hoveredDot === um.id" class="dot-tooltip">
          <div
            v-for="m in tooltipMessages"
            :key="m.id"
            class="dot-tooltip-item"
            :class="{ highlight: m.id === hoveredDot }"
          >
            {{ truncateText(m.content, 50) }}
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { AgentMessage } from '@worldsmith/agent-runtime'
import { truncateText } from './utils'

const props = defineProps<{
  userMessages: AgentMessage[]
  visibleMsgIds: Set<string>
  /** 2026-09-05 激活点推导：视口顶基准线之上最后一条用户消息（窗口化滚动时计算，无缝连贯） */
  activeUserId?: string
  /** 2026-09-05 端点高亮：视口贴顶/贴底时基准线判定失灵（首末条未越线），优先亮端点 */
  atTop?: boolean
  atBottom?: boolean
}>()

const emit = defineEmits<{
  'scroll-to-message': [id: string]
}>()

const hoveredDot = ref('')

/** 导航点数量上限：超出后以「当前可见头部」为中心的滑动窗口呈现 */
const MAX_DOTS = 9

/** 当前可见头部：贴顶亮首条、贴底亮末条，否则用滚动几何推导的激活点；无推导时回退首条 */
const activeUserId = computed(() => {
  if (props.atTop) return props.userMessages[0]?.id ?? ''
  if (props.atBottom) return props.userMessages[props.userMessages.length - 1]?.id ?? ''
  return props.activeUserId || props.userMessages[0]?.id || ''
})

/** 9 点滑动窗口：以激活点为中心居中取窗，边界 clamp；总数不超上限时全量 */
const visibleDots = computed(() => {
  const list = props.userMessages
  if (list.length <= MAX_DOTS) return list
  const idx = list.findIndex((um) => um.id === activeUserId.value)
  const center = idx >= 0 ? idx : 0
  const start = Math.min(Math.max(0, center - Math.floor(MAX_DOTS / 2)), list.length - MAX_DOTS)
  return list.slice(start, start + MAX_DOTS)
})

/** 悬停摘要：完整消息序列中悬停点前后各一条（共 3 条，边界自然收窄） */
const tooltipMessages = computed(() => {
  const idx = props.userMessages.findIndex((um) => um.id === hoveredDot.value)
  if (idx < 0) return []
  return props.userMessages.slice(Math.max(0, idx - 1), idx + 2)
})
</script>

<style scoped>
.dot-nav {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  /* 2026-09-05 悬停热区：nav 不留 gap，间距由 dot-item 自身 padding 提供——
     相邻点热区无缝衔接，8px 小点也易悬停 */
  gap: 0;
  padding: 8px 2px;
  flex-shrink: 0;
  /* 2026-09-05 摘要修复：去掉 overflow-y/max-height——overflow 非 visible 会把超出盒子的
     悬停摘要裁剪掉（摘要绝对定位在点左侧、完全在盒外）。9 点滑动窗口已保证高度可控，
     内部滚动不再需要。 */
  z-index: 5;
}

.dot-item {
  position: relative;
  cursor: pointer;
  display: flex;
  align-items: center;
  /* 热区外扩：视觉点 8px，可交互区 20×16px，纵向与相邻点无缝 */
  padding: 4px 6px;
}

.dot-point {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--agent-text-tertiary);
  transition: background 0.15s, transform 0.15s;
}

.dot-point.active {
  background: var(--agent-primary);
  transform: scale(1.25);
}

.dot-item:hover .dot-point {
  background: var(--agent-text-secondary);
  transform: scale(1.2);
}

.dot-tooltip {
  position: absolute;
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
  background: var(--agent-bg);
  border: 1px solid var(--agent-border);
  border-radius: 6px;
  padding: 4px 8px;
  font-size: var(--font-size-xs);
  color: var(--agent-text);
  white-space: nowrap;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  font-family: var(--agent-font);
}

/* 悬停摘要条目：三行堆叠；悬停点对应的那条最突出（主色 + 加重） */
.dot-tooltip-item {
  padding: 2px 0;
  opacity: 0.72;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dot-tooltip-item.highlight {
  opacity: 1;
  color: var(--agent-primary);
  font-weight: 600;
}

.ws-fade-enter-active,
.ws-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.ws-fade-enter-from,
.ws-fade-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
