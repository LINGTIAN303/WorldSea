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

      <!-- 顶部占位:窗口以上所有事件行的估算高度总和 -->
      <div
        v-if="windowedDisplayItems.topPlaceholderHeight > 0"
        class="window-placeholder"
        :style="{ height: windowedDisplayItems.topPlaceholderHeight + 'px' }"
        aria-hidden="true"
      ></div>

      <!-- 事件行流：窗口内切片全量交给 AgentStreamList 渲染（去模式分叉，单一扁平形态）。
           窗口化由本层支配，AgentStreamList 只做纯行渲染 + 事件透传。 -->
      <AgentStreamList
        :items="windowedDisplayItems.items"
        @block-action="emit('block-action', $event)"
        @manuscript-local-action="emit('manuscript-local-action', $event)"
        @copy="emit('copy', $event)"
        @retry="emit('retry', $event)"
        @tool-confirm="onToolConfirm"
        @scroll-to-message="scrollToMessage"
      />

      <!-- 底部占位:窗口以下所有事件行的估算高度总和 -->
      <div
        v-if="windowedDisplayItems.bottomPlaceholderHeight > 0"
        class="window-placeholder"
        :style="{ height: windowedDisplayItems.bottomPlaceholderHeight + 'px' }"
        aria-hidden="true"
      ></div>

      <!-- 流式输出占位符 + 思考中提示 -->
      <StreamingPlaceholder
        :is-streaming="isStreaming"
        :last-assistant-has-content="lastAssistantHasContent"
        :last-assistant-has-thinking="lastAssistantHasThinking"
        :enter-animation="enterAnimation"
        :dot-text="dotText"
      />

      <!-- Phase 5：会话标题生成中等候动画（首条消息后、LLM 标题落地前显示，复用思考中省略号） -->
      <Transition name="title-pending">
        <div v-if="sessionTitlePending?.[currentSessionId] && !isStreaming" class="title-pending">
          <span class="title-pending-label">正在生成会话标题</span><span class="title-pending-dots">{{ titleDotText }}</span>
        </div>
      </Transition>

      <!-- [④] Turn 状态：整 running turn 常驻 + 耗时（≥15s 显示） -->
      <TurnStatus :running="isStreaming" :start-time="turnStartTime" />

      <!-- [⑥] 会话错误行：由 activity log error 项派生 -->
      <ErrorRows :error="turnError" />
    </div>

    <!-- 用户消息点状导航（保留为可选，不再按模式隐藏） -->
    <DotNav
      v-if="userMessages.length"
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
import AgentStreamList from '@worldsmith/shared-ui/agent/stream/AgentStreamList.vue'
import A2UIRenderer from '@worldsmith/shared-ui/agent/a2ui/A2UIRenderer.vue'
import { usePersonaFont } from '../space/composables/usePersonaFont'
import { useAgent } from './composables/useAgent'
import { useActivityLog } from './composables/useActivityLog'
import { useArchiveStore } from '../stores/archiveStore'
import { watchDebounced } from '@worldsmith/perf-kit/render'
import type { AgentMessage } from '@agent/index'
import type { AgentStreamItem } from '@worldsmith/shared-composables/agent/useAgent'
import { useDotAnimation, useMessageWindowing, MessageListEmpty, ArchivedSection, StreamingPlaceholder, ScrollToBottomButton, DotNav, TurnStatus, ErrorRows } from '@worldsmith/shared-ui/agent/message-list'

const { enterAnimation } = usePersonaFont()
const { agentStream, isStreaming: agentIsStreaming, resolveToolConfirmation, sessionTitlePending, currentSessionId } = useAgent()
const archiveStore = useArchiveStore()
const { logs: activityLogs } = useActivityLog()

const props = withDefaults(defineProps<{
  messages: Array<AgentMessage>
  isStreaming: boolean
  lastAssistantHasContent: boolean
  lastAssistantHasThinking: boolean
  a2uiSurfaces: Record<string, any>
  resolveDataBinding: (binding: any, dataModel: Record<string, unknown>) => any
  /** @deprecated legacy：不再驱动渲染形态（列表层已全面用 agentStream 事件行流） */
  chatMode?: 'deep' | 'explore' | 'task' | 'group-chat'
  /** @deprecated legacy：不再驱动渲染形态 */
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

// [④] Turn 状态计时锚定：isStreaming 由假转真的上升沿记录 turn 开始时间
const turnStartTime = ref<number | null>(null)
watch(() => props.isStreaming, (streaming, was) => {
  if (streaming && !was) turnStartTime.value = Date.now()
  else if (!streaming) turnStartTime.value = null
})

// [⑥] 会话错误行：取 activity log 最近的 error 项派生
const turnError = computed<{ message: string; code?: string } | null>(() => {
  const last = [...activityLogs.value].reverse().find(l => l.type === 'error')
  if (!last) return null
  return { message: last.message, code: last.detail ? String(last.detail) : undefined }
})

const messagesContainer = ref<HTMLDivElement>()

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

/** 所有用户消息（供点状导航使用，锚定 id 与事件流中 user 行 id 一致） */
const userMessages = computed(() => props.messages.filter(m => m.role === 'user'))

/** 思考中省略号动画（isStreaming 变化时自动启停） */
const { dotText } = useDotAnimation(agentIsStreaming)

/** Phase 5：会话标题生成中等候动画开关（当前会话首条消息后标题落地前，且不在流式输出时）。
 *  按 currentSessionId 取隔离标记，避免切会话后串扰到其他会话。 */
const titleDotOn = computed(() => Boolean(sessionTitlePending?.value?.[currentSessionId.value]) && !props.isStreaming)
/** 标题生成中等候省略号动画（与思考中动画同源 useDotAnimation 复用「思考中」占位形态） */
const { dotText: titleDotText } = useDotAnimation(titleDotOn)

/** 渲染窗口化 + 滚动锚定 + 可见性观察：数据源为事件行流 agentStream（去 isDeepMode 分叉） */
const {
  windowedDisplayItems,
  showScrollToBottomBtn,
  newMsgCountWhileAway,
  visibleMsgIds,
  jumpToBottom,
  scrollToBottom,
  scrollToMessage,
  scheduleScrollToBottom,
} = useMessageWindowing<AgentStreamItem>({
  container: messagesContainer,
  items: computed(() => agentStream.value),
  messages: computed(() => props.messages),
})

/** 是否存在 A2UI 界面 */
const hasA2UISurfaces = computed(() => Object.keys(props.a2uiSurfaces).length > 0)

/** A2UI 动作转发 */
function onA2UIAction(surfaceId: string, action: { name: string; data?: any }): void {
  emit('a2ui-action', surfaceId, action)
}

/** 工具确认回调（选择型/确认型工具，事件行流 ToolRow 透传） */
function onToolConfirm(event: { toolId: string; approved: boolean }): void {
  resolveToolConfirmation(event.toolId, event.approved)
}

// ===== 自动滚动到底部的触发时机 =====
// 事件行数组、A2UI 界面、末条助手正文内容长度变化时，若用户在底部跟随状态则自动滚动
watchDebounced(() => agentStream.value.length, () => scheduleScrollToBottom(), { debounce: 50 })
// 流式输出：末条助手正文行 content 原地增长（delta 不可变替换），跟随其长度变化持续自动跟随
watchDebounced(
  () => {
    const stream = agentStream.value
    let lastLen = 0
    for (let i = stream.length - 1; i >= 0; i--) {
      const row = stream[i]
      if (row.type === 'assistant') {
        lastLen = (row.msg.content?.length ?? 0) + ((row.msg as { thinking?: string }).thinking?.length ?? 0)
        break
      }
    }
    return lastLen
  },
  () => scheduleScrollToBottom(),
  { debounce: 30 },
)
watchDebounced(() => Object.keys(props.a2uiSurfaces).length, () => scheduleScrollToBottom(), { debounce: 50 })

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
  /* [2] 消息流区域宽度跟随输入栏（--conv-w）：内容居中，与输入栏同宽 */
  width: 100%;
  max-width: var(--conv-w);
  align-self: center;
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

/* Phase 5：会话标题生成中等候动画 */
.title-pending {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: var(--font-size-2xs);
  color: var(--color-text-tertiary);
  padding: 2px 4px;
}
.title-pending-dots {
  color: var(--color-text-tertiary);
  letter-spacing: 1px;
}
.title-pending-enter-active {
  transition: opacity 0.2s ease;
}
.title-pending-leave-active {
  transition: opacity 0.15s ease;
}
.title-pending-enter-from,
.title-pending-leave-to {
  opacity: 0;
}
</style>