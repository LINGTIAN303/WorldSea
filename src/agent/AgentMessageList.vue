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
              :segment="seg as DeepSegment"
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
    <!-- 性能优化:滚动锚定 - 用户向上滚动浏览历史时,新消息不再强制拉回底部 -->
    <!-- 改为显示"回到底部"按钮,点击后恢复跟随 -->
    <Transition name="ws-fade">
      <button
        v-if="showScrollToBottomBtn"
        class="scroll-to-bottom-btn"
        @click="jumpToBottom"
        aria-label="回到底部"
      >
        <WsIcon name="chevron-down" size="sm" />
        <span v-if="newMsgCountWhileAway > 0" class="new-msg-badge">{{ newMsgCountWhileAway > 99 ? '99+' : newMsgCountWhileAway }}</span>
      </button>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount, shallowRef } from 'vue'
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
import type { DeepSegment, ToolCallView } from './composables/useAgent'
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
  // 窗口化改造:目标消息可能不在当前窗口内(占位状态),需先扩展窗口再滚动
  // 找到目标消息在 fullDisplayItems 中的索引
  const all = fullDisplayItems.value
  const targetIndex = all.findIndex(item => item.type === 'message' && item.msg?.id === targetId)
  if (targetIndex >= 0 && (targetIndex < visibleStart.value || targetIndex >= visibleEnd.value)) {
    // 目标在窗口外,扩展窗口覆盖目标附近
    visibleStart.value = Math.max(0, targetIndex - WINDOW_BUFFER)
    visibleEnd.value = Math.min(all.length, targetIndex + WINDOW_BUFFER * 2)
    // 等待 DOM 更新后再滚动
    nextTick(() => {
      const el = container.querySelector(`[data-msg-id="${targetId}"]`) as HTMLElement | null
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    return
  }
  const el = container.querySelector(`[data-msg-id="${targetId}"]`) as HTMLElement | null
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

let scrollObserver: IntersectionObserver | null = null
let mutationObserver: MutationObserver | null = null

// 已观察过的消息节点集合,避免 MutationObserver 重复 observe
const observedMsgEls = new WeakSet<Element>()

/**
 * 增量化 observe:只对新出现的 [data-msg-id] 节点调用 observe
 * 性能优化:替代原"每次 messages.length 变化都 querySelectorAll 全量重 observe"的实现
 */
function observeMsgEls(root: Element): void {
  if (!scrollObserver) return
  for (const el of root.querySelectorAll('[data-msg-id]')) {
    if (!observedMsgEls.has(el)) {
      scrollObserver.observe(el)
      observedMsgEls.add(el)
    }
  }
}

function setupScrollObserver(): void {
  // 清理旧 observer(仅在组件卸载或容器变更时调用)
  if (scrollObserver) { scrollObserver.disconnect(); scrollObserver = null }
  if (mutationObserver) { mutationObserver.disconnect(); mutationObserver = null }

  const container = messagesContainer.value
  if (!container) return
  const scrollRoot = container.querySelector('.messages-scroll') as HTMLElement || container

  scrollObserver = new IntersectionObserver(
    (entries) => {
      // 增量更新 visibleMsgIds,避免每次都 new Set(...) 复制整个集合
      let changed = false
      const next = new Set(visibleMsgIds.value)
      for (const entry of entries) {
        const msgId = (entry.target as HTMLElement).dataset?.msgId
        if (msgId) {
          if (entry.isIntersecting) {
            if (!next.has(msgId)) { next.add(msgId); changed = true }
          } else {
            if (next.has(msgId)) { next.delete(msgId); changed = true }
          }
        }
      }
      if (changed) visibleMsgIds.value = next
    },
    { root: scrollRoot, threshold: 0.5 }
  )

  // 初始全量 observe(仅首次或重连时一次)
  observeMsgEls(scrollRoot)

  // 用 MutationObserver 监听子节点新增,增量化 observe 新消息节点
  // 替代原 watch(messages.length) + nextTick(setupScrollObserver) 的全量重做
  mutationObserver = new MutationObserver((mutations) => {
    if (!scrollObserver) return
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue
        const el = node as Element
        // 新增节点本身可能是消息,也可能是包含多个消息的容器
        if (el.hasAttribute && el.hasAttribute('data-msg-id')) {
          if (!observedMsgEls.has(el)) {
            scrollObserver.observe(el)
            observedMsgEls.add(el)
            // 同时 observe 高度变化,用于窗口化高度缓存
            if (resizeObserver) resizeObserver.observe(el)
          }
        }
        // 也观察后代中的消息节点
        if (el.querySelectorAll) {
          for (const child of el.querySelectorAll('[data-msg-id]')) {
            if (!observedMsgEls.has(child)) {
              scrollObserver.observe(child)
              observedMsgEls.add(child)
              if (resizeObserver) resizeObserver.observe(child)
            }
          }
        }
      }
    }
  })
  mutationObserver.observe(scrollRoot, { childList: true, subtree: true })
}

// 保留原 watch 用于首次挂载或消息从 0→N 时的初始化(此时 MutationObserver 可能还未挂上)
// 但不再每次 length 变化都 disconnect + 全量 querySelectorAll
watch(() => props.messages.length, (newLen, oldLen) => {
  // 仅在 observer 尚未初始化,或消息从 0→N(首条消息)时重新 setup
  if (!scrollObserver || (oldLen === 0 && newLen > 0)) {
    nextTick(() => setupScrollObserver())
  }
  // 其他情况由 MutationObserver 增量处理,无需手动干预
})

onMounted(() => {
  nextTick(() => {
    setupScrollObserver()
    // 绑定 scroll 监听用于窗口化 + 滚动锚定
    const container = messagesContainer.value
    if (container) {
      const scroll = container.querySelector('.messages-scroll') as HTMLElement | null
      if (scroll) {
        scroll.addEventListener('scroll', onScroll, { passive: true })
        // 初始化 ResizeObserver:测量已渲染 item 的真实高度,缓存到 measuredHeights
        // 用于提升窗口化滚动估算的准确性,减少跳屏
        resizeObserver = new ResizeObserver((entries) => {
          for (const entry of entries) {
            const el = entry.target as HTMLElement
            const msgId = el.dataset?.msgId
            if (msgId) {
              // 找到该消息在 fullDisplayItems 中的索引,缓存真实高度
              const idx = fullDisplayItems.value.findIndex(item => item.type === 'message' && item.msg?.id === msgId)
              if (idx >= 0) {
                measuredHeights.set(idx, entry.contentRect.height)
              }
            }
          }
          // 测量到新高度后,重建前缀和(rAF 合并,避免过度重建)
          scheduleRebuildPrefixSums()
        })
        // 对当前已渲染的消息节点 observe(后续新节点由 MutationObserver 增量 observe)
        for (const el of scroll.querySelectorAll('[data-msg-id]')) {
          resizeObserver.observe(el)
        }
      }
    }
  })
})

onBeforeUnmount(() => {
  if (scrollObserver) { scrollObserver.disconnect(); scrollObserver = null }
  if (mutationObserver) { mutationObserver.disconnect(); mutationObserver = null }
  if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null }
  if (scrollRafId !== null) { cancelAnimationFrame(scrollRafId); scrollRafId = null }
  if (rebuildRafId !== null) { cancelAnimationFrame(rebuildRafId); rebuildRafId = null }
  if (scrollTimer) { clearTimeout(scrollTimer); scrollTimer = null }
  // 移除 scroll 监听
  const container = messagesContainer.value
  if (container) {
    const scroll = container.querySelector('.messages-scroll') as HTMLElement | null
    if (scroll) scroll.removeEventListener('scroll', onScroll)
  }
})

interface DisplayItem {
  type: 'message' | 'divider'
  msg?: any
  dividerText?: string
  _windowIndex?: number  // 窗口化用:在完整 displayItems 中的索引,用作 divider 的稳定 key
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

// 完整 displayItems(不含窗口化切片),作为窗口化的数据源
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

// ===== 性能优化:渲染窗口化 =====
// 只渲染 [visibleStart, visibleEnd] 区间内的 item,区间外用占位 div 替代
// 避免长对话(100+条)全量渲染导致 DOM 节点爆炸、滚动卡顿
const WINDOW_BUFFER = 20  // 视口上下各保留 20 条缓冲,减少滚动时频繁切换
const INITIAL_RENDER_COUNT = 50  // 初始渲染最近 50 条(覆盖大多数对话首屏)
const ESTIMATED_ITEM_HEIGHT = 80  // 未测量过的 item 估算高度(px)

const visibleStart = ref(0)
const visibleEnd = ref(INITIAL_RENDER_COUNT)
// 已测量的 item 高度缓存(Map<index, height>),首次渲染后由 ResizeObserver 填充
const measuredHeights = new Map<number, number>()
let resizeObserver: ResizeObserver | null = null
let scrollRafId: number | null = null

// 前缀和数组 + 动态平均高度:O(log n) 二分查找 + O(1) 占位高度计算
// 替代原 O(n) 遍历,1000+ 条消息滚动性能显著提升
// prefixSums[i] = 前 i 个 item 的累计高度;item i 的顶部位置 = prefixSums[i]
const prefixSums = shallowRef<Float64Array | null>(null)
// 已测量 item 的平均高度(非响应式,仅 rebuildPrefixSums 内部使用)
let avgMeasuredHeight = ESTIMATED_ITEM_HEIGHT
let rebuildRafId: number | null = null

// 滚动锚定:用户是否在底部(用于决定新消息是否自动跟随)
const isAtBottom = ref(true)
const showScrollToBottomBtn = ref(false)
const newMsgCountWhileAway = ref(0)
const lastSeenLength = ref(0)

interface WindowedItems {
  items: DisplayItem[]
  topPlaceholderHeight: number
  bottomPlaceholderHeight: number
}

/**
 * 重建前缀和数组 + 计算已测量 item 平均高度
 * 调用时机:ResizeObserver 测量到新高度后、fullDisplayItems 长度变化后
 * 复杂度 O(n),但 Float64Array 数组运算极快(1000 项 < 0.1ms)
 */
function rebuildPrefixSums(): void {
  rebuildRafId = null
  const total = fullDisplayItems.value.length
  if (total === 0) {
    prefixSums.value = null
    avgMeasuredHeight = ESTIMATED_ITEM_HEIGHT
    return
  }
  // 计算已测量 item 的平均高度,作为未测量 item 的估算值(比固定 80px 更精准)
  let measuredTotal = 0
  let measuredCount = 0
  measuredHeights.forEach((h) => {
    measuredTotal += h
    measuredCount++
  })
  avgMeasuredHeight = measuredCount > 0
    ? measuredTotal / measuredCount
    : ESTIMATED_ITEM_HEIGHT

  // 构建前缀和:prefixSums[i] = sum of height(item[0..i-1])
  const sums = new Float64Array(total + 1)
  sums[0] = 0
  const avg = avgMeasuredHeight
  for (let i = 0; i < total; i++) {
    sums[i + 1] = sums[i] + (measuredHeights.get(i) ?? avg)
  }
  prefixSums.value = sums
}

/**
 * rAF 合并重建:同一帧内多次测量变化只重建一次前缀和
 */
function scheduleRebuildPrefixSums(): void {
  if (rebuildRafId !== null) return
  rebuildRafId = requestAnimationFrame(rebuildPrefixSums)
}

/**
 * 二分查找:定位 scrollTop 对应的 item 索引
 * 找到最大的 i 使得 prefixSums[i] <= scrollTop
 * 复杂度 O(log n),替代原 O(n) 遍历
 */
function findIndexAtScroll(scrollTop: number): number {
  const sums = prefixSums.value
  if (!sums || sums.length <= 1) return 0
  let lo = 0
  let hi = sums.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (sums[mid] <= scrollTop) lo = mid
    else hi = mid - 1
  }
  return lo
}

const windowedDisplayItems = computed<WindowedItems>(() => {
  const all = fullDisplayItems.value
  const total = all.length
  // 流式输出期间,最后一条消息(正在生成)必须始终在窗口内,确保用户可见
  // 此处通过 visibleEnd 至少覆盖到 total-1 实现
  let end = Math.min(visibleEnd.value, total)
  // 若在底部跟随状态,强制 end 覆盖到最后一条
  if (isAtBottom.value && end < total) end = total
  const start = Math.min(visibleStart.value, end)
  const items: DisplayItem[] = []
  for (let i = start; i < end; i++) {
    items.push({ ...all[i], _windowIndex: i })
  }
  // O(1) 占位高度:前缀和直接取值,替代原 O(n) 遍历累加
  const sums = prefixSums.value
  const topPlaceholderHeight = sums ? sums[start] : 0
  const bottomPlaceholderHeight = sums ? sums[total] - sums[end] : 0
  return { items, topPlaceholderHeight, bottomPlaceholderHeight }
})

/**
 * 根据滚动位置更新可见窗口
 * 性能:rAF 节流 + 二分查找 O(log n),同一帧内多次 scroll 只计算一次
 */
function updateVisibleRange(): void {
  const container = messagesContainer.value
  if (!container) return
  const scroll = container.querySelector('.messages-scroll') as HTMLElement | null
  if (!scroll) return
  const scrollTop = scroll.scrollTop
  const viewportH = scroll.clientHeight
  const all = fullDisplayItems.value
  const total = all.length
  if (total === 0) return

  const sums = prefixSums.value
  if (!sums) return

  // 二分查找 O(log n) 定位 scrollTop 和视口底部对应的 item 索引
  const estimatedStart = findIndexAtScroll(scrollTop)
  const estimatedEnd = findIndexAtScroll(scrollTop + viewportH)

  const newStart = Math.max(0, estimatedStart - WINDOW_BUFFER)
  let newEnd = Math.min(total, estimatedEnd + WINDOW_BUFFER)
  // 流式跟随状态:确保窗口覆盖到底部
  if (isAtBottom.value) newEnd = total
  if (newStart !== visibleStart.value || newEnd !== visibleEnd.value) {
    visibleStart.value = newStart
    visibleEnd.value = newEnd
  }
}

function onScroll(): void {
  const container = messagesContainer.value
  if (!container) return
  const scroll = container.querySelector('.messages-scroll') as HTMLElement | null
  if (!scroll) return
  // 更新 isAtBottom(距底部 < 60px 视为在底部)
  const distanceToBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight
  const wasAtBottom = isAtBottom.value
  isAtBottom.value = distanceToBottom < 60
  // 从底部离开时,重置新消息计数
  if (wasAtBottom && !isAtBottom.value) {
    showScrollToBottomBtn.value = true
  }
  // 回到底部时,清除按钮和计数
  if (!wasAtBottom && isAtBottom.value) {
    showScrollToBottomBtn.value = false
    newMsgCountWhileAway.value = 0
  }
  // rAF 节流更新窗口
  if (scrollRafId !== null) return
  scrollRafId = requestAnimationFrame(() => {
    scrollRafId = null
    updateVisibleRange()
  })
}

function jumpToBottom(): void {
  scrollToBottom()
  isAtBottom.value = true
  showScrollToBottomBtn.value = false
  newMsgCountWhileAway.value = 0
  // 跳到底部时扩展窗口覆盖到底部
  visibleEnd.value = fullDisplayItems.value.length
}

const hasA2UISurfaces = computed(() => Object.keys(props.a2uiSurfaces).length > 0)

function scrollToBottom(): void {
  const c = messagesContainer.value
  if (c) {
    const scroll = c.querySelector('.messages-scroll') as HTMLElement | null
    if (scroll) scroll.scrollTop = scroll.scrollHeight
  }
}

// 性能优化:思考动画用 RAF + 时间戳替代 setInterval,与浏览器刷新率同步,避免抖动
let dotRafId: number | null = null
let dotStartTime = 0
let dotCount = 0
const DOT_INTERVAL_MS = 400

function dotLoop(ts: number): void {
  if (dotRafId === null) return
  if (ts - dotStartTime >= DOT_INTERVAL_MS) {
    dotCount = (dotCount + 1) % 4
    dotText.value = '.'.repeat(dotCount)
    dotStartTime = ts
  }
  dotRafId = requestAnimationFrame(dotLoop)
}

function startDotAnimation(): void {
  stopDotAnimation()
  dotCount = 0
  dotStartTime = 0
  dotRafId = requestAnimationFrame(dotLoop)
}

function stopDotAnimation(): void {
  if (dotRafId !== null) {
    cancelAnimationFrame(dotRafId)
    dotRafId = null
  }
  dotText.value = ''
}

let scrollTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 性能优化:滚动锚定
 * 仅当用户在底部跟随状态时才自动滚到底部
 * 用户向上滚动浏览历史时,新消息不会强制拉回视图,改为显示"回到底部"按钮 + 新消息计数
 */
function scheduleScrollToBottom() {
  // 用户不在底部时,不自动跟随,只累加新消息计数
  if (!isAtBottom.value) {
    const newCount = props.messages.length - lastSeenLength.value
    if (newCount > 0) newMsgCountWhileAway.value += newCount
    lastSeenLength.value = props.messages.length
    return
  }
  lastSeenLength.value = props.messages.length
  if (scrollTimer) clearTimeout(scrollTimer)
  scrollTimer = setTimeout(() => nextTick(scrollToBottom), 50)
}

// 合并所有滚动到底部的 watch，用 watchDebounced 替代 deep watch
watchDebounced(() => props.messages.length, () => scheduleScrollToBottom(), { debounce: 50 })
watchDebounced(() => Object.keys(props.a2uiSurfaces).length, () => scheduleScrollToBottom(), { debounce: 50 })
watchDebounced(() => deepSegments.value.length, () => scheduleScrollToBottom(), { debounce: 50 })
watch(() => finalOutput.value, () => scheduleScrollToBottom())

// 消息列表长度变化时(新消息到来/筛选切换),重建前缀和
// immediate: true 保证组件初始化时就构建一次前缀和
watch(() => fullDisplayItems.value.length, () => {
  scheduleRebuildPrefixSums()
}, { immediate: true })

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
}

/* 性能优化:窗口化占位符 - 不参与可见布局,仅撑开滚动条高度 */
.window-placeholder {
  width: 100%;
  flex-shrink: 0;
  pointer-events: none;
}

/* 回到底部按钮 - 用户向上滚动浏览历史时显示 */
.scroll-to-bottom-btn {
  position: absolute;
  right: 24px;
  bottom: 24px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid var(--agent-border, rgba(255, 255, 255, 0.1));
  background: var(--agent-bg, rgba(30, 30, 30, 0.9));
  color: var(--agent-text, #fff);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  transition: background 0.15s, transform 0.15s;
  z-index: 20;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.scroll-to-bottom-btn:hover {
  background: color-mix(in srgb, var(--agent-primary, #3b82f6) 15%, var(--agent-bg, rgba(30, 30, 30, 0.9)));
  transform: translateY(-2px);
}

.scroll-to-bottom-btn:active {
  transform: translateY(0);
}

.new-msg-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--agent-primary, #3b82f6);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 0 2px var(--agent-bg, rgba(30, 30, 30, 0.9));
}

/* 回到底部按钮淡入淡出 */
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
