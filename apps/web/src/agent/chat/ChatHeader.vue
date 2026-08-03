<template>
  <div class="chat-header" :class="{ minimized: isMinimized }" @mousedown.left="onHeaderDragStart">
    <span
      class="header-title"
      :style="{ fontFamily: agentFontFamily || undefined }"
      @click.stop="emit('click-title')"
    ><WsIcon name="profile" size="sm" /> AI 助手</span>
    <div class="context-bar" :title="contextBarTitle">
      <div
        class="context-bar-fill"
        :style="{ width: contextUsage.pct + '%', background: accentColor }"
        :class="{ warn: contextUsage.pct > 70, danger: contextUsage.pct > 90 }"
      ></div>
      <!-- H3.3: 归档阈值标记 -->
      <div
        v-if="archiveThresholdPct > 0 && archiveThresholdPct <= 100"
        class="context-bar-marker"
        :style="{ left: archiveThresholdPct + '%' }"
        :title="`归档阈值: ${archiveThreshold.toLocaleString()} tokens`"
      ></div>
      <span class="context-bar-text">{{ Math.round(contextUsage.pct) }}%</span>
    </div>
    <div class="header-actions">
      <button class="header-btn" @click.stop="emit('toggle-archive')" title="记忆库">
        <WsIcon name="notebook" size="xs" />
      </button>
      <button
        class="header-btn"
        :class="{ active: isPinned }"
        @click.stop="emit('toggle-pin')"
        :title="isPinned ? '聚焦模式' : '穿透模式'"
      >
        <WsIcon :name="isPinned ? 'pin' : 'unlock'" size="xs" />
      </button>
      <button class="header-btn" @click.stop="emit('toggle-minimize')" title="最小化">
        <WsIcon :name="isMinimized ? 'arrow-up' : 'chevron-down'" size="xs" />
      </button>
      <button class="header-btn" @click.stop="emit('hide')" title="关闭">
        <WsIcon name="close" size="xs" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { WsIcon } from '@worldsmith/ui-kit'

interface ContextUsage {
  used: number
  total: number
  pct: number
}

defineProps<{
  /** Agent 字体 family（来自 persona 字体偏好） */
  agentFontFamily: string
  /** 上下文条 tooltip 文本 */
  contextBarTitle: string
  /** 上下文用量信息 */
  contextUsage: ContextUsage
  /** 归档阈值（tokens，用于 marker title） */
  archiveThreshold: number
  /** 归档阈值百分比（0-100，用于 marker 位置） */
  archiveThresholdPct: number
  /** 主题色（来自 persona profile） */
  accentColor: string
  /** 是否聚焦模式 */
  isPinned: boolean
  /** 是否最小化 */
  isMinimized: boolean
}>()

const emit = defineEmits<{
  (e: 'click-title'): void
  (e: 'toggle-archive'): void
  (e: 'toggle-pin'): void
  (e: 'toggle-minimize'): void
  (e: 'hide'): void
  /** 头部左键按下（拖拽起始，由父组件接 usePanelDrag） */
  (e: 'header-drag-start', event: MouseEvent): void
}>()

function onHeaderDragStart(e: MouseEvent): void {
  emit('header-drag-start', e)
}
</script>

<style scoped>
.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  cursor: grab;
  user-select: none;
  border-bottom: 1px solid var(--agent-border);
  background: var(--agent-bg);
  backdrop-filter: blur(var(--agent-blur));
  flex-shrink: 0;
}

.chat-header:active { cursor: grabbing }

/* 最小化时隐藏底边线（原 .minimized .chat-header 规则） */
.chat-header.minimized { border-bottom: none }

.header-title {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--agent-text);
  font-family: var(--agent-font);
  cursor: pointer;
  user-select: none;
  transition: color 0.15s;
}

.header-title:hover {
  color: var(--agent-primary);
}

.header-actions {
  display: flex;
  gap: 4px;
}

.header-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: var(--font-size-sm);
  padding: 2px 6px;
  border-radius: 6px;
  color: var(--agent-text-secondary);
  transition: background 0.15s, color 0.15s;
}

.header-btn:hover {
  background: var(--agent-hover-bg);
  color: var(--agent-text);
}

.header-btn.active {
  color: var(--agent-primary);
}

.context-bar {
  flex: 1;
  max-width: 120px;
  height: 4px;
  background: var(--agent-bg-tertiary);
  border-radius: 2px;
  overflow: hidden;
  position: relative;
  align-self: center;
  margin: 0 8px;
}
.context-bar-fill {
  height: 100%;
  border-radius: 2px;
  background: var(--agent-primary);
  transition: width 0.3s ease, background 0.3s ease;
}
.context-bar-fill.warn {
  background: var(--color-warning);
}
.context-bar-fill.danger {
  background: var(--color-danger);
}
.context-bar-text {
  position: absolute;
  top: -14px;
  right: 0;
  font-size: var(--text-micro-font-size);
  color: var(--agent-text-tertiary);
  line-height: 1;
}

/* H3.3: 归档阈值标记 */
.context-bar-marker {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 2px;
  background: var(--agent-warning, #f39c12);
  opacity: 0.7;
  pointer-events: none;
  z-index: 1;
}
</style>
