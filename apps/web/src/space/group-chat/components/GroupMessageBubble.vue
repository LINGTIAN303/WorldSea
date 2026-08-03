<template>
  <div v-if="msg.role === 'system'" class="group-msg system-msg">
    <span class="system-text">{{ msg.content }}</span>
  </div>
  <div v-else class="group-msg" :class="[`msg-${msg.role}`]" style="animation: msg-slide-in 0.25s cubic-bezier(0.16, 1, 0.3, 1);">
    <div v-if="msg.role === 'assistant'" class="msg-speaker" :style="{ '--speaker-color': msg.speakerColor || '#888' }">
      <AvatarBadge
        class="speaker-avatar"
        :avatar="msg.speakerAvatar"
        :name="msg.speakerName"
        :color="msg.speakerColor || '#888'"
        :size="28"
      />
      <span class="speaker-name">{{ msg.speakerName || 'Agent' }}</span>
    </div>
    <div class="msg-body" :style="msgBodyStyle">
      <div v-if="msg.thinking" class="msg-thinking" :style="{ '--speaker-color': msg.speakerColor || 'var(--color-primary)' }">
        <details>
          <summary>思考过程</summary>
          <div class="thinking-content">{{ msg.thinking }}</div>
        </details>
      </div>
      <!-- Layer 2: 动作标签行 -->
      <div v-if="msg.toolCalls && msg.toolCalls.length > 0" class="msg-tool-calls">
        <span
          v-for="tc in msg.toolCalls"
          :key="tc.id"
          class="tool-call-tag"
          :class="[tc.status, getToolImportanceClass(tc.name)]"
          @click="toggleToolDetail(tc.id)"
        >
          <WsIcon v-if="tc.status === 'running'" name="loader" size="xs" class="tc-spin" />
          <WsIcon v-else-if="tc.status === 'completed'" name="check" size="xs" />
          <WsIcon v-else name="x" size="xs" />
          <WsIcon :name="getToolIcon(tc.name)" size="xs" />
          {{ getToolLabel(tc.name) }}
        </span>
      </div>
      <!-- 工具调用详情（折叠） -->
      <div v-for="tc in msg.toolCalls" :key="`detail-${tc.id}`">
        <div v-if="expandedToolId === tc.id" class="tool-detail">
          <div v-if="tc.args && Object.keys(tc.args).length > 0" class="tool-detail-section">
            <span class="tool-detail-label">参数</span>
            <pre class="tool-detail-content">{{ formatToolArgs(tc.args) }}</pre>
          </div>
          <div v-if="tc.result" class="tool-detail-section">
            <span class="tool-detail-label">结果</span>
            <pre class="tool-detail-content">{{ tc.result }}</pre>
          </div>
        </div>
      </div>
      <div class="msg-text" :class="{ 'has-uncertainty': hasUncertainty }">
        <div v-if="msg.role === 'assistant'" class="msg-text-content" :class="{ 'text-collapsed': !textExpanded && isLong }">
          <div v-html="renderedContent"></div>
        </div>
        <div v-else v-html="renderedUserContent"></div>
        <span v-if="hasUncertainty" class="uncertainty-badge">待确认</span>
      </div>
      <div v-if="isLong" class="text-expand-btn" @click="textExpanded = !textExpanded">
        {{ textExpanded ? '收起' : '展开全文' }}
      </div>
      <div class="msg-actions">
        <button class="action-btn" @click="onCopy" title="复制"><WsIcon name="copy" size="xs" /></button>
        <span class="msg-time">{{ formatTime(msg.timestamp) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AgentMessage } from '@agent/index'
import { hasUncertaintyMarkers } from '../HallucinationGuard'
import { useMessageRender } from '../composables/useMessageRender'
import { useMessageTime } from '../composables/useMessageTime'
import { getToolLabel, getToolIcon, getToolImportance } from '../types'
import { WsIcon } from '@worldsmith/ui-kit'
import AvatarBadge from '@/ui/AvatarBadge.vue'

const props = defineProps<{ msg: AgentMessage }>()

const { renderContent, isTextLong, textExpanded } = useMessageRender()
const { formatTime } = useMessageTime()

const expandedToolId = ref<string | null>(null)

const hasUncertainty = computed(() =>
  props.msg.role === 'assistant' ? hasUncertaintyMarkers(props.msg.content ?? '') : false
)

const msgBodyStyle = computed(() => {
  if (props.msg.role !== 'assistant') return undefined
  const style: Record<string, string> = {}
  if (props.msg.speakerColor) style.borderLeftColor = props.msg.speakerColor
  else style.borderLeftColor = 'var(--color-border)'
  if (props.msg.speakerFontFamily) {
    style.fontFamily = `"${props.msg.speakerFontFamily}", sans-serif`
    if (props.msg.speakerFontWeight && props.msg.speakerFontWeight !== 400) {
      style.fontWeight = String(props.msg.speakerFontWeight)
    }
    if (props.msg.speakerFontStyle && props.msg.speakerFontStyle !== 'normal') {
      style.fontStyle = props.msg.speakerFontStyle
    }
  }
  return style
})

const isLong = computed(() =>
  props.msg.role === 'assistant' ? isTextLong(props.msg.content ?? '') : false
)

const renderedContent = computed(() => {
  if (props.msg.role !== 'assistant') return ''
  const content = props.msg.content ?? ''
  const rendered = renderContent(content)
  return rendered.replace(/【待确认】/g, '<mark class="uncertainty-mark">【待确认】</mark>')
})

const renderedUserContent = computed(() => {
  const content = props.msg.content ?? ''
  return content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
})

function getToolImportanceClass(toolName: string): string {
  const importance = getToolImportance(toolName)
  if (importance === 'world-change') return 'importance-high'
  if (importance === 'output-gen') return 'importance-medium'
  return 'importance-low'
}

function toggleToolDetail(toolCallId: string): void {
  expandedToolId.value = expandedToolId.value === toolCallId ? null : toolCallId
}

function formatToolArgs(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args, null, 2)
  } catch {
    return String(args)
  }
}

function onCopy() {
  const text = props.msg.content ?? ''
  navigator.clipboard.writeText(text).catch(() => {})
}
</script>

<style scoped>
.group-msg {
  padding: 8px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.system-msg {
  text-align: center;
  padding: 6px;
}

.system-text {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  background: var(--color-surface);
  padding: 4px 12px;
  border-radius: 12px;
}

.msg-speaker {
  display: flex;
  align-items: center;
  gap: 8px;
}

.speaker-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  flex-shrink: 0;
}

.avatar-letter {
  color: white;
  font-weight: 700;
  font-size: var(--font-size-sm);
}

.speaker-name {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--speaker-color);
}

.msg-body {
  margin-left: 36px;
  padding: 8px 12px;
  border-radius: 0 12px 12px 12px;
  background: var(--color-surface-elevated);
  border-left: 3px solid var(--color-border);
  max-width: 85%;
}

.msg-user .msg-body {
  margin-left: 0;
  margin-right: 36px;
  border-radius: 12px 0 12px 12px;
  border-left: none;
  border-right: 3px solid var(--color-primary);
  margin-left: auto;
}

.msg-text {
  font-size: var(--font-size-sm);
  line-height: 1.6;
  color: var(--color-text);
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
  background: linear-gradient(transparent, var(--color-surface-elevated));
  pointer-events: none;
}

.has-uncertainty {
  position: relative;
}

.uncertainty-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  font-size: var(--font-size-2xs);
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
  border-radius: 4px;
  font-weight: 600;
}

.uncertainty-mark {
  background: rgba(245, 158, 11, 0.2);
  color: #f59e0b;
  padding: 0 2px;
  border-radius: 2px;
}

.msg-thinking {
  margin-bottom: 6px;
  border-left: 3px solid var(--speaker-color, var(--color-primary));
  padding-left: 8px;
}

.msg-thinking summary {
  cursor: pointer;
  font-size: var(--font-size-xs);
  color: var(--speaker-color, var(--color-text-tertiary));
  font-weight: 600;
  margin-bottom: 4px;
}

.thinking-content {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  line-height: 1.5;
  padding: 6px 8px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 6px;
  margin-top: 4px;
  white-space: pre-wrap;
  max-height: 200px;
  overflow-y: auto;
}

.msg-text :deep(h1), .msg-text :deep(h2), .msg-text :deep(h3) {
  margin: 8px 0 4px;
  font-weight: var(--font-weight-semibold);
}

.msg-text :deep(h1) { font-size: var(--font-size-xl) }
.msg-text :deep(h2) { font-size: var(--font-size-lg) }
.msg-text :deep(h3) { font-size: var(--font-size-md) }
.msg-text :deep(p) { margin: 4px 0 }
.msg-text :deep(ul), .msg-text :deep(ol) { margin: 4px 0; padding-left: 20px }
.msg-text :deep(li) { margin: 2px 0 }
.msg-text :deep(code) {
  background: rgba(255, 255, 255, 0.08);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: var(--font-size-sm);
  font-family: 'Consolas', 'Monaco', monospace;
}
.msg-text :deep(pre) {
  background: rgba(0, 0, 0, 0.25);
  padding: 10px 12px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 8px 0;
}
.msg-text :deep(pre code) {
  background: none;
  padding: 0;
  font-size: var(--font-size-sm);
  line-height: 1.5;
}
.msg-text :deep(blockquote) {
  border-left: 3px solid var(--color-primary);
  margin: 6px 0;
  padding: 4px 12px;
  opacity: 0.85;
}
.msg-text :deep(table) { border-collapse: collapse; margin: 8px 0; font-size: var(--font-size-sm) }
.msg-text :deep(th), .msg-text :deep(td) {
  border: 1px solid var(--color-border);
  padding: 4px 8px;
}
.msg-text :deep(a) { color: var(--color-primary); text-decoration: underline }
.msg-text :deep(hr) { border: none; border-top: 1px solid var(--color-border); margin: 8px 0 }

/* Layer 2: 动作标签行 */
.msg-tool-calls {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
}

.tool-call-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}

.tool-call-tag:hover { filter: brightness(1.05); }

.tool-call-tag.running { border-color: var(--color-primary); color: var(--color-primary); }
.tool-call-tag.completed { border-color: rgba(16, 185, 129, 0.3); color: #10b981; }
.tool-call-tag.failed { border-color: rgba(239, 68, 68, 0.3); color: #ef4444; }

.tool-call-tag.importance-high {
  background: rgba(108, 92, 231, 0.08);
  border-color: rgba(108, 92, 231, 0.25);
  font-weight: 500;
}
.tool-call-tag.importance-medium {
  background: var(--color-surface);
}
.tool-call-tag.importance-low {
  opacity: 0.75;
}

.tc-spin { animation: spin 1s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

/* 工具调用详情（折叠） */
.tool-detail {
  margin-bottom: 6px;
  padding: 6px 8px;
  background: var(--color-surface);
  border-radius: 6px;
  border: 1px solid var(--color-border);
  font-size: 11px;
}

.tool-detail-section { margin-bottom: 4px; }
.tool-detail-section:last-child { margin-bottom: 0; }
.tool-detail-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 2px;
  display: block;
}
.tool-detail-content {
  font-size: 11px;
  color: var(--color-text-secondary);
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  max-height: 120px;
  overflow-y: auto;
  font-family: inherit;
}

.text-expand-btn {
  display: inline-block;
  padding: 2px 8px;
  margin-top: 4px;
  border-radius: 8px;
  font-size: 11px;
  color: var(--color-primary);
  background: rgba(108, 92, 231, 0.08);
  border: 1px solid rgba(108, 92, 231, 0.15);
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}

.text-expand-btn:hover {
  background: rgba(108, 92, 231, 0.15);
}

.msg-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
  opacity: 0;
  transition: opacity 0.15s;
  height: 20px;
}

.group-msg:hover .msg-actions {
  opacity: 1;
}

.action-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: var(--font-size-sm);
  padding: 2px 4px;
  border-radius: 4px;
  opacity: 0.6;
  transition: opacity 0.1s;
}

.action-btn:hover {
  opacity: 1;
}

.msg-time {
  font-size: var(--font-size-2xs);
  color: var(--color-text-tertiary);
  margin-left: auto;
}

@keyframes msg-slide-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
