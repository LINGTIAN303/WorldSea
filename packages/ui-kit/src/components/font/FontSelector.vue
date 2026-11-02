<template>
  <div class="fs-wrap">
    <div class="fs-selected" @click="open = !open">
      <span class="fs-selected-text" :style="{ fontFamily: modelValue || 'inherit' }">
        {{ modelValue || placeholder }}
      </span>
      <span class="fs-arrow" :class="{ open }">▾</span>
    </div>
    <Transition name="fs-dropdown">
      <div v-if="open" class="fs-dropdown">
        <div class="fs-search-wrap">
          <input
            v-model="search"
            class="fs-search"
            placeholder="搜索字体..."
            @keydown.stop
          />
        </div>
        <div class="fs-list">
          <div
            v-for="f in filteredFonts"
            :key="f.family"
            class="fs-item"
            :class="{ active: f.family === modelValue }"
            :style="{ fontFamily: f.family }"
            @click="select(f.family)"
          >
            <span class="fs-item-name">{{ f.family }}</span>
            <span class="fs-item-count">{{ f.count }}</span>
          </div>
          <div v-if="!filteredFonts.length" class="fs-empty">无匹配字体</div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { list as listFonts } from '@worldsea/font-kit'

const props = withDefaults(defineProps<{
  modelValue?: string
  placeholder?: string
}>(), {
  modelValue: '',
  placeholder: '选择字体',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const open = ref(false)
const search = ref('')

const familyList = computed(() => {
  const all = listFonts()
  const map = new Map<string, number>()
  for (const f of all) {
    map.set(f.family, (map.get(f.family) || 0) + 1)
  }
  return Array.from(map.entries()).map(([family, count]) => ({ family, count }))
})

const filteredFonts = computed(() => {
  const q = search.value.toLowerCase().trim()
  if (!q) return familyList.value
  return familyList.value.filter(f => f.family.toLowerCase().includes(q))
})

function select(family: string) {
  emit('update:modelValue', family)
  open.value = false
  search.value = ''
}

function onClickOutside(e: MouseEvent) {
  if (!open.value) return
  const el = (e.target as HTMLElement)?.closest?.('.fs-wrap')
  if (!el) {
    open.value = false
    search.value = ''
  }
}

onMounted(() => document.addEventListener('click', onClickOutside, true))
onBeforeUnmount(() => document.removeEventListener('click', onClickOutside, true))
</script>

<style scoped>
.fs-wrap {
  position: relative;
  width: 100%;
}

.fs-selected {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm, 4px);
  background: var(--input-bg);
  color: var(--text, var(--text-primary));
  font-size: var(--font-size-sm);
  cursor: pointer;
  transition: border-color 0.15s;
}

.fs-selected:hover {
  border-color: var(--accent);
}

.fs-selected-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fs-arrow {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  transition: transform 0.15s;
}

.fs-arrow.open {
  transform: rotate(180deg);
}

.fs-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: var(--z-dropdown, 100);
  background: var(--modal-bg, var(--bg-secondary));
  border: 1px solid var(--border);
  border-radius: var(--radius-md, 8px);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: 260px;
}

.fs-search-wrap {
  padding: 6px;
  border-bottom: 1px solid var(--border);
}

.fs-search {
  width: 100%;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm, 4px);
  background: var(--input-bg);
  color: var(--text);
  font-size: var(--font-size-xs);
  outline: none;
}

.fs-search:focus {
  border-color: var(--accent);
}

.fs-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}

.fs-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: var(--radius-sm, 4px);
  cursor: pointer;
  font-size: var(--font-size-sm);
  color: var(--text, var(--text-primary));
  transition: background 0.12s;
}

.fs-item:hover {
  background: var(--hover-bg, rgba(0, 0, 0, 0.05));
}

.fs-item.active {
  background: var(--accent-bg, rgba(167, 139, 250, 0.12));
  color: var(--accent);
}

.fs-item-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fs-item-count {
  font-size: var(--font-size-2xs, 9px);
  color: var(--text-tertiary);
  background: var(--bg-tertiary);
  padding: 1px 5px;
  border-radius: 3px;
}

.fs-empty {
  padding: 16px;
  text-align: center;
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.fs-dropdown-enter-active,
.fs-dropdown-leave-active {
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease, opacity 0.15s ease, filter 0.15s ease;
}

.fs-dropdown-enter-from,
.fs-dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>