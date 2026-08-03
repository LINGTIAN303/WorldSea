<template>
  <!-- 流式输出占位：助手无内容无思考时显示光标 -->
  <div v-if="isStreaming && !lastAssistantHasContent && !lastAssistantHasThinking" class="chat-msg msg-assistant">
    <span class="msg-icon"><WsIcon name="profile" size="xs" /></span>
    <div class="msg-body">
      <span class="streaming-cursor" :class="`cursor-${enterAnimation}`">●</span>
    </div>
  </div>
  <!-- 流式思考中提示：助手有思考但尚无正文内容 -->
  <div v-if="isStreaming && lastAssistantHasThinking && !lastAssistantHasContent" class="streaming-thinking-hint">
    <WsIcon name="manuscript" size="xs" /> 思考中<span class="thinking-dots">{{ dotText }}</span>
  </div>
</template>

<script setup lang="ts">
import { WsIcon } from '@worldsmith/ui-kit'

defineProps<{
  isStreaming: boolean
  lastAssistantHasContent: boolean
  lastAssistantHasThinking: boolean
  /** 人格字体对应的进入动画名（用于光标动画样式选择） */
  enterAnimation: string
  /** 思考中省略号文本（由 useDotAnimation 提供） */
  dotText: string
}>()
</script>

<style scoped>
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
</style>
