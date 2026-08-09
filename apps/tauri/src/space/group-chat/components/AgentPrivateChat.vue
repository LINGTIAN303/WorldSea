<template>
  <div class="private-chat">
    <div class="private-header">
      <button class="btn-back" @click="$emit('close')"><WsIcon name="arrow-left" size="xs" /> 返回群聊</button>
      <div class="agent-identity">
        <span class="agent-avatar" :style="{ backgroundColor: member.color }">
          {{ member.avatar }}
        </span>
        <span class="agent-name">{{ member.name }}</span>
      </div>
      <button class="btn-clear" title="清空记录" @click="clearChat"><WsIcon name="trash" size="xs" /></button>
    </div>

    <div ref="msgListRef" class="private-messages">
      <div
        v-for="msg in chatMessages"
        :key="msg.id"
        class="private-msg"
        :class="msg.role"
      >
        <div v-if="msg.role === 'user'" class="msg-user-wrap">
          <div class="msg-bubble user" @contextmenu="onMsgContextMenu($event, msg)">{{ msg.content }}</div>
          <span class="msg-time user-time">{{ formatTime(msg.timestamp) }}</span>
        </div>
        <div v-else class="msg-agent-wrap">
          <span class="msg-avatar-sm" :style="{ backgroundColor: msg.agentColor || member.color }">
            {{ msg.agentAvatar || member.avatar }}
          </span>
          <div class="msg-agent-body">
            <!-- 思考过程 -->
            <div v-if="msg.thinking" class="msg-thinking">
              <details>
                <summary><WsIcon name="manuscript" size="xs" /> 推理链</summary>
                <div class="thinking-content">{{ msg.thinking }}</div>
              </details>
            </div>
            <!-- 工具调用 -->
            <div v-if="msg.toolCalls && msg.toolCalls.length > 0" class="msg-tool-calls">
              <span v-for="tc in msg.toolCalls" :key="tc.id" class="tool-call-tag" :class="tc.status">
                <span v-if="tc.status === 'running'" class="tc-pulse">🔧</span>
                <span v-else-if="tc.status === 'completed'" class="tc-done"><WsIcon name="check" size="xs" /></span>
                <span v-else class="tc-fail"><WsIcon name="x" size="xs" /></span>
                {{ getToolLabel(tc.name) }}
              </span>
            </div>
            <!-- Markdown 内容 -->
            <div class="msg-bubble agent" v-html="renderMd(msg.content)" @contextmenu="onMsgContextMenu($event, msg)"></div>
            <span class="msg-time agent-time">{{ formatTime(msg.timestamp) }}</span>
          </div>
        </div>
      </div>

      <div v-if="isStreaming" class="private-msg assistant">
        <div class="msg-agent-wrap">
          <span class="msg-avatar-sm" :style="{ backgroundColor: member.color }">
            {{ member.avatar }}
          </span>
          <div class="msg-agent-body">
            <!-- 流式思考 -->
            <div v-if="streamingThinking" class="msg-thinking">
              <details :open="true">
                <summary><WsIcon name="manuscript" size="xs" /> 推理链</summary>
                <div class="thinking-content">{{ streamingThinking }}</div>
              </details>
            </div>
            <!-- 流式工具调用 -->
            <div v-if="streamingToolCalls.length > 0" class="msg-tool-calls">
              <span v-for="tc in streamingToolCalls" :key="tc.id" class="tool-call-tag" :class="tc.status">
                <span v-if="tc.status === 'running'" class="tc-pulse">🔧</span>
                <span v-else-if="tc.status === 'completed'" class="tc-done"><WsIcon name="check" size="xs" /></span>
                <span v-else class="tc-fail"><WsIcon name="x" size="xs" /></span>
                {{ getToolLabel(tc.name) }}
              </span>
            </div>
            <div class="msg-bubble agent streaming" v-html="streamingText ? renderMd(streamingText) : ''"></div>
            <div v-if="!streamingText && !streamingThinking && streamingToolCalls.length === 0" class="msg-bubble agent streaming-hint">正在思考...</div>
          </div>
        </div>
      </div>
    </div>

    <div class="private-input-area">
      <div class="input-row">
        <textarea
          ref="inputRef"
          v-model="inputText"
          class="chat-input"
          :placeholder="`和 ${member.name} 对话...`"
          rows="1"
          @keydown="onKeydown"
          @input="autoResize"
        />
        <button
          class="btn-send"
          :disabled="!inputText.trim() || isStreaming"
          @click="send"
        >
          <WsIcon name="send" size="sm" />
        </button>
      </div>
    </div>

    <!-- 右键菜单 -->
    <Teleport to="body">
      <div v-if="contextMenu.visible" class="context-menu" :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }" @click.stop>
        <div class="context-menu-item" @click="onCopyMessage">复制</div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { Marked } from 'marked'
import DOMPurify from 'dompurify'
import type { GroupMember } from '../types'
import { getToolLabel as getSharedToolLabel } from '../types'
import { useAgent } from '@/agent/composables/useAgent'
import type { AgentEvent, IAgentBackend } from '@agent/index'
import { buildSharedBaseLayer } from '@agent/index'
import { createOrAttachRustGroupChatBackend } from '../rust/RustGroupChatBackend'
import { useFontLibraryStore } from '@/stores/fontLibraryStore'
import { getModelInfo } from '@worldsmith/agent-runtime'
import { WsIcon } from '@worldsmith/ui-kit'

interface ToolCallInfo {
  id: string
  name: string
  status: 'running' | 'completed' | 'failed'
}

interface PrivateChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  toolCalls?: ToolCallInfo[]
  agentColor?: string
  agentAvatar?: string
  timestamp: number
}

const props = defineProps<{
  member: GroupMember
  /** 群聊会话 id（私聊参与者会话持久化映射用，避免污染单聊侧边栏） */
  groupId?: string
}>()

defineEmits<{ close: [] }>()

const { ensureInitialized, getProviderConfig, getToolContext } = useAgent()
const inputText = ref('')
const inputRef = ref<HTMLTextAreaElement | null>(null)
const msgListRef = ref<HTMLElement | null>(null)
const chatMessages = ref<PrivateChatMessage[]>([])
const isStreaming = ref(false)
const streamingText = ref('')
const streamingThinking = ref('')
const streamingToolCalls = ref<ToolCallInfo[]>([])

// 右键菜单
const contextMenu = ref<{ visible: boolean; x: number; y: number; msg: PrivateChatMessage | null }>({
  visible: false, x: 0, y: 0, msg: null,
})

let backend: IAgentBackend | null = null

// Markdown 渲染
const marked = new Marked({ gfm: true, breaks: true })

function renderMd(text: string): string {
  if (!text) return ''
  return DOMPurify.sanitize(marked.parse(text) as string)
}

// 工具标签映射：使用共享的 TOOL_CATEGORIES
function getToolLabel(name: string): string {
  return getSharedToolLabel(name)
}

function formatTime(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

/**
 * 构建群聊私聊 Agent 的系统提示词
 * 复用 GroupChatEngine.buildGroupAgentSystemPrompt 的分层逻辑
 */
function buildPrivateChatSystemPrompt(): string {
  const parts: string[] = []
  const m = props.member

  if (m.systemPrompt) {
    parts.push(m.systemPrompt)
  } else {
    parts.push(`你是群聊成员「${m.name}」，角色是「${m.role}」。`)
  }

  const mode = m.baseLayerMode || 'empty'
  if (mode === 'shared') {
    const toolContext = getToolContext()
    if (toolContext) {
      const fontLibrary = useFontLibraryStore()
      parts.push(buildSharedBaseLayer({
        projectName: 'WorldSmith-GroupChat',
        entityTypes: toolContext.projectInfo.entityTypes,
        relationTypes: toolContext.projectInfo.relationTypes,
        platform: toolContext.platform,
        availableFontFamilies: fontLibrary.entries.map(e => e.family),
      }))
    }
  } else if (mode === 'custom' && m.customBaseLayer) {
    parts.push(m.customBaseLayer)
  }

  // 技能/工具声明（仅自定义模式下按用户选择声明，共享模式由基础层覆盖，空模式无工具）
  if (mode === 'custom') {
    if (m.enabledSkills && m.enabledSkills.length > 0) {
      parts.push(`你擅长：${m.enabledSkills.join('、')}。相关话题时主动展示专业见解。`)
    }
    if (m.enabledTools && m.enabledTools.length > 0) {
      parts.push(`你可以使用工具：${m.enabledTools.join('、')}。需要时主动调用。`)
    }
  }

  return parts.join('\n\n')
}

async function ensureBackend(): Promise<boolean> {
  if (backend) return true

  // 确保主Agent已初始化（providerConfig/toolContext 依赖其模块级状态）
  await ensureInitialized()

  const providerConfig = props.member.providerConfig || getProviderConfig()
  const toolContext = getToolContext()
  if (!providerConfig || !toolContext) return false

  const systemPrompt = buildPrivateChatSystemPrompt()

  backend = await createOrAttachRustGroupChatBackend({
    participantId: `private-${props.member.id}`,
    name: props.member.name,
    groupId: props.groupId,
    systemPrompt,
    providerConfig: providerConfig as any,
    modelId: props.member.modelId,
  })

  if (props.member.modelId) {
    try {
      const info = getModelInfo(props.member.modelId)
      if (info) {
        await backend.updateModel(
          info.provider,
          props.member.modelId,
          undefined,
          undefined,
          info.contextLength,
          info.maxOutputTokens,
        )
      }
    } catch (err) {
      console.warn(`[AgentPrivateChat] Failed to set model for ${props.member.name}:`, err)
    }
  }

  return true
}

function scrollToBottom(): void {
  nextTick(() => {
    if (msgListRef.value) {
      msgListRef.value.scrollTop = msgListRef.value.scrollHeight
    }
  })
}

function autoResize(): void {
  const el = inputRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 120) + 'px'
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}

async function send(): Promise<void> {
  const text = inputText.value.trim()
  if (!text || isStreaming.value) return
  inputText.value = ''
  // 重置输入框高度
  if (inputRef.value) inputRef.value.style.height = 'auto'

  const ok = await ensureBackend()
  if (!ok) {
    chatMessages.value.push({
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '[错误] 无法初始化模型后端',
      agentColor: '#ef4444',
      timestamp: Date.now(),
    })
    return
  }

  const userMsg: PrivateChatMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    content: text,
    timestamp: Date.now(),
  }
  chatMessages.value.push(userMsg)

  isStreaming.value = true
  streamingText.value = ''
  streamingThinking.value = ''
  streamingToolCalls.value = []

  let currentContent = ''
  let currentThinking = ''
  const toolCallsMap = new Map<string, ToolCallInfo>()

  const localUnsub = backend!.subscribe((event: AgentEvent) => {
    switch (event.type) {
      case 'message_start':
        // 创建新的流式气泡（防止串流）
        currentContent = ''
        currentThinking = ''
        streamingText.value = ''
        streamingThinking.value = ''
        break

      case 'message_update':
        if (event.content !== undefined) currentContent = event.content
        if (event.thinking !== undefined) currentThinking = event.thinking
        streamingText.value = currentContent
        streamingThinking.value = currentThinking
        break

      case 'tool_execution_start': {
        const tc: ToolCallInfo = {
          id: event.toolCall.id,
          name: event.toolCall.name,
          status: 'running',
        }
        toolCallsMap.set(tc.id, tc)
        streamingToolCalls.value = Array.from(toolCallsMap.values())
        break
      }

      case 'tool_execution_update': {
        const existing = toolCallsMap.get(event.toolCallId)
        if (existing && event.status === 'error') {
          existing.status = 'failed'
          streamingToolCalls.value = Array.from(toolCallsMap.values())
        }
        break
      }

      case 'tool_execution_end': {
        const existing = toolCallsMap.get(event.toolCallId)
        if (existing) {
          existing.status = event.success ? 'completed' : 'failed'
          streamingToolCalls.value = Array.from(toolCallsMap.values())
        }
        break
      }

      case 'agent_end': {
        isStreaming.value = false
        streamingThinking.value = ''
        streamingToolCalls.value = []

        const assistantMsgs = event.messages?.filter(m => m.role === 'assistant') ?? []
        const lastMsg = assistantMsgs[assistantMsgs.length - 1]
        const content = lastMsg?.content ?? currentContent
        const thinking = lastMsg?.thinking ?? currentThinking

        if (content) {
          chatMessages.value.push({
            id: crypto.randomUUID(),
            role: 'assistant',
            content,
            thinking: thinking || undefined,
            toolCalls: Array.from(toolCallsMap.values()).length > 0
              ? Array.from(toolCallsMap.values())
              : undefined,
            agentColor: props.member.color,
            agentAvatar: props.member.avatar,
            timestamp: Date.now(),
          })
        }
        localUnsub()
        scrollToBottom()
        break
      }

      case 'error': {
        isStreaming.value = false
        streamingText.value = ''
        streamingThinking.value = ''
        streamingToolCalls.value = []
        chatMessages.value.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `[错误] ${event.error instanceof Error ? event.error.message : String(event.error)}`,
          agentColor: '#ef4444',
          timestamp: Date.now(),
        })
        localUnsub()
        scrollToBottom()
        break
      }
    }
  })

  try {
    await backend!.prompt(text, { chatMode: 'group-chat' })
  } catch (err) {
    isStreaming.value = false
    streamingText.value = ''
    streamingThinking.value = ''
    streamingToolCalls.value = []
    localUnsub()
    chatMessages.value.push({
      id: crypto.randomUUID(),
      role: 'assistant',
      content: `[错误] ${err instanceof Error ? err.message : String(err)}`,
      agentColor: '#ef4444',
      timestamp: Date.now(),
    })
    scrollToBottom()
  }
}

function clearChat(): void {
  chatMessages.value = []
}

// 右键菜单
function onMsgContextMenu(e: MouseEvent, msg: PrivateChatMessage): void {
  e.preventDefault()
  contextMenu.value = {
    visible: true,
    x: Math.min(e.clientX, window.innerWidth - 160),
    y: Math.min(e.clientY, window.innerHeight - 60),
    msg,
  }
}

async function onCopyMessage(): Promise<void> {
  const msg = contextMenu.value.msg
  if (msg) {
    await navigator.clipboard.writeText(msg.content)
  }
  contextMenu.value.visible = false
}

function closeContextMenu(): void {
  contextMenu.value.visible = false
}

watch(() => chatMessages.value.length, scrollToBottom)
watch(streamingText, scrollToBottom)

onMounted(() => {
  inputRef.value?.focus()
  document.addEventListener('click', closeContextMenu)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', closeContextMenu)
  if (backend) {
    backend.dispose()
    backend = null
  }
})
</script>

<style scoped>
.private-chat {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-surface);
  color: var(--color-text);
}

.private-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--color-border);
}

.btn-back {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--fs-sm);
  cursor: pointer;
  transition: background 0.15s;
}

.btn-back:hover { background: var(--color-surface-elevated); }

.agent-identity {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.agent-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-base);
  color: white;
}

.agent-name {
  font-weight: 600;
  font-size: var(--fs-base);
}

.btn-clear {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}

.btn-clear:hover { background: rgba(239, 68, 68, 0.1); color: #ef4444; border-color: rgba(239, 68, 68, 0.3); }

.private-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.private-msg { max-width: 85%; }
.private-msg.user { align-self: flex-end; }
.private-msg.assistant { align-self: flex-start; }

.msg-user-wrap { display: flex; flex-direction: column; align-items: flex-end; }

.msg-agent-wrap {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.msg-agent-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 100%;
}

.msg-avatar-sm {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-sm);
  flex-shrink: 0;
  color: white;
}

/* 思考过程 */
.msg-thinking {
  margin-bottom: 4px;
}

.msg-thinking details {
  border-radius: var(--radius-sm);
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  overflow: hidden;
}

.msg-thinking summary {
  padding: 6px 10px;
  font-size: var(--fs-xs);
  color: var(--color-text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  user-select: none;
}

.msg-thinking summary:hover { background: var(--color-surface); }

.thinking-content {
  padding: 8px 10px;
  font-size: var(--fs-sm);
  line-height: 1.5;
  color: var(--color-text-tertiary);
  white-space: pre-wrap;
  word-break: break-word;
  border-top: 1px solid var(--color-border);
  max-height: 200px;
  overflow-y: auto;
}

/* 工具调用 */
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
  border-radius: 4px;
  font-size: var(--fs-xs);
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
}

.tool-call-tag.running { border-color: var(--color-primary); color: var(--color-primary); }
.tool-call-tag.completed { border-color: rgba(16, 185, 129, 0.3); color: #10b981; }
.tool-call-tag.failed { border-color: rgba(239, 68, 68, 0.3); color: #ef4444; }

.tc-pulse { animation: pulse 1.5s infinite; }
.tc-done, .tc-fail { display: inline-flex; }

@keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }

/* ── 减弱动态偏好（prefers-reduced-motion）：停用工具调用脉冲 ──
   与 TuiButton/TuiModal/TuiDrawer/AgentWorkspace 同一可访问性语言：仅保留静态状态。 */
@media (prefers-reduced-motion: reduce) {
  .tc-pulse {
    animation: none;
  }
}

/* 消息气泡 */
.msg-bubble {
  padding: 8px 12px;
  border-radius: 12px;
  font-size: var(--fs-md);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.msg-bubble.user {
  background: var(--color-primary);
  color: white;
  border-radius: 12px 12px 4px 12px;
}

.msg-bubble.agent {
  background: var(--color-surface-elevated);
  border-radius: 12px 12px 12px 4px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}

.msg-bubble.agent :deep(p) { margin: 0 0 6px; }
.msg-bubble.agent :deep(p:last-child) { margin-bottom: 0; }
.msg-bubble.agent :deep(code) {
  background: var(--color-surface);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: var(--fs-sm);
  font-family: var(--font-mono, monospace);
}
.msg-bubble.agent :deep(pre) {
  background: var(--color-surface);
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  overflow-x: auto;
  margin: 6px 0;
}
.msg-bubble.agent :deep(pre code) {
  background: transparent;
  padding: 0;
}
.msg-bubble.agent :deep(ul), .msg-bubble.agent :deep(ol) {
  padding-left: 20px;
  margin: 4px 0;
}
.msg-bubble.agent :deep(blockquote) {
  border-left: 3px solid var(--color-primary);
  padding-left: 8px;
  margin: 6px 0;
  color: var(--color-text-secondary);
}
.msg-bubble.agent :deep(a) { color: var(--color-primary); text-decoration: none; }
.msg-bubble.agent :deep(a:hover) { text-decoration: underline; }
.msg-bubble.agent :deep(table) { border-collapse: collapse; margin: 6px 0; width: 100%; }
.msg-bubble.agent :deep(th), .msg-bubble.agent :deep(td) {
  border: 1px solid var(--color-border);
  padding: 4px 8px;
  font-size: var(--fs-sm);
}
.msg-bubble.agent :deep(th) { background: var(--color-surface); }

.msg-bubble.streaming {
  opacity: 0.9;
  border-left: 2px solid var(--color-primary);
}

.streaming-hint {
  color: var(--color-text-tertiary);
  font-style: italic;
}

/* 时间戳 */
.msg-time {
  font-size: 10px;
  color: var(--color-text-tertiary);
  margin-top: 2px;
}

.msg-time.user-time { text-align: right; }
.msg-time.agent-time { margin-left: 4px; }

/* 输入区 */
.private-input-area {
  padding: 8px 16px 16px;
  border-top: 1px solid var(--color-border);
}

.input-row {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

.chat-input {
  flex: 1;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-surface-elevated);
  color: var(--color-text);
  font-size: var(--fs-md);
  resize: none;
  font-family: inherit;
  line-height: 1.5;
  max-height: 120px;
  overflow-y: auto;
  transition: border-color 0.15s;
}

.chat-input:focus {
  outline: none;
  border-color: var(--color-primary);
}

.btn-send {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: none;
  background: var(--color-primary);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: filter 0.15s;
}

.btn-send:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-send:not(:disabled):hover { filter: brightness(1.1); }

/* 右键菜单 */
.context-menu {
  position: fixed;
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 4px;
  min-width: 100px;
  z-index: 10000;
}

.context-menu-item {
  padding: 8px 12px;
  font-size: var(--fs-sm);
  cursor: pointer;
  border-radius: 4px;
  color: var(--color-text);
}

.context-menu-item:hover { background: var(--color-surface); }
</style>