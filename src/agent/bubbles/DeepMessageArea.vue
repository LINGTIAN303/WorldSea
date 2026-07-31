<!--
  DeepMessageArea：深度思考模式消息区域
  从 AgentMessageBubble.vue 拆分。负责深度模式下的段标签、推理过程、
  阶段化工具卡片、图片/文件、正文 Markdown、活动日志、操作栏、Manuscript 渲染。
-->
<template>
  <div
    class="deep-area"
    :class="deepSegmentType"
    :data-msg-id="msg.id"
    @mouseenter="emit('hover', msg.id)"
    @mouseleave="emit('leave')"
    @click="onMentionClick"
  >
    <!-- 段标签 -->
    <div class="deep-segment-label" :class="deepSegmentType">
      <WsIcon :name="deepSegmentIcon" size="xs" />
      <span>{{ deepSegmentLabel }}</span>
    </div>

    <!-- 推理过程 -->
    <div v-if="msg.thinking" class="deep-thinking">
      <div class="deep-thinking-header">
        <span class="deep-thinking-title">推理过程</span>
        <button class="deep-thinking-toggle" @click="thinkingOpen = thinkingOpen === null ? !isThinkingOpen : !thinkingOpen">
          {{ isThinkingOpen ? '收起' : '展开' }}
        </button>
      </div>
      <div v-show="isThinkingOpen" class="deep-thinking-content">{{ msg.thinking }}</div>
    </div>

    <!-- 段分隔线（推理→工具） -->
    <div v-if="msg.thinking && msg.toolCalls?.length" class="deep-segment-divider"></div>

    <!-- 阶段头 + 内联工具卡片 -->
    <div v-if="msg.toolCalls?.length" class="deep-phases">
      <template v-for="group in deepPhaseGroups" :key="group.label">
        <PhaseHeader
          :label="group.label"
          :index="group.index"
          :tools="group.tools"
          :is-active="group.isActive"
          :is-done="group.isDone"
          :default-expanded="group.isActive"
        />
        <div class="deep-phase-tools">
          <InlineToolCall v-for="tc in group.tools" :key="tc.id" :tc="tc" />
        </div>
      </template>
    </div>

    <!-- 段分隔线（工具→输出 或 推理→输出） -->
    <div v-if="(msg.toolCalls?.length || msg.thinking) && msg.content" class="deep-segment-divider"></div>

    <!-- 图片 -->
    <div v-if="msg.images?.length" class="deep-images">
      <img v-for="(img, idx) in msg.images" :key="idx" :src="`data:${img.mimeType};base64,${img.data}`" class="deep-img" />
    </div>

    <!-- 文件 -->
    <div v-if="msg.files?.length" class="deep-files">
      <div v-for="(file, idx) in msg.files" :key="idx" class="deep-file-item">
        <span class="deep-file-icon"><WsIcon name="manuscript" size="xs" /></span>
        <span class="deep-file-name">{{ file.name }}</span>
      </div>
    </div>

    <!-- 正文内容 -->
    <div class="deep-text" :style="agentFontStyle">
      <div class="deep-text-content" :class="{ 'text-collapsed': !textExpanded && isTextLong }">
        <div v-html="renderedMarkdown"></div>
      </div>
      <div v-if="isTextLong" class="text-expand-btn" @click="textExpanded = !textExpanded">
        {{ textExpanded ? '收起' : '展开全文' }}
      </div>
      <MessageBlocks :blocks="msg.blocks" @block-action="emit('blockAction', $event)" />
    </div>

    <!-- 内联活动日志 -->
    <div v-if="deepActivityLogs.length > 0" class="deep-activity">
      <div class="deep-activity-header">
        <WsIcon name="clipboard-list" size="xs" />
        <span>活动记录</span>
        <span class="deep-activity-count">{{ deepActivityLogs.length }}</span>
      </div>
      <div class="deep-activity-list">
        <div v-for="log in deepActivityLogs" :key="log.id" class="deep-activity-item" :class="`log-${log.type}`">
          <span class="deep-activity-dot"></span>
          <span class="deep-activity-msg">{{ log.message }}</span>
          <span class="deep-activity-time">{{ formatActivityTime(log.timestamp) }}</span>
        </div>
      </div>
    </div>

    <!-- 操作栏 -->
    <div class="deep-actions" :class="{ visible: isHovered }">
      <button class="action-btn" @click="emit('copy', msg)" title="复制"><WsIcon name="outline" size="xs" /></button>
      <button class="action-btn" @click="onExportImage" title="导出为图片"><WsIcon name="image" size="xs" /></button>
      <button class="action-btn" @click="onExportGif" title="导出为GIF"><WsIcon name="video" size="xs" /></button>
      <span class="msg-time">{{ formatTime(msg.timestamp) }}</span>
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
import WsIcon from '../../ui/WsIcon.vue'
import BlockManuscript from '../blocks/BlockManuscript.vue'
import InlineToolCall from '../blocks/InlineToolCall.vue'
import PhaseHeader from '../blocks/PhaseHeader.vue'
import MessageBlocks from './MessageBlocks.vue'
import { usePersonaFont } from '../../space/composables/usePersonaFont'
import { useActivityLog } from '../../space/composables/useActivityLog'
import { useFontStore } from '../../stores/fontStore'
import { useEntityMiniPanel } from '../composables/useEntityMiniPanel'
import { useMarkdownRender } from './useMarkdownRender'
import { useMessageExport } from './useMessageExport'
import { formatTime, formatActivityTime } from './format'
import { DEEP_PHASES, ALL_PHASE_TOOLS, type PhaseGroup } from './deepPhases'
import type { AgentMessage, BlockActionEvent, DeepSegmentType } from './types'

const props = defineProps<{
  msg: AgentMessage
  isHovered: boolean
}>()

const emit = defineEmits<{
  (e: 'hover', msgId: string): void
  (e: 'leave'): void
  (e: 'copy', msg: AgentMessage): void
  (e: 'blockAction', event: BlockActionEvent): void
  (e: 'manuscriptLocalAction', event: BlockActionEvent): void
}>()

// ===== 字体样式 =====
const { fontFamily } = usePersonaFont()
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

// ===== Markdown 渲染（含实体 mention 注入） =====
const { renderedMarkdown } = useMarkdownRender(() =>
  props.msg.role === 'assistant' ? props.msg.content : ''
)

// ===== 实体 mention 点击：打开实体小窗浮窗 =====
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

// ===== 推理过程展开状态 =====
const thinkingOpen = ref<boolean | null>(null)
// 深度模式默认展开推理过程
const isThinkingOpen = computed(() => {
  if (thinkingOpen.value !== null) return thinkingOpen.value
  return true
})

// ===== 正文折叠 =====
const textExpanded = ref(false)
const isTextLong = computed(() => {
  if (!props.msg?.content) return false
  const lines = props.msg.content.split('\n').length
  const charLen = props.msg.content.length
  return lines > 8 || charLen > 600
})

// ===== 深度模式段类型（推理/工具/输出） =====
const deepSegmentType = computed<DeepSegmentType>(() => {
  if (props.msg.thinking && !props.msg.content && !props.msg.toolCalls?.length) return 'thinking'
  if (props.msg.toolCalls?.length && !props.msg.content) return 'tooling'
  return 'output'
})
const deepSegmentLabel = computed(() => {
  switch (deepSegmentType.value) {
    case 'thinking': return '推理过程'
    case 'tooling': return '调用工具'
    case 'output': return '输出'
    default: return '输出'
  }
})
const deepSegmentIcon = computed(() => {
  switch (deepSegmentType.value) {
    case 'thinking': return 'manuscript'
    case 'tooling': return 'wrench'
    case 'output': return 'file'
    default: return 'file'
  }
})

// ===== 深度模式：工具调用按阶段分组 =====
const deepPhaseGroups = computed<PhaseGroup[]>(() => {
  if (!props.msg?.toolCalls?.length) return []
  const toolCalls = props.msg.toolCalls

  // 将每个工具分配到阶段
  const phaseToolMap = DEEP_PHASES.map(phase =>
    toolCalls.filter(tc => phase.tools.includes(tc.name))
  )
  // 兜底：未匹配的工具归入"其他操作"
  const unmatched = toolCalls.filter(tc => !ALL_PHASE_TOOLS.has(tc.name))

  const groups: PhaseGroup[] = []
  let activeFound = false

  DEEP_PHASES.forEach((phase, idx) => {
    const tools = phaseToolMap[idx]
    if (tools.length === 0) return // 跳过空阶段
    const hasRunning = tools.some(tc => tc.status === 'running')
    const allDone = tools.every(tc => tc.status === 'completed' || tc.status === 'failed')
    const isActive = !activeFound && (hasRunning || !allDone)
    if (isActive) activeFound = true
    groups.push({
      label: phase.label,
      index: groups.length,
      tools,
      isActive,
      isDone: allDone,
    })
  })

  // 兜底阶段
  if (unmatched.length > 0) {
    const hasRunning = unmatched.some(tc => tc.status === 'running')
    const allDone = unmatched.every(tc => tc.status === 'completed' || tc.status === 'failed')
    const isActive = !activeFound && (hasRunning || !allDone)
    groups.push({
      label: '其他操作',
      index: groups.length,
      tools: unmatched,
      isActive,
      isDone: allDone,
    })
  }

  return groups
})

// ===== 活动日志（消息时间窗口内） =====
const { logs: activityLogs } = useActivityLog()
const deepActivityLogs = computed(() => {
  const msgTime = props.msg.timestamp
  const window = 120_000 // 2分钟窗口
  return activityLogs.value.filter(log =>
    log.timestamp >= msgTime - 5_000 && log.timestamp <= msgTime + window
  )
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
/* ===== 深度思考模式：区域布局 ===== */
.deep-area {
  width: 100%;
  max-width: 100%;
  padding: 16px 20px;
  border-left: 3px solid var(--agent-primary);
  background: color-mix(in srgb, var(--agent-primary) 3%, transparent);
  border-radius: 0 12px 12px 0;
  animation: deep-area-in 0.35s cubic-bezier(0.16, 1, 0.3, 1);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 段标签 */
.deep-segment-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
  width: fit-content;
}

.deep-segment-label.thinking {
  color: var(--agent-segment-thinking);
  background: color-mix(in srgb, var(--agent-segment-thinking) 10%, transparent);
}

.deep-segment-label.tooling {
  color: var(--agent-segment-tooling);
  background: color-mix(in srgb, var(--agent-segment-tooling) 10%, transparent);
}

.deep-segment-label.output {
  color: var(--agent-segment-output);
  background: color-mix(in srgb, var(--agent-segment-output) 10%, transparent);
}

/* 段类型边框色 */
.deep-area.thinking {
  border-left-color: var(--agent-segment-thinking);
  background: color-mix(in srgb, var(--agent-segment-thinking) 3%, transparent);
}

.deep-area.tooling {
  border-left-color: var(--agent-segment-tooling);
  background: color-mix(in srgb, var(--agent-segment-tooling) 3%, transparent);
}

.deep-area.output {
  border-left-color: var(--agent-segment-output);
  background: color-mix(in srgb, var(--agent-segment-output) 3%, transparent);
}

/* 段内分隔线 */
.deep-segment-divider {
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    var(--agent-hover-bg) 10%,
    var(--agent-hover-bg) 90%,
    transparent
  );
  margin: 2px 0;
}

@keyframes deep-area-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

/* 推理过程 */
.deep-thinking {
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--agent-primary) 15%, transparent);
  background: color-mix(in srgb, var(--agent-primary) 4%, transparent);
}

.deep-thinking-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: color-mix(in srgb, var(--agent-primary) 6%, transparent);
  color: var(--agent-primary);
  font-size: 13px;
  font-weight: 600;
}

.deep-thinking-title {
  flex: 1;
}

.deep-thinking-toggle {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, var(--agent-primary) 20%, transparent);
  background: color-mix(in srgb, var(--agent-primary) 8%, transparent);
  color: var(--agent-primary);
  cursor: pointer;
  transition: background 0.15s;
}

.deep-thinking-toggle:hover {
  background: color-mix(in srgb, var(--agent-primary) 15%, transparent);
}

.deep-thinking-content {
  padding: 10px 14px;
  font-size: var(--font-size-sm);
  color: var(--agent-text-secondary);
  line-height: 1.6;
  white-space: pre-wrap;
  max-height: 400px;
  overflow-y: auto;
  word-break: break-word;
}

/* 阶段+内联工具卡片 */
.deep-phases {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.deep-phase-tools {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-left: 12px;
  border-left: 2px solid var(--agent-hover-bg);
  margin-left: 10px;
}

/* 图片 */
.deep-images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.deep-img {
  max-width: 280px;
  max-height: 200px;
  border-radius: 8px;
  object-fit: contain;
  cursor: pointer;
  transition: transform 0.15s;
}

.deep-img:hover {
  transform: scale(1.03);
}

/* 文件 */
.deep-files {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.deep-file-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: var(--agent-hover-bg);
  border: 1px solid var(--agent-hover-bg);
  border-radius: 8px;
  font-size: var(--font-size-sm);
  color: var(--agent-text-secondary);
}

.deep-file-icon { font-size: var(--font-size-sm); }

.deep-file-name {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 正文 */
.deep-text {
  font-size: var(--font-size-base);
  line-height: 1.7;
  color: var(--agent-text);
  word-break: break-word;
  font-family: var(--agent-font);
}

.deep-text-content {
  position: relative;
}

.deep-text-content.text-collapsed {
  max-height: 200px;
  overflow: hidden;
}

.deep-text-content.text-collapsed::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 56px;
  background: linear-gradient(transparent, color-mix(in srgb, var(--agent-primary) 3%, transparent));
  pointer-events: none;
}

.deep-text :deep(h1), .deep-text :deep(h2), .deep-text :deep(h3) {
  margin: 12px 0 6px;
  font-weight: var(--font-weight-semibold);
}

.deep-text :deep(h1) { font-size: var(--font-size-xl) }
.deep-text :deep(h2) { font-size: var(--font-size-lg) }
.deep-text :deep(h3) { font-size: var(--font-size-md) }
.deep-text :deep(p) { margin: 6px 0 }
.deep-text :deep(ul), .deep-text :deep(ol) { margin: 6px 0; padding-left: 22px }
.deep-text :deep(li) { margin: 3px 0 }
.deep-text :deep(code) {
  background: var(--agent-hover-bg);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: var(--font-size-sm);
  font-family: 'Consolas', 'Monaco', monospace;
}

.deep-text :deep(pre) {
  background: color-mix(in srgb, var(--agent-bg) 20%, transparent);
  padding: 12px 14px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 10px 0;
}
.deep-text :deep(pre code) { background: none; padding: 0; font-size: var(--font-size-sm); line-height: 1.5 }
.deep-text :deep(blockquote) {
  border-left: 3px solid var(--agent-primary);
  margin: 8px 0; padding: 6px 14px; opacity: 0.85;
}
.deep-text :deep(table) { border-collapse: collapse; margin: 10px 0; font-size: var(--font-size-sm) }
.deep-text :deep(th), .deep-text :deep(td) {
  border: 1px solid var(--agent-border-color); padding: 6px 10px;
}
.deep-text :deep(a) { color: var(--agent-primary); text-decoration: underline }
.deep-text :deep(hr) { border: none; border-top: 1px solid var(--agent-border-color); margin: 10px 0 }

/* 活动日志 */
.deep-activity {
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--agent-hover-bg);
  background: var(--agent-hover-bg);
}

.deep-activity-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--agent-text-secondary);
  border-bottom: 1px solid var(--agent-hover-bg);
}

.deep-activity-count {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--agent-primary) 10%, transparent);
  color: var(--agent-primary);
  margin-left: auto;
}

.deep-activity-list {
  padding: 4px 0;
  max-height: 160px;
  overflow-y: auto;
}

.deep-activity-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  font-size: 11px;
  transition: background 0.1s;
}

.deep-activity-item:hover {
  background: var(--agent-hover-bg);
}

.deep-activity-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--agent-text-tertiary);
}

.deep-activity-item.log-tool .deep-activity-dot { background: var(--agent-primary); }
.deep-activity-item.log-knowledge .deep-activity-dot { background: var(--agent-success); }
.deep-activity-item.log-memory .deep-activity-dot { background: var(--agent-warning); }
.deep-activity-item.log-error .deep-activity-dot { background: var(--agent-danger); }

.deep-activity-msg {
  flex: 1;
  color: var(--agent-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.deep-activity-time {
  font-size: 10px;
  color: var(--agent-text-tertiary);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

/* 操作栏 */
.deep-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.15s;
  height: 20px;
}

.deep-actions.visible { opacity: 1 }

/* 共用：操作按钮、时间、展开按钮、实体 mention */
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
