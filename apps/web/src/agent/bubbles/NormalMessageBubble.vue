<!--
  NormalMessageBubble：普通模式消息气泡
  从 AgentMessageBubble.vue 拆分。负责头像、思维链、图片/文件、工具调用标签、
  正文 Markdown（含 Block）、用户消息知识引用 chip、操作栏、Manuscript 渲染。
-->
<template>
  <div
    class="chat-msg"
    :class="[`msg-${msg.role}`, msg.role === 'assistant' ? `anim-${enterAnimation}` : '']"
    :data-msg-id="msg.id"
    @mouseenter="emit('hover', msg.id)"
    @mouseleave="emit('leave')"
    @click="onMentionClick"
  >
    <AvatarBadge
      class="msg-avatar"
      :avatar="speaker.avatar"
      :name="speaker.name"
      :color="speaker.color"
      :font-family="speaker.fontFamily"
      :size="24"
      :shape="msg.role === 'user' ? 'rounded' : 'circle'"
    />
    <div class="msg-body" :style="msg.role === 'assistant' ? agentFontStyle : undefined">
      <div v-if="msg.thinking" class="msg-thinking" :class="{ 'thinking-deep': chatMode === 'deep' }">
        <details :open="isThinkingOpen" @toggle="(e: Event) => thinkingOpen = (e.target as HTMLDetailsElement).open">
          <summary><WsIcon name="manuscript" size="xs" /> {{ thinkingLabel }}</summary>
          <div class="thinking-content">{{ msg.thinking }}</div>
        </details>
      </div>
      <div v-if="msg.images?.length" class="msg-images">
        <img v-for="(img, idx) in msg.images" :key="idx" :src="`data:${img.mimeType};base64,${img.data}`" class="msg-img" />
      </div>
      <div v-if="msg.files?.length" class="msg-files">
        <div v-for="(file, idx) in msg.files" :key="idx" class="msg-file-item">
          <span class="msg-file-icon"><WsIcon name="manuscript" size="xs" /></span>
          <span class="msg-file-name">{{ file.name }}</span>
        </div>
      </div>
      <div v-if="msg.role === 'assistant'" class="msg-text">
        <div v-if="msg.toolCalls?.length" class="msg-tool-calls">
          <template v-if="chatMode === 'explore'">
            <SearchPath :tool-calls="msg.toolCalls" />
          </template>
          <template v-else>
            <template v-if="runningToolCalls.length > 0">
              <span v-for="tc in msg.toolCalls" :key="tc.id" class="tool-call-tag" :class="tc.status">
                <span v-if="tc.status === 'running'" class="tc-pulse">🔧</span>
                <span v-else-if="tc.status === 'completed'"><WsIcon name="check" size="xs" /></span>
                <span v-else><WsIcon name="x" size="xs" /></span>
                {{ getToolLabel(tc.name) }}
              </span>
            </template>
            <span v-else class="tool-call-summary">
              {{ completedCount }} 项调用已完成
            </span>
          </template>
        </div>
        <div class="msg-text-content" :class="{ 'text-collapsed': !textExpanded && isTextLong }">
          <div v-html="renderedMarkdown"></div>
        </div>
        <div v-if="isTextLong" class="text-expand-btn" @click="textExpanded = !textExpanded">
          {{ textExpanded ? '收起' : '展开全文' }}
        </div>
        <MessageBlocks :blocks="msg.blocks" @block-action="emit('blockAction', $event)" />
      </div>
      <div v-else class="msg-text">
        <template v-for="(seg, i) in userContentSegments" :key="i">
          <span v-if="seg.type === 'chip'" class="kb-chip-inline"><WsIcon name="file" size="xs" />{{ seg.label }}</span>
          <span v-else>{{ seg.text }}</span>
        </template>
      </div>
      <div class="msg-actions" :class="{ visible: isHovered }">
        <button class="action-btn" @click="emit('copy', msg)" title="复制"><WsIcon name="outline" size="xs" /></button>
        <button v-if="msg.role === 'user'" class="action-btn" @click="emit('retry', msg)" title="重试"><WsIcon name="delete" size="xs" /></button>
        <button v-if="msg.role === 'assistant'" class="action-btn" @click="onExportImage" title="导出为图片"><WsIcon name="image" size="xs" /></button>
        <button v-if="msg.role === 'assistant'" class="action-btn" @click="onExportGif" title="导出为GIF"><WsIcon name="video" size="xs" /></button>
        <span class="msg-time">{{ formatTime(msg.timestamp) }}</span>
      </div>
    </div>
    <BlockManuscript
      v-for="block in manuscriptBlocks"
      :key="block.id"
      :block="block"
      @action="emit('blockAction', $event)"
      @local-action="emit('manuscriptLocalAction', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, nextTick, watch } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import AvatarBadge from '../../ui/AvatarBadge.vue'
import BlockManuscript from '../blocks/BlockManuscript.vue'
import SearchPath from '../blocks/SearchPath.vue'
import MessageBlocks from './MessageBlocks.vue'
import { usePersonaFont } from '../../space/composables/usePersonaFont'
import { useFontStore } from '../../stores/fontStore'
import { useMessageSpeaker } from '../composables/useMessageSpeaker'
import { useEntityMiniPanel } from '../composables/useEntityMiniPanel'
import { useMarkdownRender } from './useMarkdownRender'
import { useMessageExport } from './useMessageExport'
import { formatTime } from './format'
import { getToolLabel } from './toolLabels'
import type { AgentMessage, BlockActionEvent, ChatMode } from './types'

const props = defineProps<{
  msg: AgentMessage
  isHovered: boolean
  chatMode?: ChatMode
}>()

const emit = defineEmits<{
  (e: 'hover', msgId: string): void
  (e: 'leave'): void
  (e: 'copy', msg: AgentMessage): void
  (e: 'retry', msg: AgentMessage): void
  (e: 'blockAction', event: BlockActionEvent): void
  (e: 'manuscriptLocalAction', event: BlockActionEvent): void
}>()

// ===== 发言者信息（头像/名称/颜色） =====
const speaker = useMessageSpeaker(() => props.msg)

// ===== 字体样式与入场动画 =====
const { fontFamily, enterAnimation } = usePersonaFont()
const fontStore = useFontStore()
const agentFontFamily = computed(() => fontStore.prefs.agent.family || fontFamily.value || '')
const agentFontStyle = computed(() => {
  const style: Record<string, string> = {}
  if (agentFontFamily.value) style.fontFamily = agentFontFamily.value
  const pref = fontStore.prefs.agent
  if (pref.family && pref.weight !== 400) style.fontWeight = String(pref.weight)
  if (pref.family && pref.style !== 'normal') style.fontStyle = pref.style
  return style
})

// ===== 聊天模式（优先 prop，其次 metadata，兜底 normal） =====
const chatMode = computed<ChatMode>(() =>
  props.chatMode || (props.msg?.metadata?.chatMode as ChatMode) || 'normal'
)

// ===== Markdown 渲染（含实体 mention 注入） =====
const { renderedMarkdown } = useMarkdownRender(() =>
  props.msg.role === 'assistant' ? props.msg.content : ''
)

// ===== 实体 mention 点击 =====
const miniPanel = useEntityMiniPanel()
function onMentionClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target) return
  const mention = target.closest('.ws-entity-mention') as HTMLElement | null
  if (!mention) return
  const entityId = mention.getAttribute('data-ws-entity-id')
  const entityType = mention.getAttribute('data-ws-entity-type') || ''
  const name = mention.getAttribute('data-ws-entity-name') || ''
  if (!entityId) return
  const triggerRect = mention.getBoundingClientRect()
  miniPanel.open(entityId, triggerRect, { entityType, name })
  e.stopPropagation()
}

// ===== 导出为图片/GIF =====
const { onExportImage, onExportGif } = useMessageExport(() => props.msg.content)

// ===== 思维链展开状态 =====
const thinkingLabel = computed(() => chatMode.value === 'explore' ? '搜索思路' : '推理链')
const thinkingDefaultOpen = computed(() => chatMode.value === 'deep')
const thinkingOpen = ref<boolean | null>(null)
const isThinkingOpen = computed(() => {
  if (thinkingOpen.value !== null) return thinkingOpen.value
  return thinkingDefaultOpen.value
})

// ===== 工具调用统计 =====
const runningToolCalls = computed(() =>
  props.msg?.toolCalls?.filter(tc => tc.status === 'running') ?? []
)
const completedCount = computed(() =>
  props.msg?.toolCalls?.filter(tc => tc.status === 'completed').length ?? 0
)

/** 解析用户消息中的 @path 引用为 chip + 文本片段 */
const userContentSegments = computed(() => {
  const content = props.msg?.content || ''
  if (!content) return []
  const segments: Array<{ type: 'text'; text: string } | { type: 'chip'; label: string }> = []
  // 匹配 @project/xxx 或 @xxx/yyy.md 格式的知识引用
  const pattern = /@([\w/.-]+\.md|[\w/.-]+\/[\w/.-]+\.\w+)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', text: content.slice(lastIndex, match.index) })
    }
    const fullPath = match[1]
    const label = fullPath.split('/').pop() || fullPath
    segments.push({ type: 'chip', label })
    lastIndex = pattern.lastIndex
  }
  if (lastIndex < content.length) {
    segments.push({ type: 'text', text: content.slice(lastIndex) })
  }
  return segments
})

// ===== 正文折叠 =====
const textExpanded = ref(false)
const isTextLong = computed(() => {
  if (!props.msg?.content) return false
  const lines = props.msg.content.split('\n').length
  const charLen = props.msg.content.length
  return lines > 8 || charLen > 600
})

// ===== manuscript blocks（贴顶渲染，不在正文内） =====
const manuscriptBlocks = computed(() =>
  (props.msg.blocks || []).filter(b => b.type === 'manuscript')
)

// ===== 扫描 [data-ws-font] 元素并应用内联字体样式 =====
function applyFontSpanStyles() {
  const el = document.querySelector(`[data-msg-id="${props.msg.id}"]`)
  if (!el) return
  const fontSpans = el.querySelectorAll('[data-ws-font]')
  for (const span of fontSpans) {
    const family = span.getAttribute('data-ws-font')
    const weight = span.getAttribute('data-ws-weight')
    const style = span.getAttribute('data-ws-style')
    if (family) {
      const htmlEl = span as HTMLElement
      htmlEl.style.fontFamily = `"${family}", sans-serif`
      if (weight && weight !== '400') htmlEl.style.fontWeight = weight
      if (style && style !== 'normal') htmlEl.style.fontStyle = style
    }
  }
}
watch(renderedMarkdown, () => {
  nextTick(applyFontSpanStyles)
})
</script>

<style scoped>
/* ===== 普通模式：气泡布局 ===== */
.chat-msg {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  max-width: 85%;
  animation: ws-msg-in 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.msg-user { margin-left: auto; flex-direction: row-reverse }

.msg-avatar {
  flex-shrink: 0;
}

.msg-assistant .msg-avatar {
  box-shadow: 0 0 6px color-mix(in srgb, var(--agent-primary) 30%, transparent);
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

.msg-user .msg-body { text-align: right }

.msg-thinking { margin-bottom: 6px }
.msg-thinking summary {
  cursor: pointer; font-size: var(--font-size-sm);
  color: var(--agent-text-secondary); padding: 2px 0;
}
.thinking-content {
  font-size: var(--font-size-sm);
  color: var(--agent-text-tertiary);
  line-height: 1.5; max-height: 200px; overflow-y: auto;
  padding: 6px 8px;
  background: var(--agent-hover-bg);
  border-radius: 6px; margin-top: 4px; white-space: pre-wrap;
}
.msg-thinking.thinking-deep {
  border-left: 3px solid var(--agent-primary);
  padding-left: 8px;
  margin-bottom: 8px;
}
.msg-thinking.thinking-deep .thinking-content {
  background: color-mix(in srgb, var(--agent-primary) 5%, transparent);
  border: 1px solid color-mix(in srgb, var(--agent-primary) 10%, transparent);
  max-height: 400px;
}
.msg-thinking.thinking-deep summary {
  color: var(--agent-primary);
  font-weight: 600;
}

.msg-images {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}

.msg-files {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
}

.msg-file-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  background: var(--agent-hover-bg);
  border: 1px solid var(--agent-hover-bg);
  border-radius: 6px;
  font-size: var(--font-size-sm);
  color: var(--agent-text-secondary);
}

.msg-file-icon {
  font-size: var(--font-size-sm);
}

.msg-file-name {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.msg-img {
  max-width: 200px;
  max-height: 160px;
  border-radius: 8px;
  object-fit: contain;
  cursor: pointer;
  transition: transform 0.15s;
}

.msg-img:hover {
  transform: scale(1.05);
}

.msg-text {
  max-width: 100%;
}

.msg-user .msg-text {
  display: inline-block;
  background: var(--agent-user-bubble);
  backdrop-filter: blur(8px);
  padding: 8px 12px;
  border-radius: 16px 16px 4px 16px;
  text-align: left;
}

.kb-chip-inline {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 7px;
  background: color-mix(in srgb, var(--agent-info) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--agent-info) 30%, transparent);
  border-radius: 8px;
  font-size: 11px;
  color: color-mix(in srgb, var(--agent-info) 90%, transparent);
  vertical-align: middle;
  white-space: nowrap;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.msg-assistant .msg-text {
  display: inline-block;
  background: transparent;
  backdrop-filter: blur(var(--agent-lens-blur));
  -webkit-backdrop-filter: blur(var(--agent-lens-blur));
  padding: 6px 12px 6px 10px;
  border-left: 2px solid var(--agent-primary);
  border-radius: 0 8px 8px 0;
}

.msg-text-content {
  position: relative;
}

.msg-text-content.text-collapsed {
  max-height: 160px;
  overflow: hidden;
}

.msg-text-content.text-collapsed::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 48px;
  background: linear-gradient(transparent, var(--agent-bg));
  pointer-events: none;
}

.text-expand-btn {
  display: inline-block;
  padding: 2px 8px;
  margin-top: 4px;
  border-radius: 8px;
  font-size: 11px;
  color: var(--agent-accent);
  background: color-mix(in srgb, var(--agent-primary) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--agent-primary) 15%, transparent);
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}

.text-expand-btn:hover {
  background: color-mix(in srgb, var(--agent-primary) 15%, transparent);
}

.msg-text :deep(h1), .msg-text :deep(h2), .msg-text :deep(h3) {
  margin: 8px 0 4px; font-weight: var(--font-weight-semibold);
}
.msg-text :deep(h1) { font-size: var(--font-size-xl) }
.msg-text :deep(h2) { font-size: var(--font-size-lg) }
.msg-text :deep(h3) { font-size: var(--font-size-md) }
.msg-text :deep(p) { margin: 4px 0 }
.msg-text :deep(ul), .msg-text :deep(ol) { margin: 4px 0; padding-left: 20px }
.msg-text :deep(li) { margin: 2px 0 }
.msg-text :deep(code) {
  background: var(--agent-hover-bg);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: var(--font-size-sm);
  font-family: 'Consolas', 'Monaco', monospace;
}
.msg-text :deep(pre) {
  background: color-mix(in srgb, var(--agent-bg) 25%, transparent);
  padding: 10px 12px;
  border-radius: var(--agent-radius-sm);
  overflow-x: auto;
  margin: 8px 0;
}
.msg-text :deep(pre code) { background: none; padding: 0; font-size: var(--font-size-sm); line-height: 1.5 }
.msg-text :deep(blockquote) {
  border-left: 3px solid var(--agent-primary);
  margin: 6px 0; padding: 4px 12px; opacity: 0.85;
}
.msg-text :deep(table) { border-collapse: collapse; margin: 8px 0; font-size: var(--font-size-sm) }
.msg-text :deep(th), .msg-text :deep(td) {
  border: 1px solid var(--agent-border-color); padding: 4px 8px;
}
.msg-text :deep(a) { color: var(--agent-primary); text-decoration: underline }
.msg-text :deep(hr) { border: none; border-top: 1px solid var(--agent-border-color); margin: 8px 0 }

.msg-tool-calls { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
.tool-call-tag {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 2px 8px; border-radius: 10px; font-size: 11px;
  background: var(--agent-hover-bg); border: 1px solid var(--agent-hover-bg);
  color: var(--agent-text-secondary);
}
.tool-call-tag.completed { border-color: color-mix(in srgb, var(--agent-success) 30%, transparent); color: var(--agent-success); opacity: 0.7; }
.tool-call-tag.failed { border-color: color-mix(in srgb, var(--agent-danger) 30%, transparent); color: var(--agent-danger); }
.tool-call-summary {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 2px 8px; border-radius: 10px; font-size: 11px;
  background: color-mix(in srgb, var(--agent-success) 8%, transparent); border: 1px solid color-mix(in srgb, var(--agent-success) 20%, transparent);
  color: color-mix(in srgb, var(--agent-success) 80%, transparent);
}
.tc-pulse { animation: ws-pulse 1.5s infinite; }

.msg-actions {
  display: flex; align-items: center; gap: 4px;
  margin-top: 2px; opacity: 0; transition: opacity 0.15s; height: 20px;
}
.msg-actions.visible { opacity: 1 }

.action-btn {
  background: none; border: none; cursor: pointer; font-size: var(--font-size-sm);
  padding: 2px 4px; border-radius: 4px; opacity: 0.6; transition: opacity 0.1s;
}
.action-btn:hover { opacity: 1 }

.msg-time {
  font-size: var(--font-size-xs);
  color: var(--agent-text-tertiary);
  margin-left: auto;
}

/* 入场动画 */
.chat-msg.anim-fadeIn { animation: ws-fade-in 0.3s ease-out }
.chat-msg.anim-slideIn { animation: ws-slide-in 0.3s cubic-bezier(0.16, 1, 0.3, 1) }
.chat-msg.anim-typewriter { animation: ws-fade-in 0.15s ease-out }
.chat-msg.anim-pulse { animation: ws-pulse-in 0.4s ease-out }
.chat-msg.anim-bounce { animation: ws-bounce-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) }
.chat-msg.anim-wave { animation: ws-wave-in 0.5s ease-out }

@keyframes ws-fade-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes ws-slide-in { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } }
@keyframes ws-pulse-in { 0% { opacity: 0; transform: scale(0.95) } 50% { transform: scale(1.02) } 100% { opacity: 1; transform: scale(1) } }
@keyframes ws-bounce-in { from { opacity: 0; transform: translateY(12px) } to { opacity: 1; transform: translateY(0) } }
@keyframes ws-wave-in { 0% { opacity: 0; transform: translateX(-8px) } 100% { opacity: 1; transform: translateX(0) } }

/* Manuscript 画布布局：放宽气泡宽度 */
.chat-msg:has(.manuscript-canvas) {
  max-width: 98%;
  flex-wrap: nowrap;
}

.chat-msg:has(.manuscript-canvas) .msg-body {
  overflow: visible;
  flex: 0 1 auto;
  min-width: 0;
}

.chat-msg:has(.manuscript-canvas) .manuscript-canvas {
  flex: 1 1 0;
  min-width: 280px;
  max-width: 60%;
  margin-left: auto;
}

/* 实体名 mention 高亮：用 :deep() 穿透 v-html 渲染的 DOM */
:deep(.ws-entity-mention) {
  color: var(--agent-accent, #b388ff);
  background: rgba(108, 92, 231, 0.1);
  border-radius: 3px;
  padding: 0 3px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  font-weight: 500;
  border-bottom: 1px dashed var(--agent-accent, #b388ff);
}
:deep(.ws-entity-mention:hover) {
  background: rgba(108, 92, 231, 0.25);
  color: var(--agent-text, #e0e0e0);
  border-bottom-style: solid;
}
</style>
