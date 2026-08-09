<template>
  <div v-if="visible" class="mention-popover" :style="{ left: pos.x + 'px', top: pos.y + 'px' }">
    <input
      ref="inputRef"
      v-model="query"
      class="mention-input"
      placeholder="搜索实体..."
      @keydown.down.prevent="moveSelection(1)"
      @keydown.up.prevent="moveSelection(-1)"
      @keydown.enter.prevent="confirmSelection"
      @keydown.escape.prevent="close"
    />
    <div class="mention-results">
      <div
        v-for="(item, idx) in filteredItems"
        :key="item.id"
        class="mention-item"
        :class="{ active: selectedIdx === idx }"
        @click="selectItem(item)"
        @mouseenter="selectedIdx = idx"
      >
        <span class="mi-icon"><WsIcon :name="item.icon" size="xs" /></span>
        <span class="mi-name">{{ item.name }}</span>
        <span class="mi-type">{{ item.typeLabel }}</span>
      </div>
      <p v-if="filteredItems.length === 0 && query" class="mention-empty">无结果</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { useEntityStore } from '@worldsmith/entity-core'
import { entitySchemaRegistry } from '@worldsmith/entity-core'

interface MentionItem {
  id: string
  name: string
  type: string
  typeLabel: string
  icon: string
}

const emit = defineEmits<{
  select: [item: MentionItem]
  close: []
}>()

const es = useEntityStore()
const visible = ref(false)
const query = ref('')
const selectedIdx = ref(0)
const pos = ref({ x: 0, y: 0 })
const inputRef = ref<HTMLInputElement | null>(null)

const allItems = computed<MentionItem[]>(() => {
  return (es.entities ?? []).map(e => ({
    id: e.id,
    name: e.name,
    type: e.type,
    typeLabel: entitySchemaRegistry.getLabel(e.type),
    icon: entitySchemaRegistry.getIconName(e.type) || 'outline',
  }))
})

const filteredItems = computed(() => {
  if (!query.value) return allItems.value.slice(0, 20)
  const q = query.value.toLowerCase()
  return allItems.value.filter(i =>
    i.name.toLowerCase().includes(q) || i.typeLabel.toLowerCase().includes(q)
  ).slice(0, 20)
})

function open(clientRect: (() => DOMRect | null) | null) {
  visible.value = true
  query.value = ''
  selectedIdx.value = 0
  if (clientRect) {
    const rect = clientRect()
    if (rect) {
      pos.value = { x: rect.left, y: rect.bottom + 4 }
    }
  }
  nextTick(() => {
    inputRef.value?.focus()
  })
}

function close() {
  visible.value = false
  emit('close')
}

function moveSelection(dir: number) {
  const len = filteredItems.value.length
  if (len === 0) return
  selectedIdx.value = ((selectedIdx.value + dir) % len + len) % len
}

function confirmSelection() {
  const item = filteredItems.value[selectedIdx.value]
  if (item) selectItem(item)
}

function selectItem(item: MentionItem) {
  emit('select', item)
  visible.value = false
}

watch(query, () => {
  selectedIdx.value = 0
})

defineExpose({ open, close })
</script>

<style scoped>
.mention-popover {
  position: fixed;
  z-index: 200;
  background: var(--modal-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-mid);
  padding: 8px;
  width: 260px;
  max-height: 300px;
  box-shadow: var(--shadow-md);
  display: flex;
  flex-direction: column;
}
.mention-input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xs);
  font-size: var(--font-size-sm);
  background: var(--input-bg);
  color: var(--text-color);
  box-sizing: border-box;
  margin-bottom: 4px;
}
.mention-results {
  overflow-y: auto;
  max-height: 220px;
}
.mention-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  cursor: pointer;
  border-radius: var(--radius-xs);
  font-size: var(--font-size-sm);
}
.mention-item:hover,
.mention-item.active {
  background: var(--hover-bg);
}
.mi-icon { font-size: var(--font-size-base); flex-shrink: 0; }
.mi-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mi-type { font-size: var(--font-size-xs); color: var(--text-tertiary); flex-shrink: 0; }
.mention-empty { margin: 8px 0 0; font-size: var(--font-size-sm); color: var(--text-tertiary); text-align: center; }
</style>
