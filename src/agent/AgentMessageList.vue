<template>
  <div class="chat-messages" ref="messagesContainer">
    <div class="messages-scroll">
    <div v-if="messages.length === 0 && archivedBoundaryIndex === 0" class="chat-empty">
      <div class="empty-icon"><WsIcon name="profile" size="lg" /></div>
      <div class="empty-title">WorldSmith 助手</div>
      <div class="empty-hint">我可以帮你管理世界观实体和关系。试试输入 / 查看可用命令</div>
    </div>
    <!-- P12 决策：已归档消息折叠提示（设计文档 5.5 节） -->
    <div v-if="archivedBoundaryIndex > 0" class="archived-section" :class="{ expanded: showArchived }">
      <div class="archived-divider" @click="showArchived = !showArchived">
        <span class="archived-divider-icon"><WsIcon name="manuscript" size="s" /></span>
        <span class="archived-divider-text">
          {{ showArchived ? '收起' : '展开' }}已归档记忆（{{ archivedBoundaryIndex }} 条消息已归档）
        </span>
        <span class="archived-divider-chevron" :class="{ expanded: showArchived }">▸</span>
      </div>
      <Transition name="archived-expand">
        <div v-if="showArchived" class="archived-summary-body">
          <div v-if="archiveSummaryText" class="archived-summary-content" v-html="renderArchiveSummary(archiveSummaryText)"></div>
          <div v-else class="archived-summary-empty">归档摘要不可用，请打开记忆库面板查看详情</div>
          <button class="archived-view-panel-btn" @click.stop="emit('open-archive-panel')">
            打开记忆库面板
          </button>
        </div>
      </Transition>
    </div>
    <A2UIRenderer
      v-if="hasA2UISurfaces"
      :surfaces="a2uiSurfaces"
      :resolve-binding="resolveDataBinding"
      @action="onA2UIAction"
    />
    <!-- 深度模式：渲染虚拟段落 -->
    <template v-if="isDeepMode && deepSegments.length > 0">
      <!-- 过程段大折叠容器 -->
      <div class="process-collapse" :class="{ collapsed: !isProcessExpanded }">
        <div class="process-collapse-header" @click="isProcessExpanded = !isProcessExpanded">
          <span class="process-collapse-icon"><WsIcon name="brain" size="s" /></span>
          <span class="process-collapse-title">思考过程</span>
          <span class="process-collapse-stats">{{ processStats }}</span>
          <span class="process-collapse-chevron" :class="{ expanded: isProcessExpanded }">▸</span>
        </div>
        <Transition name="process-expand">
          <div v-if="isProcessExpanded" class="process-collapse-body">
            <DeepSegmentCard
              v-for="seg in deepSegments"
              :key="seg.id"
              :segment="seg"
              @block-action="emit('block-action', $event)"
              @tool-confirm="onToolConfirm"
            />
          </div>
        </Transition>
      </div>
      <!-- 选择型工具：独立于折叠容器，始终可见 -->
      <div v-if="choiceToolCalls.length > 0" class="choice-float-area">
        <InteractiveToolCall
          v-for="tc in choiceToolCalls"
          :key="tc.id"
          :tc="tc"
          @block-action="emit('block-action', $event)"
          @tool-confirm="onToolConfirm"
        />
      </div>
      <!-- 最终结论区 -->
      <div v-if="finalOutput" class="final-output-card" :class="finalOutput.status">
        <div class="final-output-header">
          <span class="final-output-icon"><WsIcon name="message-text" size="s" /></span>
          <span class="final-output-title">结论</span>
          <span v-if="finalOutput.status === 'streaming'" class="final-output-badge">生成中</span>
        </div>
        <div class="final-output-body" v-html="renderFinalOutput(finalOutput.content)"></div>
        <!-- 结论区 Block 渲染（选择型/展示型） -->
        <div v-if="finalOutputBlocks.length > 0" class="final-output-blocks">
          <BlockTable v-for="b in tableBlocks" :key="b.id" :block="b" @action="emit('block-action', $event)" />
          <BlockChoice v-for="b in choiceBlocks" :key="b.id" :block="b" @action="emit('block-action', $event)" />
          <BlockCode v-for="b in codeBlocks" :key="b.id" :block="b" @action="emit('block-action', $event)" />
          <BlockEntityCard v-for="b in entityCardBlocks" :key="b.id" :block="b" @action="emit('block-action', $event)" />
          <BlockAlert v-for="b in alertBlocks" :key="b.id" :block="b" @action="emit('block-action', $event)" />
          <BlockStat v-for="b in statBlocks" :key="b.id" :block="b" @action="emit('block-action', $event)" />
          <BlockList v-for="b in listBlocks" :key="b.id" :block="b" @action="emit('block-action', $event)" />
          <BlockProgress v-for="b in progressBlocks" :key="b.id" :block="b" @action="emit('block-action', $event)" />
          <BlockComparison v-for="b in comparisonBlocks" :key="b.id" :block="b" @action="emit('block-action', $event)" />
          <BlockTimeline v-for="b in timelineBlocks" :key="b.id" :block="b" @action="emit('block-action', $event)" />
          <BlockImage v-for="b in imageBlocks" :key="b.id" :block="b" @action="emit('block-action', $event)" />
          <BlockAccordion v-for="b in accordionBlocks" :key="b.id" :block="b" @action="emit('block-action', $event)" />
          <BlockManuscript v-for="b in manuscriptBlocks" :key="b.id" :block="b" @action="emit('block-action', $event)" @manuscript-local-action="emit('manuscript-local-action', $event)" />
        </div>
      </div>
    </template>
    <!-- 非深度模式 或 深度模式无段落时：渲染消息气泡 -->
    <template v-if="!isDeepMode || deepSegments.length === 0">
      <AgentMessageBubble
        v-for="item in displayItems"
        :key="item.type === 'divider' ? 'div-' + item.dividerText : item.msg!.id"
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
    </template>
    <div v-if="isStreaming && !lastAssistantHasContent && !lastAssistantHasThinking" class="chat-msg msg-assistant">
      <span class="msg-icon"><WsIcon name="profile" size="xs" /></span>
      <div class="msg-body">
        <span class="streaming-cursor" :class="`cursor-${enterAnimation}`">●</span>
      </div>
    </div>
    <div v-if="isStreaming && lastAssistantHasThinking && !lastAssistantHasContent" class="streaming-thinking-hint">
      <WsIcon name="manuscript" size="xs" /> 思考中<span class="thinking-dots">{{ dotText }}</span>
    </div>
    </div>
    <!-- 深度模式：右下角用户消息列表 -->
    <Transition name="deep-user-bar">
      <div v-if="isDeepMode && deepUserMessages.length > 0" class="deep-user-bar">
        <div class="deep-user-bar-header">
          <span class="deep-user-bar-label">对话</span>
          <span class="deep-user-bar-count">{{ deepUserMessages.length }}</span>
        </div>
        <div class="deep-user-bar-list">
          <div
            v-for="um in deepUserMessages"
            :key="um.id"
            class="deep-user-bar-item"
            :class="{ active: isDeepUserMsgActive(um.id) }"
            @click="scrollToMessage(um.id)"
          >
            <span class="deep-user-bar-dot"></span>
            <span class="deep-user-bar-text">{{ truncateText(um.content, 40) }}</span>
          </div>
        </div>
      </div>
    </Transition>
    <div v-if="userMessages.length && !isDeepMode" class="dot-nav">
      <div
        v-for="um in userMessages"
        :key="um.id"
        class="dot-item"
        role="button"
        tabindex="0"
        @mouseenter="hoveredDot = um.id"
        @mouseleave="hoveredDot = ''"
        @click="scrollToMessage(um.id)"
        @keydown.enter="scrollToMessage(um.id)"
      >
        <div class="dot-point" :class="{ active: visibleMsgIds.has(um.id) }"></div>
        <Transition name="ws-fade">
          <div v-if="hoveredDot === um.id" class="dot-tooltip">
            {{ truncateText(um.content, 50) }}
          </div>
        </Transition>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import WsIcon from '../ui/WsIcon.vue'
import AgentMessageBubble from './AgentMessageBubble.vue'
import A2UIRenderer from './a2ui/A2UIRenderer.vue'
import DeepSegmentCard from './blocks/DeepSegmentCard.vue'
import InteractiveToolCall from './blocks/InteractiveToolCall.vue'
import BlockTable from './blocks/BlockTable.vue'
import BlockChoice from './blocks/BlockChoice.vue'
import BlockCode from './blocks/BlockCode.vue'
import BlockEntityCard from './blocks/BlockEntityCard.vue'
import BlockAlert from './blocks/BlockAlert.vue'
import BlockStat from './blocks/BlockStat.vue'
import BlockList from './blocks/BlockList.vue'
import BlockProgress from './blocks/BlockProgress.vue'
import BlockComparison from './blocks/BlockComparison.vue'
import BlockTimeline from './blocks/BlockTimeline.vue'
import BlockImage from './blocks/BlockImage.vue'
import BlockAccordion from './blocks/BlockAccordion.vue'
import BlockManuscript from './blocks/BlockManuscript.vue'
import { usePersonaFont } from '../space/composables/usePersonaFont'
import { useAgent } from './composables/useAgent'
import { useArchiveStore } from '../stores/archiveStore'
import { watchDebounced } from '@worldsmith/perf-kit/render'
const { enterAnimation } = usePersonaFont()
const { deepSegments, finalOutput, isStreaming: agentIsStreaming, resolveToolConfirmation } = useAgent()
const archiveStore = useArchiveStore()

type AgentMessage = import('@agent/index').AgentMessage

const props = withDefaults(defineProps<{
  messages: Array<AgentMessage>
  isStreaming: boolean
  lastAssistantHasContent: boolean
  lastAssistantHasThinking: boolean
  a2uiSurfaces: Record<string, any>
  resolveDataBinding: (binding: any, dataModel: Record<string, unknown>) => any
  chatMode?: 'normal' | 'deep' | 'explore' | 'group-chat'
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

const hoveredMsgId = ref('')
const dotText = ref('')
const messagesContainer = ref<HTMLDivElement>()
const hoveredDot = ref('')
const visibleMsgIds = ref<Set<string>>(new Set())

/** P12 决策：已归档消息折叠状态 */
const showArchived = ref(false)

/** 从 archiveStore 读取归档边界索引（响应式） */
const archivedBoundaryIndex = computed(() => archiveStore.archivedBoundaryIndex)

/**
 * 从 messages 中提取归档摘要文本
 *
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

/** 渲染归档摘要文本（简易 markdown） */
function renderArchiveSummary(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/### (.*?)(<br>|$)/g, '<h4>$1</h4>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
}

const isDeepMode = computed(() => props.chatMode === 'deep' && props.useDeepLayout)

/** finalOutput 中的 Block 数据（从最后一条助手消息的 blocks 中提取） */
type MessageBlock = import('@agent/index').MessageBlock
const finalOutputBlocks = computed<MessageBlock[]>(() => {
  if (!finalOutput.value) return []
  // 从最后一条助手消息中获取 blocks
  const lastAssistant = [...props.messages].reverse().find(m => m.role === 'assistant')
  if (!lastAssistant?.blocks?.length) return []
  return lastAssistant.blocks
})

const tableBlocks = computed(() => finalOutputBlocks.value.filter(b => b.type === 'table'))
const choiceBlocks = computed(() => {
  // 深度模式下 choice block 由 InteractiveToolCall 独立渲染，不在结论区重复
  if (isDeepMode.value && choiceToolCalls.value.length > 0) return []
  return finalOutputBlocks.value.filter(b => b.type === 'choice')
})
const codeBlocks = computed(() => finalOutputBlocks.value.filter(b => b.type === 'code'))
const entityCardBlocks = computed(() => finalOutputBlocks.value.filter(b => b.type === 'entity-card'))
const alertBlocks = computed(() => finalOutputBlocks.value.filter(b => b.type === 'alert'))
const statBlocks = computed(() => finalOutputBlocks.value.filter(b => b.type === 'stat'))
const listBlocks = computed(() => finalOutputBlocks.value.filter(b => b.type === 'list'))
const progressBlocks = computed(() => finalOutputBlocks.value.filter(b => b.type === 'progress'))
const comparisonBlocks = computed(() => finalOutputBlocks.value.filter(b => b.type === 'comparison'))
const timelineBlocks = computed(() => finalOutputBlocks.value.filter(b => b.type === 'timeline'))
const imageBlocks = computed(() => finalOutputBlocks.value.filter(b => b.type === 'image'))
const accordionBlocks = computed(() => finalOutputBlocks.value.filter(b => b.type === 'accordion'))
const manuscriptBlocks = computed(() => finalOutputBlocks.value.filter(b => b.type === 'manuscript'))

/** 深度模式：从所有阶段中提取选择型工具（独立于折叠容器渲染） */
const choiceToolCalls = computed(() => {
  if (!isDeepMode.value) return []
  const result: import('./composables/useAgent').ToolCallView[] = []
  for (const seg of deepSegments.value) {
    if (seg.type === 'phase' && seg.tools) {
      for (const tc of seg.tools) {
        if (tc.interactiveType === 'choice') result.push(tc)
      }
    }
  }
  return result
})

/** 深度模式内联确认回调 */
function onToolConfirm(event: { toolId: string; approved: boolean }) {
  resolveToolConfirmation(event.toolId, event.approved)
}

/** 过程段大折叠容器：Agent 执行中展开，完成后自动收缩 */
const isProcessExpanded = ref(true)

/** 过程段统计信息 */
const processStats = computed(() => {
  const segs = deepSegments.value
  const thinkingCount = segs.filter(s => s.type === 'thinking').length
  const phaseCount = segs.filter(s => s.type === 'phase').length
  const parts: string[] = []
  if (thinkingCount > 0) parts.push(`${thinkingCount} 次推理`)
  if (phaseCount > 0) parts.push(`${phaseCount} 个阶段`)
  return parts.length > 0 ? parts.join(' · ') : ''
})

/** Agent 完成后自动收缩过程段 */
watch(() => agentIsStreaming.value, (streaming) => {
  if (!streaming && deepSegments.value.length > 0) {
    // 检查是否所有段都已完成（非 streaming 状态）
    const allDone = deepSegments.value.every(s => {
      if (s.type === 'thinking') return s.status === 'complete'
      if (s.type === 'phase') return s.status === 'done'
      return true
    })
    if (allDone) {
      isProcessExpanded.value = false
    }
  } else if (streaming) {
    // Agent 开始执行时展开
    isProcessExpanded.value = true
  }
})

/** 刷新恢复后：如果所有段已完成，自动收缩 */
watch(() => deepSegments.value, (segs) => {
  if (segs.length > 0 && !agentIsStreaming.value) {
    const allDone = segs.every(s => {
      if (s.type === 'thinking') return s.status === 'complete'
      if (s.type === 'phase') return s.status === 'done'
      return true
    })
    if (allDone) {
      isProcessExpanded.value = false
    }
  }
}, { immediate: true })

/** 深度模式下过滤掉用户消息，只保留助手消息 */
const filteredMessages = computed(() => {
  if (!isDeepMode.value) return props.messages
  return props.messages.filter(m => m.role === 'assistant')
})

/** 深度模式下所有用户消息 */
const deepUserMessages = computed(() => {
  if (!isDeepMode.value) return []
  return props.messages.filter(m => m.role === 'user')
})

const userMessages = computed(() => props.messages.filter(m => m.role === 'user'))

function truncateText(text: string, maxLen: number): string {
  if (!text) return ''
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text
}

/** 深度模式下：根据用户消息 ID 找到紧随其后的助手回复消息 ID */
function findAssistantAfterUserMsg(userMsgId: string): string | null {
  const idx = props.messages.findIndex(m => m.id === userMsgId)
  if (idx === -1) return null
  for (let i = idx + 1; i < props.messages.length; i++) {
    if (props.messages[i].role === 'assistant') return props.messages[i].id
  }
  return null
}

/** 深度模式下：用户消息项是否高亮（当对应的助手回复在视口中时） */
function isDeepUserMsgActive(userMsgId: string): boolean {
  const assistantId = findAssistantAfterUserMsg(userMsgId)
  return assistantId !== null && visibleMsgIds.value.has(assistantId)
}

function scrollToMessage(id: string): void {
  const container = messagesContainer.value
  if (!container) return
  // 深度模式下，用户消息不在 DOM 中，跳转到对应的助手回复
  const targetId = isDeepMode.value ? (findAssistantAfterUserMsg(id) || id) : id
  const el = container.querySelector(`[data-msg-id="${targetId}"]`) as HTMLElement | null
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

let scrollObserver: IntersectionObserver | null = null

function setupScrollObserver(): void {
  if (scrollObserver) scrollObserver.disconnect()
  const container = messagesContainer.value
  if (!container) return
  const scrollRoot = container.querySelector('.messages-scroll') as HTMLElement || container
  scrollObserver = new IntersectionObserver(
    (entries) => {
      const next = new Set(visibleMsgIds.value)
      for (const entry of entries) {
        const msgId = (entry.target as HTMLElement).dataset?.msgId
        if (msgId) {
          if (entry.isIntersecting) next.add(msgId)
          else next.delete(msgId)
        }
      }
      visibleMsgIds.value = next
    },
    { root: scrollRoot, threshold: 0.5 }
  )
  for (const el of scrollRoot.querySelectorAll('[data-msg-id]')) {
    scrollObserver.observe(el)
  }
}

watch(() => props.messages.length, () => {
  nextTick(() => {
    setupScrollObserver()
  })
})

onMounted(() => {
  nextTick(setupScrollObserver)
})

onBeforeUnmount(() => {
  if (scrollObserver) scrollObserver.disconnect()
})

interface DisplayItem {
  type: 'message' | 'divider'
  msg?: any
  dividerText?: string
}

function formatDividerTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const isToday = d.toDateString() === now.toDateString()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday = d.toDateString() === yesterday.toDateString()
  if (isToday) return `今天 ${time}`
  if (isYesterday) return `昨天 ${time}`
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${time}`
}

const displayItems = computed(() => {
  const items: DisplayItem[] = []
  const source = filteredMessages.value
  const THIRTY_MIN = 30 * 60 * 1000
  for (let i = 0; i < source.length; i++) {
    const msg = source[i]
    // 时间分隔线
    if (i === 0 || msg.timestamp - source[i - 1].timestamp > THIRTY_MIN) {
      items.push({ type: 'divider', dividerText: formatDividerTime(msg.timestamp) })
    }
    // 深度模式：助手消息前面如果紧跟另一条助手消息（不同轮次），插入轮次分隔线
    // 判断依据：两条助手消息之间时间差超过10秒，说明是不同轮次
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

const hasA2UISurfaces = computed(() => Object.keys(props.a2uiSurfaces).length > 0)

function scrollToBottom(): void {
  const c = messagesContainer.value
  if (c) {
    const scroll = c.querySelector('.messages-scroll') as HTMLElement | null
    if (scroll) scroll.scrollTop = scroll.scrollHeight
  }
}

let dotTimer: ReturnType<typeof setInterval> | null = null

function startDotAnimation(): void {
  stopDotAnimation()
  let count = 0
  dotTimer = setInterval(() => {
    count = (count + 1) % 4
    dotText.value = '.'.repeat(count)
  }, 400)
}

function stopDotAnimation(): void {
  if (dotTimer) { clearInterval(dotTimer); dotTimer = null }
  dotText.value = ''
}

let scrollTimer: ReturnType<typeof setTimeout> | null = null

function scheduleScrollToBottom() {
  if (scrollTimer) clearTimeout(scrollTimer)
  scrollTimer = setTimeout(() => nextTick(scrollToBottom), 50)
}

// 合并所有滚动到底部的 watch，用 watchDebounced 替代 deep watch
watchDebounced(() => props.messages.length, () => scheduleScrollToBottom(), { debounce: 50 })
watchDebounced(() => Object.keys(props.a2uiSurfaces).length, () => scheduleScrollToBottom(), { debounce: 50 })
watchDebounced(() => deepSegments.value.length, () => scheduleScrollToBottom(), { debounce: 50 })
watch(() => finalOutput.value, () => scheduleScrollToBottom())

watch(() => props.isStreaming, (val) => {
  if (val) startDotAnimation()
  else stopDotAnimation()
})

function onA2UIAction(surfaceId: string, action: { name: string; data?: any }): void {
  emit('a2ui-action', surfaceId, action)
}

function renderFinalOutput(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
}

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

/* P12 决策：已归档消息折叠区域（设计文档 5.5 节） */
.archived-section {
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--agent-primary, #3b82f6) 12%, transparent);
  background: color-mix(in srgb, var(--agent-primary, #3b82f6) 3%, transparent);
  overflow: hidden;
  animation: seg-in 0.3s ease-out;
  transition: border-color 0.3s, background 0.3s;
}

.archived-section.expanded {
  border-color: color-mix(in srgb, var(--agent-primary, #3b82f6) 20%, transparent);
  background: color-mix(in srgb, var(--agent-primary, #3b82f6) 5%, transparent);
}

.archived-divider {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}

.archived-divider:hover {
  background: color-mix(in srgb, var(--agent-primary, #3b82f6) 8%, transparent);
}

.archived-divider-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  flex-shrink: 0;
  background: color-mix(in srgb, var(--agent-primary, #3b82f6) 12%, transparent);
  color: var(--agent-primary, #3b82f6);
}

.archived-divider-text {
  font-size: 13px;
  font-weight: 500;
  color: var(--agent-text);
  flex: 1;
  font-family: var(--agent-font);
}

.archived-divider-chevron {
  margin-left: auto;
  font-size: 10px;
  color: var(--agent-text-tertiary);
  transition: transform 0.2s;
  flex-shrink: 0;
}

.archived-divider-chevron.expanded {
  transform: rotate(90deg);
}

.archived-summary-body {
  border-top: 1px solid color-mix(in srgb, var(--agent-primary, #3b82f6) 10%, transparent);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.archived-summary-content {
  font-size: 13px;
  line-height: 1.6;
  color: var(--agent-text);
  font-family: var(--agent-font);
  max-height: 300px;
  overflow-y: auto;
  scrollbar-width: thin;
}

.archived-summary-content :deep(h4) {
  font-size: 13px;
  font-weight: 600;
  color: var(--agent-primary, #3b82f6);
  margin: 8px 0 4px 0;
}

.archived-summary-content :deep(h4:first-child) {
  margin-top: 0;
}

.archived-summary-content :deep(code) {
  background: rgba(255, 255, 255, 0.06);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 12px;
}

.archived-summary-content :deep(strong) {
  color: var(--agent-text);
  font-weight: 600;
}

.archived-summary-empty {
  font-size: 12px;
  color: var(--agent-text-tertiary);
  font-style: italic;
  font-family: var(--agent-font);
}

.archived-view-panel-btn {
  align-self: flex-start;
  padding: 4px 12px;
  font-size: 12px;
  color: var(--agent-primary, #3b82f6);
  background: color-mix(in srgb, var(--agent-primary, #3b82f6) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--agent-primary, #3b82f6) 20%, transparent);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
  font-family: var(--agent-font);
}

.archived-view-panel-btn:hover {
  background: color-mix(in srgb, var(--agent-primary, #3b82f6) 18%, transparent);
}

/* 归档摘要展开/收缩动画 */
.archived-expand-enter-active,
.archived-expand-leave-active {
  transition: max-height 0.3s ease, opacity 0.2s ease;
  max-height: 400px;
  overflow: hidden;
}

.archived-expand-enter-from,
.archived-expand-leave-to {
  max-height: 0;
  opacity: 0;
}

.chat-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  text-align: center;
}

.empty-icon { font-size: var(--icon-xl); margin-bottom: 12px }
.empty-title {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--agent-text);
  margin-bottom: 8px;
  font-family: var(--agent-font);
}
.empty-hint {
  font-size: var(--font-size-sm);
  color: var(--agent-text-secondary);
  line-height: 1.5;
  font-family: var(--agent-font);
}

.chat-msg {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  max-width: 85%;
  animation: ws-msg-in 0.2s ease;
}

.msg-assistant { align-self: flex-start }

.msg-icon {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-sm);
  border-radius: 50%;
  background: var(--agent-hover-bg);
}

.msg-body {
  font-size: var(--font-size-base);
  line-height: 1.6;
  color: var(--agent-text);
  word-break: break-word;
  position: relative;
  font-family: var(--agent-font);
  background: transparent;
}

.streaming-cursor {
  animation: ws-blink 0.8s step-end infinite;
  color: var(--agent-primary);
  font-size: 10px;
}

.streaming-cursor.cursor-fadeIn { animation: ws-cursor-fade 1s ease-in-out infinite }
.streaming-cursor.cursor-slideIn { animation: ws-cursor-slide 1s ease-in-out infinite }
.streaming-cursor.cursor-typewriter { animation: ws-cursor-blink 0.8s step-end infinite }
.streaming-cursor.cursor-pulse { animation: ws-cursor-pulse 1.5s ease-in-out infinite }
.streaming-cursor.cursor-bounce { animation: ws-cursor-bounce 1s cubic-bezier(0.34, 1.56, 0.64, 1) infinite }
.streaming-cursor.cursor-wave { animation: ws-cursor-wave 1.2s ease-in-out infinite }

@keyframes ws-cursor-fade { 0%, 100% { opacity: 0.2 } 50% { opacity: 1 } }
@keyframes ws-cursor-slide { 0%, 100% { transform: translateY(0); opacity: 0.3 } 50% { transform: translateY(-3px); opacity: 1 } }
@keyframes ws-cursor-blink { 0%, 100% { opacity: 1 } 50% { opacity: 0 } }
@keyframes ws-cursor-pulse { 0%, 100% { transform: scale(1); opacity: 0.5 } 50% { transform: scale(1.3); opacity: 1 } }
@keyframes ws-cursor-bounce { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-4px) } }
@keyframes ws-cursor-wave { 0%, 100% { transform: translateX(0) } 25% { transform: translateX(2px) } 75% { transform: translateX(-2px) } }

.streaming-thinking-hint {
  font-size: var(--font-size-sm);
  color: var(--agent-text-secondary);
  padding: 4px 0;
  font-family: var(--agent-font);
}

.thinking-dots {
  display: inline-block;
  min-width: 12px;
}

.dot-nav {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px 4px;
  flex-shrink: 0;
  overflow-y: auto;
  scrollbar-width: none;
  max-height: 60%;
  z-index: 5;
}

.dot-nav::-webkit-scrollbar {
  display: none;
}

.dot-item {
  position: relative;
  cursor: pointer;
  display: flex;
  align-items: center;
}

.dot-point {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--agent-text-tertiary);
  transition: background 0.15s, transform 0.15s;
}

.dot-point.active {
  background: var(--agent-primary);
  transform: scale(1.3);
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

/* 深度模式：右下角用户消息列表 */
.deep-user-bar {
  position: absolute;
  right: 16px;
  bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 0;
  background: color-mix(in srgb, var(--agent-primary) 8%, transparent);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid color-mix(in srgb, var(--agent-primary) 15%, transparent);
  border-radius: 12px;
  max-width: 260px;
  max-height: 240px;
  z-index: 10;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.2);
  overflow: hidden;
}

.deep-user-bar-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--agent-primary) 10%, transparent);
}

.deep-user-bar-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--agent-primary);
}

.deep-user-bar-count {
  font-size: 10px;
  padding: 0 5px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--agent-primary) 12%, transparent);
  color: var(--agent-primary);
}

.deep-user-bar-list {
  overflow-y: auto;
  scrollbar-width: none;
  max-height: 200px;
}

.deep-user-bar-list::-webkit-scrollbar {
  display: none;
}

.deep-user-bar-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  cursor: pointer;
  transition: background 0.1s;
}

.deep-user-bar-item:hover {
  background: color-mix(in srgb, var(--agent-primary) 8%, transparent);
}

.deep-user-bar-item.active {
  background: color-mix(in srgb, var(--agent-primary) 12%, transparent);
}

.deep-user-bar-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--agent-text-tertiary);
}

.deep-user-bar-item.active .deep-user-bar-dot {
  background: var(--agent-primary);
}

.deep-user-bar-text {
  font-size: 12px;
  color: var(--agent-text-secondary);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.deep-user-bar-enter-active,
.deep-user-bar-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.deep-user-bar-enter-from,
.deep-user-bar-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

/* 最终结论区 */

/* 过程段大折叠容器 */
.process-collapse {
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--agent-warning, #eab308) 10%, transparent);
  background: color-mix(in srgb, var(--agent-warning, #eab308) 2%, transparent);
  overflow: hidden;
  animation: seg-in 0.3s ease-out;
  transition: border-color 0.3s, background 0.3s;
}

.process-collapse.collapsed {
  border-color: rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
}

.process-collapse-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}

.process-collapse-header:hover {
  background: rgba(255, 255, 255, 0.03);
}

.process-collapse-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  flex-shrink: 0;
  background: color-mix(in srgb, var(--agent-warning, #eab308) 10%, transparent);
  color: var(--agent-warning, #eab308);
  transition: background 0.3s, color 0.3s;
}

.collapsed .process-collapse-icon {
  background: rgba(255, 255, 255, 0.06);
  color: var(--agent-text-tertiary);
}

.process-collapse-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--agent-text);
  flex-shrink: 0;
}

.process-collapse-stats {
  font-size: 11px;
  color: var(--agent-text-tertiary);
  flex-shrink: 0;
}

.process-collapse-chevron {
  margin-left: auto;
  font-size: 10px;
  color: var(--agent-text-tertiary);
  transition: transform 0.2s;
  flex-shrink: 0;
}

.process-collapse-chevron.expanded {
  transform: rotate(90deg);
}

.process-collapse-body {
  border-top: 1px solid rgba(255, 255, 255, 0.04);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 过程段展开/收缩动画 */
.process-expand-enter-active,
.process-expand-leave-active {
  transition: max-height 0.3s ease, opacity 0.2s ease;
  max-height: 2000px;
  overflow: hidden;
}

.process-expand-enter-from,
.process-expand-leave-to {
  max-height: 0;
  opacity: 0;
}

.final-output-card {
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--agent-success, #22c55e) 12%, transparent);
  background: color-mix(in srgb, var(--agent-success, #22c55e) 2%, transparent);
  overflow: hidden;
  animation: seg-in 0.3s ease-out;
}

.final-output-card.streaming {
  border-color: color-mix(in srgb, var(--agent-success, #22c55e) 20%, transparent);
}

.final-output-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
}

.final-output-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  flex-shrink: 0;
  background: color-mix(in srgb, var(--agent-success, #22c55e) 10%, transparent);
  color: #22c55e;
}

.final-output-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--agent-text);
}

.final-output-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--agent-primary) 10%, transparent);
  color: var(--agent-primary);
  animation: badge-pulse 1.5s infinite;
}

.final-output-body {
  border-top: 1px solid rgba(255, 255, 255, 0.04);
  padding: 8px 12px;
  font-size: 14px;
  line-height: 1.7;
  color: var(--agent-text);
}

.final-output-body :deep(code) {
  background: rgba(255, 255, 255, 0.06);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 12px;
}

/* 结论区 Block 渲染 */
.final-output-blocks {
  border-top: 1px solid rgba(255, 255, 255, 0.04);
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 选择型工具独立渲染区（始终可见，不受折叠影响） */
.choice-float-area {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 4px;
}

@keyframes seg-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes badge-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}</style>
