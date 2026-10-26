<template>
  <Transition name="g-panel">
    <aside v-if="visible && group" class="g-type-panel" aria-label="类型星座">
      <div class="g-type-head">
        <WsIcon :name="group.icon" size="sm" class="g-type-icon" />
        <span class="g-type-name">{{ group.label }}</span>
        <span class="g-type-count">{{ group.count }}</span>
        <button class="g-type-close" aria-label="关闭类型列表" @click="$emit('close')">
          <WsIcon name="close" size="xs" />
        </button>
      </div>
      <div class="g-type-search">
        <WsIcon name="search" size="xs" class="g-type-search-icon" />
        <input v-model="query" class="g-type-search-input" placeholder="在此类型中搜索..." aria-label="在当前类型中搜索" />
      </div>
      <div class="g-type-body">
        <button
          v-for="node in filtered"
          :key="node.id"
          class="g-type-row"
          @click="$emit('select-node', node)"
        >
          <WsIcon :name="node.typeIcon" size="xs" class="g-type-row-icon" />
          <span class="g-type-row-name">{{ node.name }}</span>
          <span class="g-type-row-degree">{{ node.degree }}</span>
        </button>
        <div v-if="filtered.length === 0" class="g-type-empty">没有匹配的实体</div>
      </div>
      <div class="g-type-foot">点击实体定位并查看关系</div>
    </aside>
  </Transition>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import type { OverviewGroup, OverviewNode } from '../model/types'

const props = defineProps<{
  visible: boolean
  group: OverviewGroup | null
  nodes: OverviewNode[]
}>()

defineEmits<{
  close: []
  'select-node': [node: OverviewNode]
}>()

const query = ref('')

watch(() => props.group?.id, () => { query.value = '' })

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return props.nodes
  return props.nodes.filter(node => node.name.toLowerCase().includes(q))
})
</script>

<style scoped>
.g-type-panel {
  position: absolute; left: 12px; top: 56px; width: 262px;
  max-height: calc(100% - 200px); display: flex; flex-direction: column;
  border: 1px solid var(--g-panel-border, rgba(255,255,255,0.1)); border-radius: var(--radius-mid);
  background: var(--g-panel-bg, rgba(8,12,20,0.94)); backdrop-filter: blur(12px);
  z-index: 9; overflow: hidden;
}
.g-type-head { display: flex; align-items: center; gap: 7px; padding: 10px 12px 8px; border-bottom: 1px solid var(--g-panel-border, rgba(255,255,255,0.08)); }
.g-type-icon { color: var(--g-accent, #6ea8fe); flex-shrink: 0; }
.g-type-name { flex: 1; min-width: 0; font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--g-text-strong, #e2e8f0); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.g-type-count { font-size: var(--font-size-xs); color: var(--g-text-dim, #94a3b8); font-variant-numeric: tabular-nums; }
.g-type-close { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; border: none; border-radius: var(--radius-xs); background: transparent; color: var(--g-text-dim, #94a3b8); cursor: pointer; }
.g-type-close:hover { color: var(--g-text-strong, #e2e8f0); background: var(--g-hover, rgba(255,255,255,0.08)); }
.g-type-search { display: flex; align-items: center; gap: 5px; margin: 8px 10px 6px; padding: 4px 8px; border: 1px solid var(--g-panel-border, rgba(255,255,255,0.1)); border-radius: var(--radius-sm); background: var(--g-hover, rgba(255,255,255,0.04)); }
.g-type-search-icon { color: var(--g-text-dim, #94a3b8); flex-shrink: 0; }
.g-type-search-input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; color: var(--g-text, #cbd5e1); font-size: var(--font-size-xs); }
.g-type-search-input::placeholder { color: var(--g-text-dim, #94a3b8); }
.g-type-body { flex: 1; min-height: 0; overflow-y: auto; padding: 2px 6px 8px; }
.g-type-row { display: flex; align-items: center; gap: 6px; width: 100%; padding: 4px 6px; border: none; border-radius: var(--radius-xs); background: transparent; color: var(--g-text, #cbd5e1); font-size: var(--font-size-xs); text-align: left; cursor: pointer; }
.g-type-row:hover { background: var(--g-hover, rgba(255,255,255,0.06)); }
.g-type-row-icon { color: var(--g-text-dim, #94a3b8); flex-shrink: 0; }
.g-type-row-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.g-type-row-degree { color: var(--g-text-dim, #94a3b8); font-variant-numeric: tabular-nums; }
.g-type-empty { padding: 14px 8px; font-size: var(--font-size-xs); color: var(--g-text-dim, #94a3b8); text-align: center; }
.g-type-foot { padding: 6px 12px; border-top: 1px solid var(--g-panel-border, rgba(255,255,255,0.08)); font-size: var(--font-size-xs); color: var(--g-text-dim, #94a3b8); }
.g-panel-enter-active, .g-panel-leave-active { transition: opacity 0.16s ease, transform 0.16s ease; }
.g-panel-enter-from, .g-panel-leave-to { opacity: 0; transform: translateX(-8px); }
</style>
