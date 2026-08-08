<template>
  <Teleport to="body">
    <Transition name="ws-modal" @after-enter="onAfterEnter" @before-leave="onBeforeLeave">
      <div v-if="show" class="ws-modal-overlay" @click.self="onOverlayClick">
        <div
          :class="['ws-modal', `ws-modal--${size}`]"
          ref="modalRef"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
        >
          <div v-if="title || $slots.header" class="ws-modal__header">
            <slot name="header">
              <h3 class="ws-modal__title">{{ title }}</h3>
            </slot>
            <button class="ws-modal__close" aria-label="关闭" @click="$emit('close')"><WsIcon name="close" size="xs" /></button>
          </div>
          <div class="ws-modal__body"><slot /></div>
          <div v-if="$slots.footer" class="ws-modal__footer"><slot name="footer" /></div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, toRef } from 'vue'
import { useFocusTrap } from '../composables/useFocusTrap'
import { WsIcon } from '@worldsmith/ui-kit'

const props = withDefaults(defineProps<{
  show: boolean
  title?: string
  size?: 'sm' | 'md' | 'lg'
  closeOnOverlay?: boolean
}>(), {
  size: 'md',
  closeOnOverlay: true,
})

const emit = defineEmits<{ close: [] }>()

const modalRef = ref<HTMLElement | null>(null)

const { activate, deactivate } = useFocusTrap(modalRef, {
  active: toRef(props, 'show'),
  restoreFocus: true,
  escapeDeactivates: true,
  onEscape: () => emit('close'),
})

function onOverlayClick() {
  if (props.closeOnOverlay) emit('close')
}

function onAfterEnter() {
  activate()
}

function onBeforeLeave() {
  deactivate()
}
</script>

<style scoped>
.ws-modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--modal-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-modal);
  backdrop-filter: blur(8px);
}

.ws-modal {
  background: var(--modal-bg);
  border: 1px solid var(--modal-border);
  border-radius: var(--modal-radius);
  box-shadow: var(--modal-shadow);
  max-height: 80vh;
  overflow-y: auto;
  width: 90%;
}
.ws-modal--sm { max-width: 400px; }
.ws-modal--md { max-width: 540px; }
.ws-modal--lg { max-width: 720px; }

.ws-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-5) var(--space-6) var(--space-3);
}
.ws-modal__title { font-size: var(--font-size-lg); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); margin: 0; }
.ws-modal__close {
  width: 28px; height: 28px; border: none; background: transparent;
  border-radius: var(--radius-sm); cursor: pointer; font-size: var(--font-size-base);
  color: var(--color-text-tertiary); display: flex; align-items: center; justify-content: center;
  transition: background var(--duration-fast) var(--ease-default), border-color var(--duration-fast) var(--ease-default), color var(--duration-fast) var(--ease-default), box-shadow var(--duration-fast) var(--ease-default), transform var(--duration-fast) var(--ease-default), opacity var(--duration-fast) var(--ease-default), filter var(--duration-fast) var(--ease-default);
}
.ws-modal__close:hover { background: var(--color-bg-hover); color: var(--color-text-primary); }
.ws-modal__close:focus-visible { box-shadow: var(--shadow-focus-ring); outline: none; }

.ws-modal__body { padding: var(--space-4) var(--space-6); }
.ws-modal__footer { padding: var(--space-3) var(--space-6) var(--space-5); display: flex; gap: var(--space-2); justify-content: flex-end; }
</style>
