<template>
  <GenericTreeView
    :node="node"
    :depth="depth"
    :selected-id="selectedId"
    :show-checkbox="false"
    @select="(e: any) => $emit('select', e)"
    @add-child="(e: any) => $emit('add-child', e)"
  >
    <template #icon="{ entity }">
      <WsIcon :name="regionIcon(entity)" size="xs" />
    </template>
    <template #typeLabel="{ entity }">
      {{ entity.properties.regionType as string || '' }}
    </template>
    <template #actions="{ entity }">
      <button class="tree-add" @click.stop="$emit('add-child', entity)" title="添加下级">＋</button>
    </template>
  </GenericTreeView>
</template>

<script setup lang="ts">
import { GenericTreeView, type TreeNodeData } from '@worldsea/ui-kit'
import { WsIcon } from '@worldsea/ui-kit'

const props = defineProps<{
  node: TreeNodeData
  depth: number
  selectedId?: string
}>()

defineEmits<{
  select: [entity: any]
  'add-child': [entity: any]
}>()

function regionIcon(entity: any): string {
  const t = entity.properties.regionType as string
  const icons: Record<string, string> = {
    '大陆': 'globe', '国家': 'war', '行省': 'location',
    '城市': 'building', '地标': 'building',
  }
  return icons[t] || 'location'
}
</script>

<style scoped>
.tree-add {
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: var(--font-size-base);
  color: var(--text-tertiary);
  opacity: 0;
  border-radius: var(--radius-xs);
  transition: opacity 0.1s;
}
.tree-row:hover .tree-add {
  opacity: 1;
}
.tree-add:hover {
  background: var(--bg);
  color: var(--primary);
}
</style>

