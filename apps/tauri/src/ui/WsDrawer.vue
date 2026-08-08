<template>
  <Teleport to="body">
    <Transition name="ws-drawer-overlay">
      <div v-if="show" class="ws-drawer-overlay" @click="onOverlayClick"></div>
    </Transition>
    <Transition :name="`ws-drawer-${placement}`" @after-enter="onAfterEnter" @before-leave="onBeforeLeave">
      <div
        v-if="show"
        :class="['ws-drawer', `ws-drawer--${placement}`, `ws-drawer--${size}`]"
        ref="drawerRef"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
      >
        <div class="ws-drawer__header">
          <span class="ws-drawer__title">{{ title }}</span>
          <button class="ws-drawer__close" aria-label="关闭" @click="$emit('close')"><WsIcon name="close" size="xs" /></button>
        </div>
        <div class="ws-drawer__body">
          <slot />
        </div>
        <div v-if="$slots.footer" class="ws-drawer__footer">
          <slot name="footer" />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, toRef } from 'vue'
import { useFocusTrap } from '@/composables/useFocusTrap'
import { WsIcon } from '@worldsmith/ui-kit'

const props = withDefaults(defineProps<{
  show: boolean
  title?: string
  placement?: 'left' | 'right'
  size?: 'sm' | 'md' | 'lg'
  closeOnOverlay?: boolean
}>(), {
  placement: 'right',
  size: 'md',
  closeOnOverlay: true,
})

const emit = defineEmits<{ close: [] }>()

const drawerRef = ref<HTMLElement | null>(null)

const { activate, deactivate } = useFocusTrap(drawerRef, {
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
.ws-drawer-overlay {
  position: fixed; inset: 0; z-index: var(--z-drawer);
  background: var(--color-overlay);
  backdrop-filter: blur(2px);
}

.ws-drawer {
  position: fixed; top: 0; z-index: var(--z-drawer-panel);
  height: 100vh; display: flex; flex-direction: column;
  background: var(--color-bg-surface);
  border-color: var(--color-border-subtle);
  box-shadow: var(--shadow-xl);
}

.ws-drawer--right { right: 0; border-left: 1px solid var(--color-border-subtle); }
.ws-drawer--left { left: 0; border-right: 1px solid var(--color-border-subtle); }

.ws-drawer--sm { width: 320px; }
.ws-drawer--md { width: 480px; }
.ws-drawer--lg { width: 640px; }

.ws-drawer__header {
  display: flex; align-items: center; justify-content: space-between;
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
}
.ws-drawer__title { font-size: var(--font-size-md); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); }
.ws-drawer__close {
  width: 28px; height: 28px; border: none; background: transparent;
  border-radius: var(--radius-sm); cursor: pointer; font-size: var(--font-size-base);
  color: var(--color-text-tertiary); display: flex; align-items: center; justify-content: center;
  transition: background var(--duration-fast) var(--ease-default), border-color var(--duration-fast) var(--ease-default), color var(--duration-fast) var(--ease-default), box-shadow var(--duration-fast) var(--ease-default), transform var(--duration-fast) var(--ease-default), opacity var(--duration-fast) var(--ease-default), filter var(--duration-fast) var(--ease-default);
}
.ws-drawer__close:hover { background: var(--color-bg-hover); color: var(--color-text-primary); }
.ws-drawer__close:focus-visible { box-shadow: var(--shadow-focus-ring); outline: none; }

.ws-drawer__body { flex: 1; overflow-y: auto; padding: var(--space-5); }

.ws-drawer__footer {
  padding: var(--space-4) var(--space-5);
  border-top: 1px solid var(--color-border-subtle);
  display: flex; gap: var(--space-2); justify-content: flex-end;
  flex-shrink: 0;
}
</style>
