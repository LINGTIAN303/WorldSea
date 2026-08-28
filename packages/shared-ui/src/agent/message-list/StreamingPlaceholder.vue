<template>
  <!-- [A] scanner 等候输出动画：助手无内容无思考时替换原光标占位 -->
  <div v-if="isStreaming && !lastAssistantHasContent && !lastAssistantHasThinking" class="chat-msg msg-assistant">
    <span class="msg-icon">
      <!-- #icon 插槽：由宿主注入品牌 logo 替换默认图标（默认保留 profile 图标） -->
      <slot name="icon"><WsIcon name="profile" size="xs" /></slot>
    </span>
    <div class="msg-body">
      <div class="loader">
        <div class="scanner">
          <span :data-text="scanningText" aria-label="正在等待" role="status">{{ scanningText }}</span>
        </div>
      </div>
    </div>
  </div>
  <!-- 流式思考中提示：助手有思考但尚无正文内容 -->
  <div v-if="isStreaming && lastAssistantHasThinking && !lastAssistantHasContent" class="streaming-thinking-hint">
    <WsIcon name="manuscript" size="xs" /> 思考中<span class="thinking-dots">{{ dotText }}</span>
  </div>
</template>

<script setup lang="ts">
import { WsIcon } from '@worldsmith/ui-kit'

const scanningText = '正在处理…'

defineProps<{
  isStreaming: boolean
  lastAssistantHasContent: boolean
  lastAssistantHasThinking: boolean
  /** 人格字体对应的进入动画名（保留，scanner 形态下暂不驱动） */
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

/* [A] scanner「Loading...」霓虹扫描动画（原型样式，颜色随 --agent-primary 主题化） */
.loader {
  display: inline-flex;
  align-items: center;
}
.scanner span {
  color: transparent;
  font-size: 1.4rem;
  position: relative;
  overflow: hidden;
}
.scanner span::before {
  content: attr(data-text);
  position: absolute;
  top: 0;
  left: 0;
  width: 0;
  height: 100%;
  border-right: 4px solid var(--agent-primary, #17FEFF);
  overflow: hidden;
  color: var(--agent-primary, #17FEFF);
  animation: load91371 2s linear infinite;
  font-family: var(--agent-font);
}

@keyframes load91371 {
  0%, 10%, 100% {
    width: 0;
  }
  10%,20%,30%,40%,50%,60%,70%,80%,90%,100% {
    border-right-color: transparent;
  }
  11%,21%,31%,41%,51%,61%,71%,81%,91% {
    border-right-color: var(--agent-primary, #17FEFF);
  }
  60%, 80% {
    width: 100%;
  }
}

:root[data-anim-messages='off'] .scanner span::before {
  animation: none;
  width: 100%;
  color: var(--agent-text, #17FEFF);
}

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

@keyframes ws-msg-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>