<template>
  <div class="ws-popover-wrapper" ref="wrapperRef">
    <div class="ws-popover-trigger" ref="triggerRef" @click="toggle" :aria-expanded="visible" aria-haspopup="true">
      <slot name="trigger" />
    </div>
    <Teleport to="body">
      <Transition name="ws-popover">
        <div
          v-if="visible"
          :class="['ws-popover', `ws-popover--${placement}`]"
          :style="positionStyle"
          ref="popoverRef"
        >
          <div v-if="title" class="ws-popover__title">{{ title }}</div>
          <div class="ws-popover__content">
            <slot />
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onBeforeUnmount, watch } from 'vue'

const props = withDefaults(defineProps<{
  title?: string
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'bottom-end'
  trigger?: 'click' | 'hover'
  closeOnClickOutside?: boolean
  offset?: number
}>(), {
  placement: 'bottom',
  trigger: 'click',
  closeOnClickOutside: true,
  offset: 6,
})

const emit = defineEmits<{ 'update:show': [value: boolean] }>()

const triggerRef = ref<HTMLElement | null>(null)
const popoverRef = ref<HTMLElement | null>(null)
const visible = ref(false)
const pos = ref({ top: 0, left: 0 })

function toggle() {
  if (props.trigger === 'click') {
    visible.value = !visible.value
    if (visible.value) nextTick(updatePosition)
  }
}

function updatePosition() {
  if (!triggerRef.value) return
  const rect = triggerRef.value.getBoundingClientRect()
  const gap = props.offset
  switch (props.placement) {
    case 'top':
      pos.value = { top: rect.top - gap, left: rect.left + rect.width / 2 }
      break
    case 'bottom':
      pos.value = { top: rect.bottom + gap, left: rect.left + rect.width / 2 }
      break
    case 'left':
      pos.value = { top: rect.top + rect.height / 2, left: rect.left - gap }
      break
    case 'right':
      pos.value = { top: rect.top + rect.height / 2, left: rect.right + gap }
      break
  }
}

const positionStyle = computed(() => {
  const base: Record<string, string> = {}
  switch (props.placement) {
    case 'top':
      base.bottom = `${window.innerHeight - pos.value.top}px`
      base.left = `${pos.value.left}px`
      base.transform = 'translateX(-50%)'
      break
    case 'bottom':
      base.top = `${pos.value.top}px`
      base.left = `${pos.value.left}px`
      base.transform = 'translateX(-50%)'
      break
    case 'left':
      base.right = `${window.innerWidth - pos.value.left}px`
      base.top = `${pos.value.top}px`
      base.transform = 'translateY(-50%)'
      break
    case 'right':
      base.left = `${pos.value.left}px`
      base.top = `${pos.value.top}px`
      base.transform = 'translateY(-50%)'
      break
  }
  return base
})

function onClickOutside(e: MouseEvent) {
  if (!visible.value) return
  if (!props.closeOnClickOutside) return
  const target = e.target as Node
  if (triggerRef.value?.contains(target)) return
  if (popoverRef.value?.contains(target)) return
  visible.value = false
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && visible.value) {
    visible.value = false
  }
}

onMounted(() => {
  document.addEventListener('mousedown', onClickOutside)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onClickOutside)
  document.removeEventListener('keydown', onKeydown)
})

watch(visible, (val) => {
  emit('update:show', val)
})
</script>

<style scoped>
.ws-popover-wrapper { display: inline-flex; }
.ws-popover-trigger { display: inline-flex; }

.ws-popover {
  position: fixed; z-index: var(--z-popover);
  background: var(--dropdown-bg);
  border: 1px solid var(--dropdown-border);
  border-radius: var(--dropdown-radius);
  box-shadow: var(--dropdown-shadow);
  min-width: 160px; max-width: 360px;
  padding: var(--space-2);
}

.ws-popover__title {
  font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary); padding: var(--space-1) var(--space-2);
  border-bottom: 1px solid var(--color-border-subtle);
  margin-bottom: var(--space-1);
}

.ws-popover__content { }

.ws-popover-enter-active { transition: opacity var(--duration-fast) var(--ease-default), transform var(--duration-fast) var(--ease-default); }
.ws-popover-leave-active { transition: opacity var(--duration-instant) var(--ease-default); }
.ws-popover-enter-from, .ws-popover-leave-to { opacity: 0; }

.ws-popover--top.ws-popover-enter-from { transform: translateX(-50%) translateY(4px); }
.ws-popover--bottom.ws-popover-enter-from { transform: translateX(-50%) translateY(-4px); }
.ws-popover--left.ws-popover-enter-from { transform: translateY(-50%) translateX(4px); }
.ws-popover--right.ws-popover-enter-from { transform: translateY(-50%) translateX(-4px); }
</style>
