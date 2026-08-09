<template>
  <Teleport to="body">
    <Transition name="ws-confirm">
      <div v-if="state.show" class="ws-confirm-overlay" @click.self="doCancel">
        <div class="ws-confirm" ref="confirmRef" role="alertdialog" aria-modal="true" :aria-labelledby="titleId" :aria-describedby="descId">
          <div class="ws-confirm__icon" :class="`ws-confirm__icon--${state.type}`">
            <WsIcon :name="iconName" size="md" />
          </div>
          <h3 :id="titleId" class="ws-confirm__title">{{ state.title }}</h3>
          <p v-if="state.description" :id="descId" class="ws-confirm__desc">{{ state.description }}</p>
          <div class="ws-confirm__actions">
            <TuiButton variant="ghost" size="sm" @click="doCancel">{{ state.cancelText }}</TuiButton>
            <TuiButton :variant="state.type === 'danger' ? 'danger' : 'primary'" size="sm" @click="doConfirm">{{ state.confirmText }}</TuiButton>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useConfirm } from '@worldsmith/plugin-sdk'
import { useFocusTrap } from '@/composables/useFocusTrap'
import { WsIcon } from '@worldsmith/ui-kit'
import TuiButton from '@/components/ui/TuiButton.vue'

const { state, doConfirm, doCancel } = useConfirm()
const confirmRef = ref<HTMLElement | null>(null)

const titleId = 'ws-confirm-title'
const descId = 'ws-confirm-desc'

const iconName = computed(() => {
  const map: Record<string, string> = { info: 'search', warning: 'warning', danger: 'close' }
  return map[state.value.type] || 'search'
})

const { activate, deactivate } = useFocusTrap(confirmRef, {
  active: computed(() => state.value.show),
  restoreFocus: true,
  escapeDeactivates: true,
  onEscape: () => doCancel(),
})

watch(() => state.value.show, (v) => {
  if (v) nextTick(() => activate())
  else deactivate()
})
</script>

<style scoped>
.ws-confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  background: var(--overlay);
  backdrop-filter: blur(var(--overlay-blur));
  -webkit-backdrop-filter: blur(var(--overlay-blur));
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.ws-confirm {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  padding: 24px;
  min-width: 320px;
  max-width: 420px;
  text-align: center;
}

.ws-confirm__icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 16px;
}
.ws-confirm__icon--info { background: var(--accent-soft); color: var(--info); }
.ws-confirm__icon--warning { background: var(--warning-soft); color: var(--warning); }
.ws-confirm__icon--danger { background: var(--danger-soft); color: var(--danger); }

.ws-confirm__title {
  font-size: var(--fs-lg);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 8px;
}

.ws-confirm__desc {
  font-size: var(--fs-sm);
  color: var(--text-secondary);
  margin: 0 0 20px;
  line-height: var(--lh-md);
  white-space: pre-line;
}

.ws-confirm__actions {
  display: flex;
  gap: 8px;
  justify-content: center;
}

/* 过渡：遮罩淡入 + 面板轻微缩放（与 TuiModal 一致） */
.ws-confirm-enter-active,
.ws-confirm-leave-active {
  transition: opacity var(--dur-lg) var(--ease);
}
.ws-confirm-enter-active .ws-confirm,
.ws-confirm-leave-active .ws-confirm {
  transition: transform var(--dur-lg) var(--ease-out), opacity var(--dur-lg) var(--ease);
}
.ws-confirm-enter-from,
.ws-confirm-leave-to {
  opacity: 0;
}
.ws-confirm-enter-from .ws-confirm,
.ws-confirm-leave-to .ws-confirm {
  opacity: 0;
  transform: translateY(6px) scale(0.98);
}
/* 减弱动态偏好：去掉位移/缩放，保留淡入（Emil 可访问性规则） */
@media (prefers-reduced-motion: reduce) {
  .ws-confirm-enter-active .ws-confirm,
  .ws-confirm-leave-active .ws-confirm {
    transition: opacity var(--dur-lg) var(--ease);
  }
  .ws-confirm-enter-from .ws-confirm,
  .ws-confirm-leave-to .ws-confirm {
    transform: none;
  }
}
</style>
