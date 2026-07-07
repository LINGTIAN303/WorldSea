<template>
  <Teleport to="body">
    <div v-if="visible" class="sf-chat-window" :style="windowStyle" @mousedown.stop>
      <div class="sf-chat-header" @mousedown="onDragStart">
        <div class="sf-chat-tags">
          <span v-if="context.entityType" class="sf-chat-tag">{{ context.entityType }}</span>
          <span v-if="context.fieldKey" class="sf-chat-tag sf-chat-tag-field">{{ context.fieldKey }}</span>
        </div>
        <button class="sf-chat-close" @click="$emit('close')">✕</button>
      </div>
      <div v-if="context.selectedText" class="sf-chat-selection">
        <span class="sf-chat-selection-label">选中文本：</span>
        <span class="sf-chat-selection-text">{{ truncateSelection }}</span>
      </div>
      <div ref="messageList" class="sf-chat-messages">
        <div v-for="msg in messages" :key="msg.id" class="sf-chat-msg" :class="msg.role">
          <div class="sf-chat-msg-content">{{ msg.content }}</div>
        </div>
        <!-- A2UI 组件渲染区域：独立于消息气泡，基于 surface 状态渲染 -->
        <div v-if="hasA2UISurfaces" class="sf-chat-a2ui">
          <A2UIRenderer
            :surfaces="a2uiSurfaces"
            :resolve-binding="resolveDataBinding"
            @action="onA2UIAction"
          />
        </div>
        <div v-if="loading" class="sf-chat-msg assistant">
          <div class="sf-chat-msg-content sf-chat-typing">
            <span></span><span></span><span></span>
          </div>
        </div>
      </div>
      <div class="sf-chat-input">
        <input
          v-model="inputText"
          placeholder="与 AI 聊聊这段内容..."
          @keydown.enter="onSend"
          :disabled="loading"
        />
        <button class="sf-chat-send" @click="onSend" :disabled="loading || !inputText.trim()">➤</button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'
import type { SmartFillChatContext, SmartFillChatMessage } from '../../composables/useSmartFillChat'
import type { A2UIMessage } from '@agent/index'
import A2UIRenderer from '../../agent/a2ui/A2UIRenderer.vue'

interface A2UISurface {
  surfaceId: string
  catalogId: string
  theme?: Record<string, unknown>
  components: Record<string, any>
  rootIds: string[]
  dataModel: Record<string, unknown>
}

const props = defineProps<{
  visible: boolean
  context: SmartFillChatContext
  loading: boolean
  messages: readonly SmartFillChatMessage[]
}>()

const emit = defineEmits<{
  close: []
  send: [text: string]
}>()

const inputText = ref('')
const messageList = ref<HTMLElement | null>(null)

// A2UI 状态
const a2uiSurfaces = ref<Record<string, A2UISurface>>({})
const hasA2UISurfaces = computed(() => Object.keys(a2uiSurfaces.value).length > 0)

function findRootIds(components: Record<string, any>): string[] {
  if (components['root']) return ['root']
  const childIds = new Set<string>()
  for (const comp of Object.values(components)) {
    const ch = comp.children
    if (Array.isArray(ch)) {
      for (const id of ch) childIds.add(id)
    }
  }
  const roots: string[] = []
  for (const id of Object.keys(components)) {
    if (!childIds.has(id)) roots.push(id)
  }
  return roots
}

function handleA2UIEvent(surfaceId: string, message: A2UIMessage): void {
  if ('createSurface' in message) {
    a2uiSurfaces.value = {
      ...a2uiSurfaces.value,
      [surfaceId]: {
        surfaceId,
        catalogId: message.createSurface.catalogId,
        theme: message.createSurface.theme,
        components: {},
        rootIds: [],
        dataModel: {},
      },
    }
  } else if ('updateComponents' in message) {
    const surface = a2uiSurfaces.value[surfaceId]
    if (!surface) return
    const newComponents = { ...surface.components }
    for (const comp of message.updateComponents.components) {
      newComponents[comp.id] = { ...comp }
    }
    const newRootIds = findRootIds(newComponents)
    a2uiSurfaces.value = {
      ...a2uiSurfaces.value,
      [surfaceId]: { ...surface, components: newComponents, rootIds: newRootIds },
    }
  } else if ('updateDataModel' in message) {
    const surface = a2uiSurfaces.value[surfaceId]
    if (!surface) return
    const newDataModel = JSON.parse(JSON.stringify(surface.dataModel))
    setNestedValue(newDataModel, message.updateDataModel.path, message.updateDataModel.value)
    a2uiSurfaces.value = {
      ...a2uiSurfaces.value,
      [surfaceId]: { ...surface, dataModel: newDataModel },
    }
  } else if ('deleteSurface' in message) {
    const newSurfaces = { ...a2uiSurfaces.value }
    delete newSurfaces[surfaceId]
    a2uiSurfaces.value = newSurfaces
  }
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('/').filter(Boolean)
  if (parts.length === 0) {
    if (typeof value === 'object' && value !== null) Object.assign(obj, value as Record<string, unknown>)
    return
  }
  let current: any = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in current)) current[parts[i]] = {}
    current = current[parts[i]]
  }
  current[parts[parts.length - 1]] = value
}

function resolveDataBinding(binding: any, dataModel: Record<string, unknown>): any {
  if (binding && typeof binding === 'object' && 'path' in binding) {
    const parts = (binding.path as string).split('/').filter(Boolean)
    let current: any = dataModel
    for (const part of parts) {
      if (current == null || typeof current !== 'object') return undefined
      current = current[part]
    }
    return current
  }
  return binding
}

function onA2UIAction(_surfaceId: string, _action: { name: string; data?: any }) {
  // A2UI action 处理（可扩展）
}

// 监听 A2UI 事件
function onSmartFillA2UI(e: Event) {
  const detail = (e as CustomEvent).detail as { surfaceId: string; message: A2UIMessage } | undefined
  if (!detail) return
  handleA2UIEvent(detail.surfaceId, detail.message)
}

// 拖拽
const windowX = ref(window.innerWidth - 430)
const windowY = ref(window.innerHeight - 560)
let dragging = false
let dragOffsetX = 0
let dragOffsetY = 0

const windowStyle = computed(() => ({
  left: windowX.value + 'px',
  top: windowY.value + 'px',
}))

function onDragStart(e: MouseEvent) {
  dragging = true
  dragOffsetX = e.clientX - windowX.value
  dragOffsetY = e.clientY - windowY.value

  const onMove = (ev: MouseEvent) => {
    if (!dragging) return
    windowX.value = Math.max(0, Math.min(ev.clientX - dragOffsetX, window.innerWidth - 400))
    windowY.value = Math.max(0, Math.min(ev.clientY - dragOffsetY, window.innerHeight - 100))
  }

  const onUp = () => {
    dragging = false
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

const truncateSelection = computed(() => {
  const text = props.context.selectedText || ''
  return text.length > 80 ? text.slice(0, 80) + '...' : text
})

function onSend() {
  const text = inputText.value.trim()
  if (!text) return

  emit('send', text)
  inputText.value = ''
  scrollToBottom()
}

function scrollToBottom() {
  nextTick(() => {
    if (messageList.value) {
      messageList.value.scrollTop = messageList.value.scrollHeight
    }
  })
}

// 注册 A2UI 事件监听
onMounted(() => {
  window.addEventListener('worldsmith:smart-fill:a2ui', onSmartFillA2UI)
})

onUnmounted(() => {
  window.removeEventListener('worldsmith:smart-fill:a2ui', onSmartFillA2UI)
})
</script>

<style scoped>
.sf-chat-window {
  position: fixed;
  z-index: 100000;
  width: 400px;
  max-height: 520px;
  background: var(--glass-bg, var(--modal-bg, var(--color-bg-surface)));
  border: 1px solid var(--glass-border, var(--border-color, var(--border)));
  border-radius: var(--radius-lg, 10px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
  backdrop-filter: blur(var(--glass-blur, 12px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: sf-chat-in 0.25s ease-out;
}
@keyframes sf-chat-in {
  from { opacity: 0; transform: translateY(12px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.sf-chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  cursor: grab;
  border-bottom: 1px solid var(--border-color, var(--border));
  user-select: none;
}
.sf-chat-header:active {
  cursor: grabbing;
}
.sf-chat-tags {
  display: flex;
  gap: 6px;
}
.sf-chat-tag {
  font-size: var(--font-size-xs, 11px);
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--accent-bg, color-mix(in srgb, var(--color-primary, #6366f1) 12%, transparent));
  color: var(--accent, var(--color-primary));
}
.sf-chat-tag-field {
  background: var(--bg-tertiary, var(--color-bg-elevated));
  color: var(--text-secondary);
}
.sf-chat-close {
  background: none;
  border: none;
  font-size: var(--font-size-base, 14px);
  cursor: pointer;
  color: var(--text-tertiary);
  padding: 2px 6px;
  border-radius: var(--radius-sm, 4px);
  transition: color 0.12s, background 0.12s;
}
.sf-chat-close:hover {
  color: var(--color-danger, #ef4444);
  background: color-mix(in srgb, var(--color-danger, #ef4444) 10%, transparent);
}
.sf-chat-selection {
  padding: 8px 14px;
  background: color-mix(in srgb, var(--accent, var(--color-primary)) 6%, transparent);
  border-bottom: 1px solid var(--border-color, var(--border));
  font-size: var(--font-size-sm, 13px);
}
.sf-chat-selection-label {
  color: var(--text-tertiary);
  font-size: var(--font-size-xs, 11px);
}
.sf-chat-selection-text {
  color: var(--text-color);
  font-style: italic;
}
.sf-chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px;
  min-height: 200px;
  max-height: 320px;
}
.sf-chat-msg {
  margin-bottom: 10px;
  max-width: 90%;
}
.sf-chat-msg.user {
  margin-left: auto;
}
.sf-chat-msg.assistant {
  margin-right: auto;
}
.sf-chat-msg-content {
  padding: 8px 12px;
  border-radius: var(--radius-md, 8px);
  font-size: var(--font-size-sm, 13px);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
.sf-chat-msg.user .sf-chat-msg-content {
  background: var(--accent-bg, color-mix(in srgb, var(--color-primary, #6366f1) 14%, transparent));
  color: var(--accent, var(--color-primary));
  border-bottom-right-radius: 2px;
}
.sf-chat-msg.assistant .sf-chat-msg-content {
  background: var(--bg-tertiary, var(--color-bg-elevated));
  color: var(--text-color);
  border-bottom-left-radius: 2px;
}
.sf-chat-a2ui {
  margin-top: 6px;
}
.sf-chat-typing {
  display: flex;
  gap: 4px;
  padding: 10px 14px;
}
.sf-chat-typing span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-tertiary);
  animation: sf-typing 1.2s infinite;
}
.sf-chat-typing span:nth-child(2) { animation-delay: 0.2s; }
.sf-chat-typing span:nth-child(3) { animation-delay: 0.4s; }
@keyframes sf-typing {
  0%, 60%, 100% { opacity: 0.3; transform: scale(0.8); }
  30% { opacity: 1; transform: scale(1); }
}
.sf-chat-input {
  display: flex;
  gap: 6px;
  padding: 10px 14px;
  border-top: 1px solid var(--border-color, var(--border));
}
.sf-chat-input input {
  flex: 1;
  padding: 7px 10px;
  border: 1px solid var(--border-color, var(--border));
  border-radius: var(--radius-sm, 4px);
  font-size: var(--font-size-sm, 13px);
  font-family: inherit;
  color: var(--text-color);
  background: var(--input-bg, var(--color-bg-surface));
  outline: none;
}
.sf-chat-input input:focus {
  border-color: var(--accent, var(--color-primary));
}
.sf-chat-send {
  padding: 6px 12px;
  background: var(--accent-bg, color-mix(in srgb, var(--color-primary, #6366f1) 14%, transparent));
  color: var(--accent, var(--color-primary));
  border: 1px solid var(--accent, var(--color-primary));
  border-radius: var(--radius-sm, 4px);
  cursor: pointer;
  font-size: var(--font-size-sm, 13px);
  transition: background 0.12s, border-color 0.12s, color 0.12s, box-shadow 0.12s, transform 0.12s, opacity 0.12s, filter 0.12s;
}
.sf-chat-send:hover:not(:disabled) {
  background: var(--accent, var(--color-primary));
  color: var(--color-text-inverse, #fff);
}
.sf-chat-send:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
