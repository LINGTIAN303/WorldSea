<template>
  <div class="ems">
    <input
      v-model="query"
      class="ems-search"
      type="search"
      placeholder="搜索实体名…"
      aria-label="搜索实体"
    />
    <div v-if="selected.length" class="ems-selected">
      <span v-for="id in selected" :key="id" class="ems-chip" :title="nameOf(id)">
        {{ nameOf(id) }}
        <button class="ems-chip-x" :aria-label="`移除 ${nameOf(id)}`" @click="toggle(id)">×</button>
      </span>
    </div>
    <div class="ems-list">
      <label v-for="e in filtered" :key="e.id" class="ems-item">
        <input type="checkbox" :checked="selected.includes(e.id)" @change="toggle(e.id)" />
        <span class="ems-name">{{ e.name }}</span>
        <span class="ems-type">{{ e.type }}</span>
      </label>
      <p v-if="!filtered.length" class="ems-empty">无匹配实体</p>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 实体多选（2026-10-25 形象图批 C #17：视频封面「仅指定实体自动播放」的实体选择器）。
 * 独立组件以免 AppearancePanel（已超架构冻结线）继续膨胀；搜索过滤 + 已选芯片 + 复选列表。
 */
import { computed, ref } from 'vue'
import { useEntityStore } from '@worldsea/entity-core'

const props = defineProps<{ modelValue: string[] }>()
const emit = defineEmits<{ 'update:modelValue': [ids: string[]] }>()

const entityStore = useEntityStore()
const query = ref('')

const selected = computed(() => props.modelValue)

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  const all = entityStore.entities
  if (!q) return all.slice(0, 50)
  return all.filter((e) => e.name.toLowerCase().includes(q)).slice(0, 50)
})

function nameOf(id: string): string {
  return entityStore.entities.find((e) => e.id === id)?.name ?? id.slice(0, 8)
}

function toggle(id: string) {
  const next = selected.value.includes(id)
    ? selected.value.filter((x) => x !== id)
    : [...selected.value, id]
  emit('update:modelValue', next)
}
</script>

<style scoped>
.ems { display: flex; flex-direction: column; gap: 6px; width: 100%; }
.ems-search {
  padding: 4px 8px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  background: var(--input-bg);
  color: var(--text-color);
}
.ems-selected { display: flex; flex-wrap: wrap; gap: 4px; }
.ems-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 1px 4px 1px 8px;
  border-radius: 10px;
  background: var(--primary-light, #eef2ff);
  color: var(--primary, #4f46e5);
  font-size: var(--font-size-xs);
  max-width: 140px;
}
.ems-chip span, .ems-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ems-chip-x {
  border: none;
  background: none;
  color: inherit;
  cursor: pointer;
  padding: 0 4px;
  font-size: 12px;
  line-height: 1;
}
.ems-list {
  max-height: 180px;
  overflow-y: auto;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  padding: 4px;
}
.ems-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
  font-size: var(--font-size-xs);
  cursor: pointer;
  border-radius: 4px;
}
.ems-item:hover { background: var(--hover-bg); }
.ems-item input { accent-color: var(--primary); }
.ems-name { flex: 1; min-width: 0; }
.ems-type { color: var(--text-tertiary); font-size: 10px; }
.ems-empty { margin: 4px; font-size: var(--font-size-xs); color: var(--text-tertiary); }
</style>
