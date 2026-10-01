<template>
  <GenericTreeView
    :node="node"
    :depth="depth"
    :selected-id="selectedId"
    :batch-mode="batchMode"
    :selected-ids="selectedIds"
    @select="(e: any) => $emit('select', e)"
    @toggle-select="(id: string) => $emit('toggle-select', id)"
    @add-child="(e: any) => $emit('add-child', e)"
  >
    <template #icon="{ entity }">
      <WsIcon :name="orgIcon(entity)" size="xs" />
    </template>
    <template #typeLabel="{ entity }">
      {{ entity.properties.orgType as string || '' }}
    </template>
    <template #actions="{ entity }">
      <button class="tree-add" @click.stop="$emit('add-child', entity)" title="添加下属势力">＋</button>
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
  batchMode?: boolean
  selectedIds?: Set<string>
}>()

defineEmits<{
  select: [entity: any]
  'toggle-select': [id: string]
  'add-child': [entity: any]
}>()

function orgIcon(entity: any): string {
  const t = entity.properties.orgType as string
  const icons: Record<string, string> = {
    '王国': 'crown', '帝国': 'building', '共和国': 'building', '部落': 'camp',
    '公会': 'wrench', '教团': 'church', '商会': 'coin', '帮派': 'sword',
    '军事组织': 'sword', '秘密组织': 'scroll',
  }
  return icons[t] || 'organization'
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

