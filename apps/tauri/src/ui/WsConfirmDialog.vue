<template>
  <Teleport to="body">
    <Transition name="ws-scale-fade">
      <div v-if="state.show" class="ws-confirm-overlay" @click.self="doCancel">
        <div class="ws-confirm" ref="confirmRef" role="alertdialog" aria-modal="true" :aria-labelledby="titleId" :aria-describedby="descId">
          <div class="ws-confirm__icon" :class="`ws-confirm__icon--${state.type}`">
            <WsIcon :name="iconName" size="md" />
          </div>
          <h3 :id="titleId" class="ws-confirm__title">{{ state.title }}</h3>
          <p v-if="state.description" :id="descId" class="ws-confirm__desc">{{ state.description }}</p>
          <div class="ws-confirm__actions">
            <button class="ws-confirm__cancel" @click="doCancel">{{ state.cancelText }}</button>
            <button class="ws-confirm__ok" :class="`ws-confirm__ok--${state.type}`" @click="doConfirm">{{ state.confirmText }}</button>
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
  background: var(--color-overlay);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.ws-confirm {
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-modal);
  padding: var(--space-6);
  min-width: 320px;
  max-width: 420px;
  text-align: center;
}

.ws-confirm__icon {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-full);
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto var(--space-4);
}
.ws-confirm__icon--info { background: color-mix(in srgb, var(--color-primary) 15%, transparent); color: var(--color-info); }
.ws-confirm__icon--warning { background: rgba(245, 158, 11, 0.15); color: var(--color-warning); }
.ws-confirm__icon--danger { background: rgba(239, 68, 68, 0.15); color: var(--color-danger); }

.ws-confirm__title {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  margin: 0 0 var(--space-2);
}

.ws-confirm__desc {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin: 0 0 var(--space-5);
  line-height: var(--line-height-relaxed);
}

.ws-confirm__actions {
  display: flex;
  gap: var(--space-2);
  justify-content: center;
}

.ws-confirm__cancel {
  padding: var(--space-2) var(--space-4);
  background: var(--color-bg-surface);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-btn);
  cursor: pointer;
  font-size: var(--font-size-sm);
  transition: background var(--duration-fast) var(--ease-default), border-color var(--duration-fast) var(--ease-default), color var(--duration-fast) var(--ease-default), box-shadow var(--duration-fast) var(--ease-default), transform var(--duration-fast) var(--ease-default), opacity var(--duration-fast) var(--ease-default), filter var(--duration-fast) var(--ease-default);
}
.ws-confirm__cancel:hover { background: var(--color-bg-hover); color: var(--color-text-primary); }
.ws-confirm__cancel:focus-visible { box-shadow: 0 0 0 2px var(--color-primary); outline: none; }

.ws-confirm__ok {
  padding: var(--space-2) var(--space-4);
  border: 1px solid transparent;
  border-radius: var(--radius-btn);
  cursor: pointer;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  transition: background var(--duration-fast) var(--ease-default), border-color var(--duration-fast) var(--ease-default), color var(--duration-fast) var(--ease-default), box-shadow var(--duration-fast) var(--ease-default), transform var(--duration-fast) var(--ease-default), opacity var(--duration-fast) var(--ease-default), filter var(--duration-fast) var(--ease-default);
}
.ws-confirm__ok--info { background: var(--color-info); color: #fff; }
.ws-confirm__ok--info:hover { filter: brightness(1.1); }
.ws-confirm__ok--warning { background: var(--color-warning); color: #fff; }
.ws-confirm__ok--warning:hover { filter: brightness(1.1); }
.ws-confirm__ok--danger { background: var(--color-danger); color: var(--color-text-inverse); }
.ws-confirm__ok--danger:hover { filter: brightness(1.1); }
.ws-confirm__ok:focus-visible { box-shadow: 0 0 0 2px var(--color-primary); outline: none; }
</style>
