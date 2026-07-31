<template>
  <Teleport to="body">
    <div class="toast-container" role="alert" aria-live="assertive">
      <TransitionGroup name="ws-toast">
        <div v-for="t in toasts" :key="t.id" class="toast-item" :class="t.type">
          <span class="toast-icon"><WsIcon :name="icons[t.type]" size="xs" /></span>
          <span class="toast-msg">{{ t.msg }}</span>
          <button v-if="t.action" class="toast-action" @click="t.action.handler">{{ t.action.label }}</button>
          <button class="toast-close" aria-label="关闭" @click="dismiss(t.id)">×</button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useToast } from '../../composables/useToast'
import WsIcon from '../WsIcon.vue'

const icons: Record<string, string> = { success: 'check', error: 'close', info: 'search', warn: 'warning' }
const { toasts, dismiss } = useToast()
</script>

<style scoped>
.toast-container {
  position: fixed;
  bottom: 30px;
  right: 20px;
  z-index: 10000;
  display: flex;
  flex-direction: column-reverse;
  gap: 8px;
  pointer-events: none;
}

.toast-item {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 18px;
  border-radius: var(--radius-lg, 10px);
  font-size: var(--font-size-sm);
  box-shadow: var(--shadow-lg, 0 8px 30px rgba(0,0,0,0.15));
  backdrop-filter: blur(var(--glass-blur, 16px));
  min-width: 220px;
  max-width: 400px;
  border: 1px solid rgba(255,255,255,0.1);
}

.toast-item.success { background: rgba(34, 197, 94, 0.85); color: #fff; }
.toast-item.error { background: rgba(239, 68, 68, 0.85); color: #fff; }
.toast-item.info { background: rgba(59, 130, 246, 0.85); color: #fff; }
.toast-item.warn { background: color-mix(in srgb, var(--color-warning) 85%, transparent); color: #fff; }

.toast-icon {
  font-size: var(--font-size-base);
  flex-shrink: 0;
}

.toast-msg {
  flex: 1;
}

.toast-action {
  background: rgba(255,255,255,0.2);
  border: 1px solid rgba(255,255,255,0.4);
  color: #fff;
  cursor: pointer;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  padding: 3px 10px;
  border-radius: 4px;
  white-space: nowrap;
  transition: background 0.12s;
}

.toast-action:hover {
  background: rgba(255,255,255,0.35);
}

.toast-close {
  background: none;
  border: none;
  color: rgba(255,255,255,0.6);
  cursor: pointer;
  font-size: var(--font-size-base);
  padding: 0 0 0 8px;
  line-height: 1;
}

.toast-close:hover {
  color: rgba(255,255,255,0.9);
}
</style>
