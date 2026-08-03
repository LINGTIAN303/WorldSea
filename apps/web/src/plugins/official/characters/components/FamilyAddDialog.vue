<template>
  <div v-if="visible" class="fad-overlay" @click.self="$emit('close')">
    <div class="fad-dialog">
      <h4 class="fad-title">{{ title }}</h4>
      <div class="fad-mode-toggle">
        <button :class="{ active: mode === 'search' }" @click="mode = 'search'">搜索已有角色</button>
        <button :class="{ active: mode === 'create' }" @click="mode = 'create'">新建角色</button>
      </div>
      <div v-if="mode === 'search'" class="fad-search">
        <input v-model="searchQuery" class="fad-input" placeholder="搜索角色名称..." />
        <div class="fad-results">
          <div v-for="c in searchResults" :key="c.id" class="fad-result-item" @click="selectExisting(c)">
            <span>{{ c.name }}</span>
            <span class="fad-result-sub">{{ c.properties?.gender || '' }} {{ c.properties?.race || '' }}</span>
          </div>
          <p v-if="searchResults.length === 0" class="fad-empty">无匹配角色</p>
        </div>
      </div>
      <div v-else class="fad-create">
        <input v-model="newName" class="fad-input" placeholder="角色名称" />
        <select v-model="newGender" class="fad-select">
          <option value="">性别</option>
          <option value="男">男</option>
          <option value="女">女</option>
          <option value="未知">未知</option>
        </select>
      </div>
      <div class="fad-actions">
        <button class="fad-btn-cancel" @click="$emit('close')">取消</button>
        <button class="fad-btn-confirm" @click="confirm" :disabled="!canConfirm">确认</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useEntityStore } from '@worldsmith/entity-core'
import type { Entity } from '@worldsmith/entity-core'

const props = defineProps<{
  visible: boolean
  title: string
  relationType: string
  excludeIds: string[]
}>()

const emit = defineEmits<{
  close: []
  confirm: [payload: { entityId: string; isNew: boolean; name?: string; gender?: string }]
}>()

const entityStore = useEntityStore()
const mode = ref<'search' | 'create'>('search')
const searchQuery = ref('')
const newName = ref('')
const newGender = ref('')
const selectedId = ref('')

const allCharacters = computed(() =>
  entityStore.entities.filter(e => e.type === 'character' && !props.excludeIds.includes(e.id))
)

const searchResults = computed(() => {
  const q = searchQuery.value.toLowerCase()
  if (!q) return allCharacters.value.slice(0, 10)
  return allCharacters.value.filter(c => c.name.toLowerCase().includes(q)).slice(0, 10)
})

function selectExisting(c: Entity) {
  selectedId.value = c.id
  searchQuery.value = c.name
}

const canConfirm = computed(() => {
  if (mode.value === 'search') return !!selectedId.value
  return newName.value.trim().length > 0
})

function confirm() {
  if (mode.value === 'search' && selectedId.value) {
    emit('confirm', { entityId: selectedId.value, isNew: false })
  } else if (mode.value === 'create' && newName.value.trim()) {
    emit('confirm', { entityId: '', isNew: true, name: newName.value.trim(), gender: newGender.value })
  }
}
</script>

<style scoped>
.fad-overlay { position: absolute; inset: 0; z-index: 300; background: rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; }
.fad-dialog { background: var(--card-bg, #fff); border-radius: 10px; padding: 16px; width: 280px; box-shadow: 0 8px 24px rgba(0,0,0,0.2); }
.fad-title { margin: 0 0 10px; font-size: var(--font-size-base); color: var(--text-color); }
.fad-mode-toggle { display: flex; gap: 0; margin-bottom: 10px; border: 1px solid var(--border-color); border-radius: 6px; overflow: hidden; }
.fad-mode-toggle button { flex: 1; padding: 6px 0; font-size: var(--font-size-sm); border: none; background: transparent; color: var(--text-secondary); cursor: pointer; }
.fad-mode-toggle button.active { background: var(--primary, #7c3aed); color: #fff; }
.fad-input, .fad-select { width: 100%; padding: 7px 10px; border: 1px solid var(--border-color); border-radius: 6px; font-size: var(--font-size-sm); margin-bottom: 8px; background: var(--input-bg, #fff); color: var(--text-color); }
.fad-results { max-height: 150px; overflow-y: auto; }
.fad-result-item { padding: 6px 8px; cursor: pointer; border-radius: 4px; display: flex; justify-content: space-between; }
.fad-result-item:hover { background: var(--bg-secondary, #f5f5f5); }
.fad-result-sub { font-size: var(--font-size-xs); color: var(--text-tertiary); }
.fad-empty { text-align: center; color: var(--text-tertiary); font-size: var(--font-size-sm); padding: 12px; }
.fad-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
.fad-btn-cancel { padding: 5px 14px; border: 1px solid var(--border-color); border-radius: 6px; background: transparent; color: var(--text-secondary); cursor: pointer; font-size: var(--font-size-sm); }
.fad-btn-confirm { padding: 5px 14px; border: none; border-radius: 6px; background: var(--primary, #7c3aed); color: #fff; cursor: pointer; font-size: var(--font-size-sm); }
.fad-btn-confirm:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
