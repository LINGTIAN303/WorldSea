<template>
  <!-- 性能优化：滚动锚定 - 用户向上滚动浏览历史时显示"回到底部"按钮，点击恢复跟随 -->
  <Transition name="ws-fade">
    <button
      v-if="visible"
      class="scroll-to-bottom-btn"
      @click="emit('click')"
      aria-label="回到底部"
    >
      <WsIcon name="chevron-down" size="sm" />
      <span v-if="newMsgCountWhileAway > 0" class="new-msg-badge">{{ newMsgCountWhileAway > 99 ? '99+' : newMsgCountWhileAway }}</span>
    </button>
  </Transition>
</template>

<script setup lang="ts">
import { WsIcon } from '@worldsmith/ui-kit'

defineProps<{
  visible: boolean
  newMsgCountWhileAway: number
}>()

const emit = defineEmits<{
  click: []
}>()
</script>

<style scoped>
.scroll-to-bottom-btn {
  position: absolute;
  right: 24px;
  bottom: 24px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid var(--agent-border, rgba(255, 255, 255, 0.1));
  background: var(--agent-bg, rgba(30, 30, 30, 0.9));
  color: var(--agent-text, #fff);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  transition: background 0.15s, transform 0.15s;
  z-index: 20;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.scroll-to-bottom-btn:hover {
  background: color-mix(in srgb, var(--agent-primary, #3b82f6) 15%, var(--agent-bg, rgba(30, 30, 30, 0.9)));
  transform: translateY(-2px);
}

.scroll-to-bottom-btn:active {
  transform: translateY(0);
}

.new-msg-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--agent-primary, #3b82f6);
  color: var(--on-accent);
  font-size: 10px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 0 2px var(--agent-bg, rgba(30, 30, 30, 0.9));
}

/* 回到底部按钮淡入淡出 */
.ws-fade-enter-active,
.ws-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.ws-fade-enter-from,
.ws-fade-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
