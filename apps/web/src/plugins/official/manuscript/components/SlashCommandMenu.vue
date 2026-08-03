<template>
  <div v-if="visible" class="slash-command-menu" :style="{ left: pos.x + 'px', top: pos.y + 'px' }">
    <div
      v-for="(item, idx) in items"
      :key="item.id"
      class="sc-item"
      :class="{ active: selectedIdx === idx }"
      @click="selectItem(item)"
      @mouseenter="selectedIdx = idx"
    >
      <span class="sc-icon">{{ item.icon }}</span>
      <div class="sc-text">
        <span class="sc-label">{{ item.label }}</span>
        <span class="sc-desc">{{ item.description }}</span>
      </div>
    </div>
    <p v-if="items.length === 0" class="sc-empty">无匹配命令</p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { SlashCommandItem } from '../composables/slashCommandExtension'

const emit = defineEmits<{
  select: [item: SlashCommandItem]
  close: []
}>()

const visible = ref(false)
const items = ref<SlashCommandItem[]>([])
const selectedIdx = ref(0)
const pos = ref({ x: 0, y: 0 })

function open(clientRect: (() => DOMRect | null) | null, filteredItems: SlashCommandItem[]) {
  visible.value = true
  items.value = filteredItems
  selectedIdx.value = 0
  if (clientRect) {
    const rect = clientRect()
    if (rect) {
      pos.value = { x: rect.left, y: rect.bottom + 4 }
    }
  }
}

function close() {
  visible.value = false
  emit('close')
}

function updateItems(filteredItems: SlashCommandItem[]) {
  items.value = filteredItems
  selectedIdx.value = 0
}

function onKeyDown(event: KeyboardEvent): boolean {
  if (!visible.value) return false

  if (event.key === 'ArrowUp') {
    moveSelection(-1)
    return true
  }
  if (event.key === 'ArrowDown') {
    moveSelection(1)
    return true
  }
  if (event.key === 'Enter') {
    confirmSelection()
    return true
  }
  if (event.key === 'Escape') {
    close()
    return true
  }
  return false
}

function moveSelection(dir: number) {
  const len = items.value.length
  if (len === 0) return
  selectedIdx.value = ((selectedIdx.value + dir) % len + len) % len
}

function confirmSelection() {
  const item = items.value[selectedIdx.value]
  if (item) selectItem(item)
}

function selectItem(item: SlashCommandItem) {
  emit('select', item)
  visible.value = false
}

defineExpose({ open, close, updateItems, onKeyDown })
</script>

<style scoped>
.slash-command-menu {
  position: fixed;
  z-index: 200;
  background: var(--modal-bg);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 4px;
  width: 240px;
  max-height: 320px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.15);
  overflow-y: auto;
}
.sc-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  cursor: pointer;
  border-radius: 6px;
  font-size: var(--font-size-sm);
}
.sc-item:hover,
.sc-item.active {
  background: var(--hover-bg);
}
.sc-icon {
  font-size: var(--font-size-lg);
  flex-shrink: 0;
  width: 24px;
  text-align: center;
}
.sc-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.sc-label {
  font-weight: var(--font-weight-medium);
  color: var(--text-color);
}
.sc-desc {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-top: 1px;
}
.sc-empty {
  margin: 8px 0;
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  text-align: center;
}
</style>
