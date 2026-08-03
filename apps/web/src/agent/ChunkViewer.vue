<template>
  <Transition name="ws-menu">
    <div v-if="visible" class="chunk-viewer agent-panel" :style="panelStyle" @mousedown.left="onDragStart">
      <div class="cv-drag-handle">
        <span class="cv-title"><WsIcon name="folder-open" size="sm" /> 片段查看</span>
        <button class="cv-close-btn" @click="emit('close')">✕</button>
      </div>
      <div class="cv-body">
        <div v-if="loading" class="cv-loading">加载中...</div>
        <div v-else-if="error" class="cv-error">{{ error }}</div>
        <template v-else-if="chunk">
          <div class="cv-meta">
            <div class="cv-meta-row">
              <span class="cv-meta-label">主题</span>
              <span class="cv-meta-value">{{ chunk.title }}</span>
            </div>
            <div class="cv-meta-row">
              <span class="cv-meta-label">类型</span>
              <span class="cv-meta-tag" :class="`cv-type-${chunk.outputType}`">{{ chunk.outputType }}</span>
            </div>
            <div class="cv-meta-row">
              <span class="cv-meta-label">锚点</span>
              <span class="cv-meta-value">{{ chunk.userMessageAnchor }}</span>
            </div>
            <div class="cv-meta-row">
              <span class="cv-meta-label">Tokens</span>
              <span class="cv-meta-value">{{ chunk.tokenCount.toLocaleString() }}</span>
            </div>
            <div class="cv-meta-row">
              <span class="cv-meta-label">消息数</span>
              <span class="cv-meta-value">{{ chunk.messages.length }}</span>
            </div>
          </div>
          <div class="cv-messages">
            <div
              v-for="(msg, idx) in chunk.messages"
              :key="idx"
              class="cv-msg"
              :class="`cv-msg-${msg.role}`"
            >
              <div class="cv-msg-header">
                <span class="cv-msg-role">{{ roleLabel(msg.role) }}</span>
                <span v-if="msg.toolName" class="cv-msg-tool">{{ msg.toolName }}</span>
                <span class="cv-msg-time">{{ formatTime(msg.timestamp) }}</span>
              </div>
              <div class="cv-msg-content">{{ msg.content }}</div>
            </div>
          </div>
        </template>
        <div v-else class="cv-empty">无数据</div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
/**
 * ChunkViewer - 记忆片段查看器
 *
 * P3-3-3 新增：显示某个 MemoryChunk 的完整消息快照。
 * 通过 useMemoryArchive.loadChunk(hookId, chunkId) 加载数据。
 */
import { ref, watch, computed } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { usePanelDrag } from '../agent/composables/usePanelDrag'
import { useMemoryArchive } from '../memory-archive'
import type { MemoryChunk } from '@worldsmith/memory-archive'

const props = defineProps<{
  visible: boolean
  hookId: string
  chunkId: string
  position: { x: number; y: number }
  dragged: boolean
}>()

const emit = defineEmits<{
  close: []
  dragstart: [e: MouseEvent]
}>()

const memoryArchive = useMemoryArchive()

const chunk = ref<MemoryChunk | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

const posX = computed({
  get: () => props.position.x,
  set: () => {},
})
const posY = computed({
  get: () => props.position.y,
  set: () => {},
})

const { onDragStart } = usePanelDrag({
  x: posX,
  y: posY,
  onDragEnd: () => {},
  excludeSelector: '.cv-body,.cv-close-btn',
})

const panelStyle = computed(() => {
  if (props.dragged) {
    return { left: `${props.position.x}px`, top: `${props.position.y}px` }
  }
  return { left: `${props.position.x}px`, bottom: `${props.position.y}px` }
})

async function loadChunk(): Promise<void> {
  if (!props.visible || !props.hookId || !props.chunkId) return
  loading.value = true
  error.value = null
  chunk.value = null
  try {
    const result = await memoryArchive.loadChunk(props.hookId, props.chunkId)
    chunk.value = result as MemoryChunk
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.visible, props.hookId, props.chunkId] as const,
  ([v]) => {
    if (v) loadChunk()
  },
  { immediate: true }
)

function roleLabel(role: string): string {
  const map: Record<string, string> = {
    user: '用户',
    assistant: '助手',
    tool: '工具',
    system: '系统',
  }
  return map[role] || role
}

function formatTime(ts: number): string {
  if (!ts) return ''
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<style scoped>
.chunk-viewer {
  position: fixed;
  width: 520px;
  max-width: 90vw;
  max-height: 70vh;
  background: var(--agent-bg, rgba(26, 26, 46, 0.92));
  backdrop-filter: blur(var(--agent-blur, 16px));
  border: 1px solid var(--agent-border, rgba(58, 58, 106, 0.4));
  border-radius: var(--agent-radius, 14px);
  box-shadow: var(--shadow-lg, 0 8px 32px rgba(0, 0, 0, 0.5));
  z-index: 10002;
  overflow: hidden;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
}

.cv-drag-handle {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--agent-border, rgba(58, 58, 106, 0.3));
  cursor: grab;
  user-select: none;
}
.cv-drag-handle:active { cursor: grabbing }

.cv-title {
  font-size: var(--font-size-sm);
  color: var(--agent-text, #e0e0e0);
  font-family: var(--agent-font, sans-serif);
  display: flex;
  align-items: center;
  gap: 6px;
}

.cv-close-btn {
  background: none;
  border: none;
  color: var(--agent-text-secondary, #888);
  cursor: pointer;
  font-size: var(--font-size-base);
}

.cv-body {
  padding: 12px 14px;
  overflow-y: auto;
  flex: 1;
}

.cv-loading, .cv-error, .cv-empty {
  padding: 24px;
  text-align: center;
  color: var(--agent-text-secondary, #888);
  font-size: var(--font-size-sm);
}
.cv-error { color: var(--agent-danger, #e57373); }

.cv-meta {
  background: var(--agent-accent-bg, rgba(108, 92, 231, 0.08));
  border-radius: var(--agent-radius-sm, 8px);
  padding: 10px 12px;
  margin-bottom: 12px;
}

.cv-meta-row {
  display: flex;
  gap: 8px;
  padding: 3px 0;
  font-size: var(--font-size-xs);
}

.cv-meta-label {
  color: var(--agent-text-tertiary, #666);
  min-width: 48px;
}

.cv-meta-value {
  color: var(--agent-text, #e0e0e0);
  flex: 1;
  word-break: break-all;
}

.cv-meta-tag {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--agent-accent-bg, rgba(108, 92, 231, 0.2));
  color: var(--agent-text, #e0e0e0);
  font-size: var(--font-size-xs);
}

.cv-type-text { background: rgba(100, 149, 237, 0.2); }
.cv-type-tool_call { background: rgba(255, 165, 0, 0.2); }
.cv-type-entity_op { background: rgba(100, 200, 100, 0.2); }
.cv-type-code { background: rgba(138, 43, 226, 0.2); }
.cv-type-analysis { background: rgba(72, 209, 204, 0.2); }
.cv-type-creative { background: rgba(255, 105, 180, 0.2); }

.cv-messages {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cv-msg {
  border-left: 3px solid var(--agent-border, rgba(58, 58, 106, 0.4));
  padding: 6px 10px;
  background: rgba(0, 0, 0, 0.15);
  border-radius: 0 var(--agent-radius-sm, 8px) var(--agent-radius-sm, 8px) 0;
}

.cv-msg-user { border-left-color: var(--agent-primary, #6c5ce7); }
.cv-msg-assistant { border-left-color: var(--agent-accent, #a29bfe); }
.cv-msg-tool { border-left-color: var(--agent-warning, #fdcb6e); }
.cv-msg-system { border-left-color: var(--agent-text-tertiary, #666); }

.cv-msg-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  font-size: var(--font-size-xs);
}

.cv-msg-role {
  color: var(--agent-text, #e0e0e0);
  font-weight: var(--font-weight-medium);
}

.cv-msg-tool {
  color: var(--agent-warning, #fdcb6e);
  font-family: var(--agent-font-mono, monospace);
}

.cv-msg-time {
  color: var(--agent-text-tertiary, #666);
  margin-left: auto;
}

.cv-msg-content {
  color: var(--agent-text-secondary, #aaa);
  font-size: var(--font-size-xs);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow-y: auto;
  line-height: 1.5;
}
</style>
