<template>
  <div v-if="isDivider && dividerText === 'turn-separator'" class="turn-separator">
    <div class="turn-separator-line"></div>
  </div>
  <div v-else-if="isDivider" class="time-divider">
    <span class="time-divider-text">{{ dividerText }}</span>
  </div>
  <!-- 深度思考模式：区域布局（委托给 DeepMessageArea） -->
  <DeepMessageArea
    v-else-if="msg && hasVisibleContent && isDeepMode"
    :msg="msg"
    :is-hovered="isHovered"
    @hover="emit('hover', $event)"
    @leave="emit('leave')"
    @copy="emit('copy', $event)"
    @block-action="emit('blockAction', $event)"
    @manuscript-local-action="emit('manuscriptLocalAction', $event)"
  />
  <!-- 普通模式：气泡布局（委托给 NormalMessageBubble） -->
  <NormalMessageBubble
    v-else-if="msg && hasVisibleContent"
    :msg="msg"
    :is-hovered="isHovered"
    :chat-mode="chatMode"
    @hover="emit('hover', $event)"
    @leave="emit('leave')"
    @copy="emit('copy', $event)"
    @retry="emit('retry', $event)"
    @block-action="emit('blockAction', $event)"
    @manuscript-local-action="emit('manuscriptLocalAction', $event)"
  />
</template>

<script setup lang="ts">
/** AgentMessageBubble：消息气泡路由分发器（路由分支条件与子组件目录见文档），详细见 docs/details/注释/web/agent/AgentMessageBubble.md */
import { computed } from 'vue'
import { DeepMessageArea, NormalMessageBubble } from '@worldsmith/shared-ui/agent/bubbles'
import type { AgentMessage, ChatMode, BlockActionEvent } from '@worldsmith/shared-ui/agent/bubbles'

const props = withDefaults(defineProps<{
  isDivider?: boolean
  dividerText?: string
  msg?: AgentMessage
  isHovered: boolean
  chatMode?: ChatMode
  useDeepLayout?: boolean
}>(), {
  useDeepLayout: true,
})

const emit = defineEmits<{
  (e: 'hover', msgId: string): void
  (e: 'leave'): void
  (e: 'copy', msg: AgentMessage): void
  (e: 'retry', msg: AgentMessage): void
  (e: 'blockAction', event: BlockActionEvent): void
  (e: 'manuscriptLocalAction', event: BlockActionEvent): void
}>()

/**
 * 判断消息是否有可见内容
 * 与原实现完全一致：user 消息恒可见；assistant 消息需有 thinking/images/files/blocks/toolCalls/非 JSON 文本
 */
const hasVisibleContent = computed(() => {
  if (!props.msg) return false
  if (props.msg.role === 'user') return true
  if (props.msg.thinking) return true
  if (props.msg.images?.length) return true
  if (props.msg.files?.length) return true
  if (props.msg.blocks?.length) return true
  if (props.msg.toolCalls?.length) return true
  if (props.msg.content) {
    const text = props.msg.content.trim()
    if (!text) return false
    if (text.startsWith('{')) return false
    return true
  }
  return false
})

/** 聊天模式：props 优先，回退到 msg.metadata.chatMode，最终回退 'normal' */
const chatMode = computed(() =>
  props.chatMode || (props.msg?.metadata?.chatMode as ChatMode) || 'normal'
)

/** 是否启用深度模式布局：chatMode === 'deep' 且 useDeepLayout 为真 */
const isDeepMode = computed(() => chatMode.value === 'deep' && props.useDeepLayout)
</script>

<style scoped>
/* ===== 轮次分隔线 ===== */
.turn-separator {
  padding: 8px 20px;
  display: flex;
  align-items: center;
}

.turn-separator-line {
  flex: 1;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, var(--agent-primary) 25%, transparent) 20%,
    color-mix(in srgb, var(--agent-primary) 25%, transparent) 80%,
    transparent
  );
}

/* ===== 时间分隔线 ===== */
.time-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  user-select: none;
}

.time-divider::before,
.time-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--agent-border);
}

.time-divider-text {
  font-size: var(--font-size-xs);
  color: var(--agent-text-tertiary);
  white-space: nowrap;
  font-family: var(--agent-font);
}
</style>
