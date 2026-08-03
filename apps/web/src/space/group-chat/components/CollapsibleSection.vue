<template>
  <div class="collapsible-section">
    <div class="section-header" @click="toggle">
      <span class="section-arrow" :class="{ open: isOpen }">▶</span>
      <span class="section-title">{{ title }}</span>
      <span v-if="badge" class="section-badge">{{ badge }}</span>
      <slot name="header-actions" />
    </div>
    <Transition name="collapse">
      <div v-if="isOpen" class="section-body">
        <slot />
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const props = withDefaults(
  defineProps<{
    title: string
    defaultOpen?: boolean
    badge?: string
  }>(),
  {
    defaultOpen: true,
    badge: undefined,
  }
)

const isOpen = ref(props.defaultOpen)

function toggle() {
  isOpen.value = !isOpen.value
}
</script>

<style scoped>
.collapsible-section {
  border-radius: 6px;
  overflow: hidden;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.2s;
}

.section-header:hover {
  background-color: rgba(255, 255, 255, 0.04);
}

.section-arrow {
  font-size: var(--font-size-2xs);
  color: var(--color-text-tertiary);
  transition: transform 0.25s ease;
  flex-shrink: 0;
}

.section-arrow.open {
  transform: rotate(90deg);
}

.section-title {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  font-weight: 500;
}

.section-badge {
  font-size: var(--font-size-2xs);
  color: var(--color-text-tertiary);
  background: rgba(255, 255, 255, 0.06);
  padding: 1px 6px;
  border-radius: 8px;
  line-height: 1.4;
}

.section-body {
  padding: 0 12px 8px 12px;
}

.collapse-enter-active,
.collapse-leave-active {
  transition: opacity 0.25s ease, max-height 0.25s ease;
  overflow: hidden;
}

.collapse-enter-from,
.collapse-leave-to {
  opacity: 0;
  max-height: 0;
}

.collapse-enter-to,
.collapse-leave-from {
  opacity: 1;
  max-height: 5000px;
}
</style>
