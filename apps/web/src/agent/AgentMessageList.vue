<template>
  <div class="chat-messages" ref="messagesContainer">
    <div class="messages-scroll">
      <!-- 空对话欢迎语 -->
      <MessageListEmpty v-if="messages.length === 0 && archivedBoundaryIndex === 0" />

      <!-- P12 决策：已归档消息折叠区（设计文档 5.5 节） -->
      <ArchivedSection
        v-if="archivedBoundaryIndex > 0"
        :archived-boundary-index="archivedBoundaryIndex"
        :archive-summary-text="archiveSummaryText"
        @open-archive-panel="emit('open-archive-panel')"
      />

      <A2UIRenderer
        v-if="hasA2UISurfaces"
        :surfaces="a2uiSurfaces"
        :resolve-binding="resolveDataBinding"
        @action="onA2UIAction"
      />

      <!-- 深度模式：渲染虚拟段落（过程段折叠 + 选择型工具 + 最终结论区） -->
      <DeepProcessPanel
        v-if="isDeepMode && deepSegments.length > 0"
        :deep-segments="deepSegments"
        :final-output="finalOutput"
        :final-output-blocks="finalOutputBlocks"
        :choice-tool-calls="choiceToolCalls"
        :agent-is-streaming="agentIsStreaming"
        :is-deep-mode="isDeepMode"
        :messages="messages"
        @block-action="emit('block-action', $event)"
        @tool-confirm="onToolConfirm"
        @manuscript-local-action="emit('manuscript-local-action', $event)"
      />

      <!-- 非深度模式 或 深度模式无段落时：渲染消息气泡 -->
      <template v-if="!isDeepMode || deepSegments.length === 0">
        <!-- 性能优化:渲染窗口化,远离视口的消息用占位 div 替代,避免长对话 DOM 节点爆炸 -->
        <!-- 顶部占位:窗口以上所有 item 的估算高度总和 -->
        <div
          v-if="windowedDisplayItems.topPlaceholderHeight > 0"
          class="window-placeholder"
          :style="{ height: windowedDisplayItems.topPlaceholderHeight + 'px' }"
          aria-hidden="true"
        ></div>
        <AgentMessageBubble
          v-for="item in windowedDisplayItems.items"
          :key="item.type === 'divider' ? 'div-' + item._windowIndex : item.msg!.id"
          :is-divider="item.type === 'divider'"
          :divider-text="item.dividerText"
          :msg="item.msg"
          :is-hovered="item.type === 'message' && hoveredMsgId === item.msg!.id"
          :chat-mode="chatMode"
          :use-deep-layout="useDeepLayout"
          @hover="item.type === 'message' && (hoveredMsgId = $event)"
          @leave="hoveredMsgId = ''"
          @copy="item.type === 'message' && emit('copy', $event)"
          @retry="item.type === 'message' && emit('retry', $event)"
          @block-action="emit('block-action', $event)"
          @manuscript-local-action="emit('manuscript-local-action', $event)"
        />
        <!-- 底部占位:窗口以下所有 item 的估算高度总和 -->
        <div
          v-if="windowedDisplayItems.bottomPlaceholderHeight > 0"
          class="window-placeholder"
          :style="{ height: windowedDisplayItems.bottomPlaceholderHeight + 'px' }"
          aria-hidden="true"
        ></div>
      </template>

      <!-- 流式输出占位符 + 思考中提示 -->
      <StreamingPlaceholder
        :is-streaming="isStreaming"
        :last-assistant-has-content="lastAssistantHasContent"
        :last-assistant-has-thinking="lastAssistantHasThinking"
        :enter-animation="enterAnimation"
        :dot-text="dotText"
      />
    </div>

    <!-- 深度模式：右下角用户消息列表 -->
    <DeepUserBar
      :visible="isDeepMode && deepUserMessages.length > 0"
      :messages="messages"
      :deep-user-messages="deepUserMessages"
      :visible-msg-ids="visibleMsgIds"
      @scroll-to-message="scrollToMessage"
    />

    <!-- 非深度模式：用户消息点状导航 -->
    <DotNav
      v-if="userMessages.length && !isDeepMode"
      :user-messages="userMessages"
      :visible-msg-ids="visibleMsgIds"
      @scroll-to-message="scrollToMessage"
    />

    <!-- 回到底部按钮 -->
    <ScrollToBottomButton
      :visible="showScrollToBottomBtn"
      :new-msg-count-while-away="newMsgCountWhileAway"
      @click="jumpToBottom"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import AgentMessageBubble from './AgentMessageBubble.vue'
import A2UIRenderer from './a2ui/A2UIRenderer.vue'
import { usePersonaFont } from '../space/composables/usePersonaFont'
import { useAgent } from './composables/useAgent'
import type { ToolCallView } from './composables/useAgent'
import { useArchiveStore } from '../stores/archiveStore'
import { watchDebounced } from '@worldsmith/perf-kit/render'
import type { AgentMessage, MessageBlock } from '@agent/index'
import { formatDividerTime, type DisplayItem } from './message-list/utils'
import { useDotAnimation } from './message-list/useDotAnimation'
import { useMessageWindowing } from './message-list/useMessageWindowing'
import MessageListEmpty from './message-list/MessageListEmpty.vue'
import ArchivedSection from './message-list/ArchivedSection.vue'
import StreamingPlaceholder from './message-list/StreamingPlaceholder.vue'
import ScrollToBottomButton from './message-list/ScrollToBottomButton.vue'
import DotNav from './message-list/DotNav.vue'
import DeepUserBar from './message-list/DeepUserBar.vue'
import DeepProcessPanel from './message-list/DeepProcessPanel.vue'

const { enterAnimation } = usePersonaFont()
const { deepSegments, finalOutput, isStreaming: agentIsStreaming, resolveToolConfirmation } = useAgent()
const archiveStore = useArchiveStore()

const props = withDefaults(defineProps<{
  messages: Array<AgentMessage>
  isStreaming: boolean
  lastAssistantHasContent: boolean
  lastAssistantHasThinking: boolean
  a2uiSurfaces: Record<string, any>
  resolveDataBinding: (binding: any, dataModel: Record<string, unknown>) => any
  chatMode?: 'normal' | 'deep' | 'explore' | 'task' | 'group-chat'
  useDeepLayout?: boolean
}>(), {
  useDeepLayout: true,
})

const emit = defineEmits<{
  'a2ui-action': [surfaceId: string, action: { name: string; data?: any }]
  'block-action': [event: { blockId: string; action: string; data?: Record<string, unknown> }]
  'manuscript-local-action': [event: { blockId: string; action: string; data?: Record<string, unknown> }]
  'open-archive-panel': []
  copy: [msg: any]
  retry: [msg: any]
}>()

/** 当前 hover 的消息 ID（用于消息气泡 hover 状态高亮） */
const hoveredMsgId = ref('')
const messagesContainer = ref<HTMLDivElement>()

/** 深度模式开关：仅当 chatMode='deep' 且 useDeepLayout=true 时启用 */
const isDeepMode = computed(() => props.chatMode === 'deep' && props.useDeepLayout)

/** 从 archiveStore 读取归档边界索引（响应式） */
const archivedBoundaryIndex = computed(() => archiveStore.archivedBoundaryIndex)

/**
 * 从 messages 中提取归档摘要文本。
 * injectHookSummary 在 messages 开头插入了 source='memory-archive' 的系统消息，
 * 这里提取该消息的 content 作为归档摘要展示。
 */
const archiveSummaryText = computed(() => {
  if (archivedBoundaryIndex.value === 0) return ''
  const summaryMsg = props.messages.find(
    m => m.role === 'system' && (m as any).metadata?.source === 'memory-archive'
  )
  return summaryMsg?.content || ''
})

/** 深度模式下过滤掉用户消息，只保留助手消息（用户消息由 DeepUserBar 单独展示） */
const filteredMessages = computed(() => {
  if (!isDeepMode.value) return props.messages
  return props.messages.filter(m => m.role === 'assistant')
})

/** 深度模式下所有用户消息 */
const deepUserMessages = computed(() => {
  if (!isDeepMode.value) return []
  return props.messages.filter(m => m.role === 'user')
})

/** 非深度模式下所有用户消息（供点状导航使用） */
const userMessages = computed(() => props.messages.filter(m => m.role === 'user'))

/**
 * 完整 displayItems（不含窗口化切片），作为窗口化的数据源。
 * 在消息之间插入时间分隔线（>30 分钟）和深度模式回合分隔线（>10 秒）。
 */
const fullDisplayItems = computed<DisplayItem[]>(() => {
  const items: DisplayItem[] = []
  const source = filteredMessages.value
  const THIRTY_MIN = 30 * 60 * 1000
  for (let i = 0; i < source.length; i++) {
    const msg = source[i]
    if (i === 0 || msg.timestamp - source[i - 1].timestamp > THIRTY_MIN) {
      items.push({ type: 'divider', dividerText: formatDividerTime(msg.timestamp) })
    }
    if (isDeepMode.value && msg.role === 'assistant' && i > 0 && source[i - 1].role === 'assistant') {
      const gap = msg.timestamp - source[i - 1].timestamp
      if (gap > 10_000) {
        items.push({ type: 'divider', dividerText: 'turn-separator' })
      }
    }
    items.push({ type: 'message', msg })
  }
  return items
})

/** finalOutput 中的 Block 数据（从最后一条助手消息的 blocks 中提取） */
const finalOutputBlocks = computed<MessageBlock[]>(() => {
  if (!finalOutput.value) return []
  const lastAssistant = [...props.messages].reverse().find(m => m.role === 'assistant')
  if (!lastAssistant?.blocks?.length) return []
  return lastAssistant.blocks
})

/** 深度模式：从所有阶段中提取选择型工具（独立于折叠容器渲染） */
const choiceToolCalls = computed(() => {
  if (!isDeepMode.value) return []
  const result: ToolCallView[] = []
  for (const seg of deepSegments.value) {
    if (seg.type === 'phase' && seg.tools) {
      for (const tc of seg.tools) {
        if (tc.interactiveType === 'choice') result.push(tc as ToolCallView)
      }
    }
  }
  return result
})

/** 思考中省略号动画（isStreaming 变化时自动启停） */
const { dotText } = useDotAnimation(agentIsStreaming)

/** 渲染窗口化 + 滚动锚定 + 可见性观察 */
const {
  windowedDisplayItems,
  showScrollToBottomBtn,
  newMsgCountWhileAway,
  visibleMsgIds,
  jumpToBottom,
  scrollToBottom,
  scrollToMessage,
  scheduleScrollToBottom,
} = useMessageWindowing({
  container: messagesContainer,
  fullDisplayItems,
  messages: computed(() => props.messages),
  isDeepMode,
})

/** 是否存在 A2UI 界面 */
const hasA2UISurfaces = computed(() => Object.keys(props.a2uiSurfaces).length > 0)

/** A2UI 动作转发 */
function onA2UIAction(surfaceId: string, action: { name: string; data?: any }): void {
  emit('a2ui-action', surfaceId, action)
}

/** 深度模式内联确认回调（选择型工具/确认型工具） */
function onToolConfirm(event: { toolId: string; approved: boolean }): void {
  resolveToolConfirmation(event.toolId, event.approved)
}

// ===== 自动滚动到底部的触发时机 =====
// 消息列表、A2UI 界面、深度段、最终结论变化时，若用户在底部跟随状态则自动滚动
watchDebounced(() => props.messages.length, () => scheduleScrollToBottom(), { debounce: 50 })
watchDebounced(() => Object.keys(props.a2uiSurfaces).length, () => scheduleScrollToBottom(), { debounce: 50 })
watchDebounced(() => deepSegments.value.length, () => scheduleScrollToBottom(), { debounce: 50 })
watch(() => finalOutput.value, () => scheduleScrollToBottom())

// 保持公共契约：父组件 AgentChat 通过 ref 调用 scrollToBottom 和访问 messagesContainer
defineExpose({
  scrollToBottom,
  messagesContainer
})
</script>

<style scoped>
.chat-messages {
  flex: 1;
  overflow: hidden;
  padding: 0;
  display: flex;
  flex-direction: row;
  position: relative;
  min-height: 0;
}

.messages-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  scrollbar-width: none;
  min-height: 0;
}

.messages-scroll > * {
  flex-shrink: 0;
}

.messages-scroll::-webkit-scrollbar {
  display: none;
}

/* 性能优化:窗口化占位符 - 不参与可见布局,仅撑开滚动条高度 */
.window-placeholder {
  width: 100%;
  flex-shrink: 0;
  pointer-events: none;
}
</style>
