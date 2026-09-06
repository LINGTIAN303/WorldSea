<template>
  <div class="space-chat agent-panel">
    <template v-if="spaceStore.mode === 'chat'">
        <!-- [A2] 顶栏移除后：主对话区右上角工具行（单聊/群聊切换 + 右侧栏开关；2026-09-06 二者换位：单聊在前） -->
        <div class="chat-topbar">
          <div class="chat-topbar-right">
            <div
              class="mode-switch"
              role="button"
              tabindex="0"
              title="切换群聊"
              data-ws-tip-keys="Ctrl+T"
              @click="emit('toggle-mode')"
              @keydown.enter.prevent="emit('toggle-mode')"
              @keydown.space.prevent="emit('toggle-mode')"
            >
              <span class="mode-switch-label">
                <WsIcon name="chat" size="xs" />
                单聊
              </span>
            </div>
            <button
              class="chat-top-btn"
              :class="{ active: rightPanelOpen }"
              @click="emit('toggle-right-panel')"
              title="右侧栏（执行/配置/创作/预览/用量）"
              data-ws-tip-keys="Ctrl+Shift+B"
              :aria-pressed="rightPanelOpen"
            ><WsIcon :name="rightPanelOpen ? 'panel-right-close' : 'panel-right-open'" size="sm" /><span v-if="spaceStore.activityPinned" class="nav-badge"></span></button>
          </div>
        </div>
      <!-- 读屏直播区：告知 Agent 生成开始/完成（视觉隐藏，WCAG 4.1.3） -->
      <div class="sr-only" role="status" aria-live="polite">{{ srStatus }}</div>
      <div class="chat-messages" :aria-busy="isStreaming">
        <AgentMessageList
          ref="messageListRef"
          :messages="messages"
          :is-streaming="isStreaming"
          :last-assistant-has-content="lastAssistantHasContent"
          :last-assistant-has-thinking="lastAssistantHasThinking"
          :a2ui-surfaces="a2uiSurfaces"
          :resolve-data-binding="resolveDataBinding"
          :chat-mode="sessionMode"
          @a2ui-action="onA2UIAction"
          @copy="copyMessage"
          @retry="retryMessage"
          @block-action="onBlockAction"
        />
      </div>
      <ChatInput class="chat-input-dock" :class="{ docked: inputDocked }" @send="onInputSend" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, watch, computed } from 'vue'
import ChatInput from './ChatInput.vue'
import AgentMessageList from '@/agent/AgentMessageList.vue'
import { useAgent } from '@/agent/composables/useAgent'
import { useSpaceStore } from '../stores/space-store'
import { useSessionViewState } from '@/agent/composables/useSessionViewState'
import { useFileStore } from '@worldsmith/entity-core'
import { WsIcon } from '@worldsmith/ui-kit'
import type { ImageAttachment, FileAttachment } from '@agent/index'

const props = defineProps<{
  /** [A2] 右侧面板是否打开（顶栏移除后主对话区右上角开关需要） */
  rightPanelOpen?: boolean
}>()

const emit = defineEmits<{
  'toggle-right-panel': []
  'toggle-mode': []
}>()

const spaceStore = useSpaceStore()
// 聊天模式按会话隔离（viewState 权威），渲染与发送均用当前会话的模式
const sessionView = useSessionViewState()
const sessionMode = computed(() => sessionView.activeState.value?.chatMode ?? 'normal')
const {
  messages, isStreaming, sendMessage, steer,
  lastAssistantHasContent, lastAssistantHasThinking,
  a2uiSurfaces, resolveDataBinding,
} = useAgent()

// 读屏状态播报：生成开始/完成（视觉隐藏，仅 aria-live 播报）
const srStatus = ref('')
// [E2] 输入框定位：居中状态仅限空会话；有渲染消息的会话保持下沉
// （由消息数驱动而非"是否发送过"，切回旧会话/加载历史消息时同样保持下沉）
const inputDocked = computed(() => messages.value.length > 0)
watch(isStreaming, (streaming, wasStreaming) => {
  if (streaming) srStatus.value = 'Agent 正在生成回复'
  else if (wasStreaming) srStatus.value = 'Agent 回复完成'
})

const messageListRef = ref<InstanceType<typeof AgentMessageList>>()

function copyMessage(msg: { content?: string }): void {
  navigator.clipboard.writeText(msg.content || '').catch(() => {})
}

async function retryMessage(msg: { content?: string }): Promise<void> {
  if (isStreaming.value) return
  await sendMessage(msg.content || '')
  await nextTick()
  messageListRef.value?.scrollToBottom()
}

function onA2UIAction(surfaceId: string, action: { name: string; data?: any }): void {
  const dataStr = action.data ? JSON.stringify(action.data) : ''
  const steerText = dataStr
    ? `[A2UI Action] surface=${surfaceId} action=${action.name} data=${dataStr}`
    : `[A2UI Action] surface=${surfaceId} action=${action.name}`
  void steer(steerText)
}

function onBlockAction(event: { blockId: string; action: string; data?: Record<string, unknown> }): void {
  const dataStr = event.data ? JSON.stringify(event.data) : ''
  const steerText = dataStr
    ? `[Block Action] block=${event.blockId} action=${event.action} data=${dataStr}`
    : `[Block Action] block=${event.blockId} action=${event.action}`
  void steer(steerText)
}

async function onInputSend(text: string, rawAttachments: any[], references?: { id: string; name: string; type: string }[]): Promise<void> {
  if (isStreaming.value) return

  const images: ImageAttachment[] = []
  const files: FileAttachment[] = []
  const fileStore = useFileStore()

  for (const att of rawAttachments) {
    if (att.type === 'image') {
      images.push({ data: att.data, mimeType: att.mimeType })
    } else if (att.textContent !== undefined) {
      const path = `/uploads/${att.name}`
      const content = att.textContent
      const size = new Blob([content]).size
      try {
        await fileStore.add(att.name, path, att.mimeType || 'text/plain', size, content)
      } catch (err) {
        console.warn('[SpaceChat] fileStore.add failed:', err)
      }
      files.push({ name: att.name, content })
    }
  }

  // 实体引用：构造结构化上下文块，携带 id/名称/类型供 Agent 读取实体
  // C2 引用有效性校验：type 供 entity_get 的 expected_type 参数校验类型一致性，防引用错配
  const refsBlock = (references || []).length
    ? '\n' + references!.map((r) => `[世界设定引用 ${r.name}（type=${r.type}，id=${r.id}）\n  读取时调用 entity_get，并传 expected_type="${r.type}" 校验引用有效性]`).join('\n')
    : ''

  const finalText = (text || (images.length ? '请描述这张图片' : '')) + refsBlock
  await sendMessage(
    finalText,
    images.length ? images : undefined,
    files.length ? files : undefined,
    sessionMode.value,
  )
  await nextTick()
  messageListRef.value?.scrollToBottom()
}
</script>

<style scoped>
.space-chat {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  position: relative;
}

/* 输入框初始居中，发送首条消息后（.docked）下沉到底端
   用更高特异性覆盖 ChatInput 根元素 .chat-input-area 的 position:relative */
.space-chat .chat-input-dock {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  transition: transform 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}
.space-chat .chat-input-dock.docked {
  top: auto;
  bottom: 0;
  transform: translateY(0);
}

.chat-messages {
  flex: 1;
  overflow: hidden;
  padding: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* [2] 输入栏 .docked 为 absolute 浮在底部，会让消息流最后一行被遮挡。
       消息列表 .chat-messages 预留底部占位（≈输入栏 dock 态高度），使最后一行可滚到输入栏上方 */
.space-chat .chat-messages {
  padding-bottom: 0;
}
.space-chat:has(.chat-input-dock.docked) .chat-messages {
  padding-bottom: 76px;
}

/* [A2] 顶栏移除后主对话区右上角工具行：右对齐，不占主区高度 */
.chat-topbar {
  display: flex;
  justify-content: flex-end;
  flex-shrink: 0;
  height: 32px;
  padding: 0 10px;
  align-items: center;
}
.chat-topbar-right {
  display: flex;
  align-items: center;
  gap: 4px;
}
.chat-top-btn {
  position: relative;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  border-radius: var(--radius-sm);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}
.chat-top-btn:hover {
  background: var(--color-surface);
  color: var(--color-text-primary);
}
.chat-top-btn.active {
  background: var(--color-primary-muted);
  color: var(--color-text-primary);
}
/* 运行徽标（生成中活动红点，同 SpaceNavbar） */
.chat-topbar .nav-badge {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--danger, #ef4444);
  animation: chat-nav-badge-pulse 1.6s infinite;
}
@keyframes chat-nav-badge-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
/* 单聊 ⇄ 群聊 切换（胶囊，同 SpaceNavbar mode-switch 简化：静态填充态） */
.mode-switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 10px;
  gap: 4px;
  border-radius: 999px;
  background: var(--switch-bg);
  border: none;
  color: var(--switch-fg);
  cursor: pointer;
  overflow: hidden;
}
.mode-switch:hover {
  filter: brightness(1.1);
}
.mode-switch:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}
.mode-switch-label {
  position: relative;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--fs-2xs);
  font-weight: 600;
  color: var(--switch-fg);
  line-height: 1;
}
:root[data-anim-messages='off'] .chat-topbar .nav-badge {
  animation: none;
}
</style>
