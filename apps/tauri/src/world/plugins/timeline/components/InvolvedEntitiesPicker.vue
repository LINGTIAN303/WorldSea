<template>
  <div class="iep">
    <div class="iep-chips">
      <span v-for="entity in selectedEntities" :key="entity.id" class="iep-chip">
        {{ entity.name }}
        <button type="button" class="iep-chip-remove" :aria-label="`移除 ${entity.name}`" @click="remove(entity.id)">✕</button>
      </span>
      <span v-if="selectedEntities.length === 0" class="iep-empty">未选择；角色日程冲突检测只比对这里关联的角色/组织</span>
    </div>
    <div class="iep-search">
      <input
        v-model="query" class="iep-input" placeholder="搜索角色或组织..."
        @focus="open = true" @blur="open = false"
      />
      <div v-if="open && candidates.length" class="iep-list">
        <button
          v-for="entity in candidates" :key="entity.id" type="button" class="iep-item"
          @mousedown.prevent="pick(entity.id)"
        >
          <span class="iep-name">{{ entity.name }}</span>
          <span class="iep-type">{{ typeLabel(entity.type) }}</span>
        </button>
      </div>
      <p v-else-if="open && query.trim()" class="iep-none">没有匹配的角色/组织</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Entity } from '@worldsea/entity-core'
import { entitiesSvc, relationsSvc } from '../serviceAccess'

const props = withDefaults(defineProps<{
  modelValue?: string[]
  /** 编辑既有事件时从关系回填（新建时为空） */
  eventId?: string
  types?: string[]
}>(), {
  modelValue: () => [],
  eventId: undefined,
  types: () => ['character', 'organization'],
})

const emit = defineEmits<{ 'update:modelValue': [ids: string[]] }>()

const entities = entitiesSvc()
const relations = relationsSvc()
const query = ref('')
const open = ref(false)
const selected = ref<string[]>([...props.modelValue])

const selectedEntities = computed(() => (
  selected.value.map(id => entities.get(id)).filter((item): item is Entity => !!item)
))
const candidates = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  return entities.list()
    .filter(item => props.types.includes(item.type))
    .filter(item => !selected.value.includes(item.id))
    .filter(item => !keyword || item.name.toLowerCase().includes(keyword))
    .slice(0, 8)
})

function typeLabel(type: string): string {
  return type === 'character' ? '角色' : type === 'organization' ? '组织' : type
}
function apply(next: string[]) {
  selected.value = next
  emit('update:modelValue', next)
}
function pick(id: string) {
  apply([...selected.value, id])
  query.value = ''
  open.value = false
}
function remove(id: string) {
  apply(selected.value.filter(item => item !== id))
}

/** 表单在同一个弹窗里切换编辑对象：按 eventId 重新回填（新建时清空） */
watch(() => props.eventId, eventId => {
  const ids = new Set<string>()
  if (eventId) {
    for (const relation of relations.list()) {
      if (relation.type === 'involves' && relation.sourceId === eventId) ids.add(relation.targetId)
      else if (relation.type === 'involved_in_event' && relation.targetId === eventId) ids.add(relation.sourceId)
    }
  }
  const next = [...ids]
  if (next.join('|') !== selected.value.join('|')) apply(next)
}, { immediate: true })
</script>

<style scoped>
.iep { display: flex; flex-direction: column; gap: 6px; }
.iep-chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; min-height: 26px; }
.iep-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px 2px 8px;
  font-size: var(--font-size-xs);
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--primary) 30%, transparent);
  border-radius: var(--radius-xs);
}
.iep-chip-remove {
  padding: 0 4px;
  font-size: var(--font-size-xs);
  color: inherit;
  cursor: pointer;
  background: transparent;
  border: none;
  line-height: 1;
}
.iep-empty { font-size: var(--font-size-xs); color: var(--text-tertiary); }
.iep-search { position: relative; }
.iep-input {
  width: 100%;
  padding: 7px 10px;
  font-size: var(--font-size-base);
  color: var(--text-color);
  background: var(--input-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  outline: none;
}
.iep-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--focus-ring); }
.iep-list {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 20;
  max-height: 220px;
  overflow-y: auto;
  padding: 4px;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-dropdown);
}
.iep-item {
  display: flex;
  width: 100%;
  gap: 8px;
  padding: 6px 8px;
  font-size: var(--font-size-sm);
  color: var(--text-color);
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
}
.iep-item:hover { background: var(--color-bg-hover); }
.iep-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.iep-type { color: var(--text-tertiary); font-size: var(--font-size-xs); }
.iep-none { margin: 4px 0 0; font-size: var(--font-size-xs); color: var(--text-tertiary); }
</style>
