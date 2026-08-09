<template>
  <div
    class="casual-msg"
    :class="{
      'is-user': msg.role === 'user',
      'is-system': msg.role === 'system',
      'is-world-event': msg.type === 'world-event',
      'is-grouped': isGrouped,
    }"
    @contextmenu.prevent="onContextMenu"
  >
    <!-- 世界事件（Layer 3）：轻量系统消息 -->
    <template v-if="msg.type === 'world-event'">
      <div class="world-event-msg">
        <WsIcon name="zap" size="xs" class="world-event-icon" />
        <span class="world-event-text">{{ msg.content }}</span>
      </div>
    </template>
    <template v-else-if="msg.role === 'system'">
      <div class="system-text">{{ msg.content }}</div>
    </template>
    <template v-else-if="msg.role === 'user'">
      <div class="user-row">
        <div class="user-bubble-wrap">
          <div v-if="replyPreview" class="reply-preview" :style="{ borderLeftColor: replyPreview.color }">
            <span class="reply-name" :style="{ color: replyPreview.color }">{{ replyPreview.name }}</span>
            <span class="reply-text">{{ replyPreview.text }}</span>
          </div>
          <div v-if="msg.type === 'image' && msg.imageUrl" class="msg-image">
            <img :src="msg.imageUrl" :alt="msg.content" loading="lazy" />
          </div>
          <div v-else-if="msg.type === 'file' && msg.fileName" class="msg-file">
            <span class="file-icon">📎</span>
            <div class="file-info">
              <span class="file-name">{{ msg.fileName }}</span>
            </div>
          </div>
          <div v-else class="msg-text user-text" v-html="renderContent(msg.content)"></div>
          <span class="msg-time user-time">{{ formatTime(msg.timestamp) }}</span>
        </div>
        <div v-if="!isGrouped" class="msg-avatar user-avatar">
          <span class="avatar-letter">你</span>
        </div>
        <div v-else class="avatar-placeholder"></div>
      </div>
    </template>
    <template v-else>
      <div class="agent-row">
        <div class="avatar-col">
          <AvatarBadge
            v-if="!isGrouped"
            class="msg-avatar"
            :class="{ 'has-thinking': !!msg.thinking }"
            :avatar="msg.speakerAvatar"
            :name="msg.speakerName"
            :color="msg.speakerColor || '#888'"
            :size="28"
            @click.stop="onAvatarClick"
          />
          <div v-else class="avatar-placeholder"></div>
        </div>
        <div class="agent-bubble-wrap">
          <span v-if="!isGrouped" class="msg-name" :style="{ color: msg.speakerColor }">{{ msg.speakerName || '助手' }}</span>
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
              <div v-if="tc.params" class="tool-detail-section">
                <span class="tool-detail-label">参数</span>
                <pre class="tool-detail-content">{{ tc.params }}</pre>
              </div>
              <div v-if="tc.result" class="tool-detail-section">
                <span class="tool-detail-label">结果</span>
                <pre class="tool-detail-content">{{ tc.result }}</pre>
              </div>
            </div>
          </div>
          <div v-if="replyPreview" class="reply-preview" :style="{ borderLeftColor: replyPreview.color }">
            <span class="reply-name" :style="{ color: replyPreview.color }">{{ replyPreview.name }}</span>
            <span class="reply-text">{{ replyPreview.text }}</span>
          </div>
          <div v-if="msg.type === 'image' && msg.imageUrl" class="msg-image">
            <img :src="msg.imageUrl" :alt="msg.content" loading="lazy" />
          </div>
          <div v-else-if="msg.type === 'file' && msg.fileName" class="msg-file">
            <span class="file-icon">📎</span>
            <div class="file-info">
              <span class="file-name">{{ msg.fileName }}</span>
            </div>
          </div>
          <div v-else class="msg-text agent-text" :style="agentFontStyle" v-html="renderContent(msg.content)"></div>
          <span class="msg-time agent-time">{{ formatTime(msg.timestamp) }}</span>
        </div>
      </div>
    </template>
    <!-- 思考内容：点击头像后展开，定位在头像上方 -->
    <Transition name="thinking-pop">
      <div v-if="thinkingExpanded && msg.thinking" class="thinking-popover">
        <div class="thinking-pop-header">思考过程</div>
        <div class="thinking-pop-content">{{ msg.thinking }}</div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import type { GroupChatMessage } from '../types'
import { getToolLabel, getToolIcon, getToolImportance } from '../types'
import { WsIcon } from '@worldsmith/ui-kit'
import AvatarBadge from '@/ui/AvatarBadge.vue'

const props = defineProps<{
  msg: GroupChatMessage
  allMessages?: GroupChatMessage[]
  isGrouped?: boolean
}>()

const emit = defineEmits<{
  contextmenu: [payload: { event: MouseEvent; msg: GroupChatMessage }]
}>()

const thinkingExpanded = ref(false)
const expandedToolId = ref<string | null>(null)

const replyPreview = computed(() => {
  if (!props.msg.replyTo || !props.allMessages) return null
  const replied = props.allMessages.find(m => m.id === props.msg.replyTo)
  if (!replied) return null
  return {
    name: replied.speakerName || '用户',
    color: replied.speakerColor || '#888',
    text: replied.content.slice(0, 60) + (replied.content.length > 60 ? '...' : ''),
  }
})

const agentFontStyle = computed(() => {
  if (!props.msg.speakerFontFamily) return undefined
  const style: Record<string, string> = {
    fontFamily: `"${props.msg.speakerFontFamily}", sans-serif`,
  }
  if (props.msg.speakerFontWeight && props.msg.speakerFontWeight !== 400) {
    style.fontWeight = String(props.msg.speakerFontWeight)
  }
  if (props.msg.speakerFontStyle && props.msg.speakerFontStyle !== 'normal') {
    style.fontStyle = props.msg.speakerFontStyle
  }
  return style
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

function onAvatarClick(): void {
  if (props.msg.thinking) {
    thinkingExpanded.value = !thinkingExpanded.value
  }
}

function onDocumentClick(_e: MouseEvent): void {
  if (thinkingExpanded.value) {
    thinkingExpanded.value = false
  }
  if (expandedToolId.value) {
    expandedToolId.value = null
  }
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
})

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

function renderContent(content: string): string {
  return content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/@(\S+)/g, '<span class="mention">@$1</span>')
    .replace(/\n/g, '<br>')
}

function onContextMenu(e: MouseEvent): void {
  emit('contextmenu', { event: e, msg: props.msg })
}
</script>

<style scoped>
@keyframes msg-enter {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.casual-msg {
  position: relative;
  padding: 4px 16px;
  margin-bottom: 2px;
  animation: msg-enter 200ms ease-out both;
}
.casual-msg.is-grouped {
  padding-top: 0;
}
.casual-msg.is-system { text-align: center; padding: 4px 16px; }
.system-text { font-size: var(--fs-xs); color: var(--color-text-tertiary); }

.agent-row { display: flex; gap: 8px; align-items: flex-start; }
.avatar-col { position: relative; flex-shrink: 0; }
.agent-bubble-wrap { max-width: 75%; display: flex; flex-direction: column; min-width: 0; }
.msg-name { font-size: var(--fs-sm); font-weight: 600; margin-bottom: 2px; }
.agent-text { padding: 8px 12px; background: var(--color-surface-elevated); border-radius: 2px 12px 12px 12px; font-size: var(--fs-md); line-height: 1.5; word-break: break-word; box-shadow: 0 1px 2px rgba(0,0,0,0.06); }

.user-row { display: flex; gap: 8px; align-items: flex-start; justify-content: flex-end; }
.user-bubble-wrap { max-width: 75%; display: flex; flex-direction: column; align-items: flex-end; }
.user-avatar { background: linear-gradient(135deg, #10b981, #34d399) !important; }
.user-text { padding: 8px 12px; background: rgba(108,92,231,0.12); border-radius: var(--radius-2xl) 2px var(--radius-2xl) var(--radius-2xl); font-size: var(--fs-md); line-height: 1.5; word-break: break-word; box-shadow: 0 1px 2px rgba(0,0,0,0.06); }

.avatar-placeholder { width: 28px; flex-shrink: 0; }

.msg-avatar {
  width: 28px; height: 28px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  cursor: default; transition: box-shadow 0.15s;
}
.msg-avatar.has-thinking {
  cursor: pointer;
}
.msg-avatar.has-thinking:hover {
  box-shadow: 0 0 0 2px rgba(108,92,231,0.3);
}
.avatar-letter { color: var(--on-accent); font-weight: 700; font-size: var(--fs-xs); }
.msg-time { font-size: var(--fs-2xs); color: var(--color-text-tertiary); }
.user-time { margin-top: 2px; }
.agent-time { margin-top: 2px; }

.reply-preview { font-size: var(--fs-xs); color: var(--color-text-tertiary); padding: 4px 6px; background: rgba(0,0,0,0.05); border-radius: var(--radius-xs); border-left: 2px solid var(--color-border); margin-bottom: 4px; }
.reply-name { font-weight: 600; margin-right: 4px; }

.msg-image img { max-width: 240px; max-height: 180px; border-radius: var(--radius-mid); cursor: pointer; }
.msg-file { display: flex; align-items: center; gap: 8px; padding: 8px; background: var(--color-surface); border-radius: var(--radius-mid); }
.file-icon { font-size: 18px; }
.file-info { display: flex; flex-direction: column; }
.file-name { font-size: var(--fs-sm); font-weight: 500; }

.mention { color: var(--info); cursor: pointer; font-weight: 500; }

/* Layer 2: 动作标签行 */
.msg-tool-calls {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 4px;
}

.tool-call-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 8px;
  border-radius: var(--radius-xs);
  font-size: var(--fs-xs);
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}

.tool-call-tag:hover { filter: brightness(1.05); }

.tool-call-tag.running { border-color: var(--color-primary); color: var(--color-primary); }
.tool-call-tag.completed { border-color: color-mix(in srgb, var(--success) 30%, transparent); color: var(--success); }
.tool-call-tag.failed { border-color: color-mix(in srgb, var(--danger) 30%, transparent); color: var(--danger); }

/* 重要性分级 */
.tool-call-tag.importance-high {
  background: rgba(108, 92, 231, 0.08);
  border-color: rgba(108, 92, 231, 0.25);
  font-weight: 500;
}
.tool-call-tag.importance-medium {
  background: var(--color-surface-elevated);
}
.tool-call-tag.importance-low {
  opacity: 0.75;
}

.tc-spin { animation: spin 1s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

/* 工具调用详情（折叠） */
.tool-detail {
  margin-bottom: 4px;
  padding: 6px 8px;
  background: var(--color-surface);
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  font-size: var(--fs-xs);
}

.tool-detail-section { margin-bottom: 4px; }
.tool-detail-section:last-child { margin-bottom: 0; }
.tool-detail-label {
  font-size: var(--fs-2xs);
  font-weight: 600;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 2px;
  display: block;
}
.tool-detail-content {
  font-size: var(--fs-xs);
  color: var(--color-text-secondary);
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  max-height: 120px;
  overflow-y: auto;
  font-family: inherit;
}

/* Layer 3: 世界事件 */
.world-event-msg {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  background: rgba(108, 92, 231, 0.06);
  border-radius: var(--radius-2xl);
  border: 1px solid rgba(108, 92, 231, 0.12);
}

.world-event-icon {
  color: var(--color-primary);
  flex-shrink: 0;
}

.world-event-text {
  font-size: var(--fs-xs);
  color: var(--color-text-secondary);
  line-height: 1.4;
}

.casual-msg.is-world-event {
  text-align: center;
  padding: 2px 16px;
}

/* 思考内容弹出层 — 定位在头像上方，避免被气泡遮挡 */
.thinking-popover {
  position: absolute;
  bottom: 100%;
  left: 16px;
  width: 240px;
  max-height: 240px;
  overflow-y: auto;
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-mid);
  box-shadow: 0 4px 16px rgba(0,0,0,0.15);
  z-index: 100;
  padding: 8px;
  margin-bottom: 4px;
}
.thinking-pop-header {
  font-size: var(--fs-2xs);
  font-weight: 600;
  color: var(--color-text-tertiary);
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.thinking-pop-content {
  font-size: var(--fs-xs);
  color: var(--color-text-tertiary);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.thinking-pop-enter-active { transition: background 0.15s ease-out, border-color 0.15s ease-out, color 0.15s ease-out, box-shadow 0.15s ease-out, transform 0.15s ease-out, opacity 0.15s ease-out, filter 0.15s ease-out; }
.thinking-pop-leave-active { transition: background 0.1s ease-in, border-color 0.1s ease-in, color 0.1s ease-in, box-shadow 0.1s ease-in, transform 0.1s ease-in, opacity 0.1s ease-in, filter 0.1s ease-in; }
.thinking-pop-enter-from { opacity: 0; transform: translateY(4px) scale(0.95); }
.thinking-pop-leave-to { opacity: 0; transform: translateY(2px) scale(0.98); }

/* ── 减弱动态偏好（prefers-reduced-motion）：停用工具旋转与弹出位移 ──
   与 TuiButton/TuiModal/TuiDrawer/AgentWorkspace 同一可访问性语言：仅保留静态状态。 */
@media (prefers-reduced-motion: reduce) {
  .tc-spin {
    animation: none;
  }
  .thinking-pop-enter-from,
  .thinking-pop-leave-to {
    transform: none;
  }
}
</style>