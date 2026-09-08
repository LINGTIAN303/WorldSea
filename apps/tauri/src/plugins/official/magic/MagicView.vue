<template>
  <div class="magic-view">
    <div v-if="viewMode === 'tree'" class="mv-tree">
      <SkillTreeView @back="viewMode = 'list'" />
    </div>
    <SchemaRenderer v-else type-key="magic" :additional-filter="levelFn" :detail-tabs="magicTabs" :schema-loader="loadEntityTypeSchema">
      <template #toolbar-extra>
        <CustomDropdown v-model="levelFilter" :options="levelFilterOpts" />
        <button class="mv-tree-btn" @click="viewMode = 'tree'" title="技能树视图">
          <WsIcon name="family-tree" :size="14" :stroke-width="1.5" />
          技能树
        </button>
      </template>
    </SchemaRenderer>
  </div>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import { SchemaRenderer, CustomDropdown, type RelationTabDef } from '@worldsea/plugin-sdk'
import SkillTreeView from './SkillTreeView.vue'
import type { Entity } from '@worldsea/entity-core'
import { useAgentPluginBridge } from '@/composables/useAgentPluginBridge'
import { schemaGetEntityType } from '@/core/coreBackend'

/** 实体类型 schema 加载器（从 WASM/后端加载，供 SchemaRenderer 注入） */
const loadEntityTypeSchema = (k: string) => schemaGetEntityType(k)

const viewMode = ref<'list' | 'tree'>('list')
const levelFilter = ref('')
const levelOptions = ['入门', '初级', '中级', '高级', '大师', '传说', '神级']
const levelFilterOpts = [{ value: '', label: '全等级' }, ...levelOptions.map(l => ({ value: l, label: l }))]

function levelFn(e: Entity): boolean {
  if (!levelFilter.value) return true
  return e.properties.level === levelFilter.value
}

const magicTabs: RelationTabDef[] = [
  { id: 'upgrades_to', label: '前置/进阶', icon: 'link', relationType: 'upgrades_to' },
  { id: 'counters', label: '克制关系', icon: 'shield', relationType: 'counters' },
]

useAgentPluginBridge('magic', (event) => {
  console.log(`[Agent→${event.pluginId}] ${event.action}`, event.payload)
})
</script>
<style scoped>
/* 根容器撑满视图高度，保证 SchemaRenderer → GenericEntityView 空状态可垂直居中 */
.magic-view { display: flex; flex-direction: column; height: 100%; }
.mv-tree-btn {
  display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px;
  border: 1px solid var(--color-border); border-radius: var(--radius-xs); background: var(--color-bg-elevated);
  color: var(--color-text-primary); font-size: var(--font-size-sm); cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; white-space: nowrap;
}
.mv-tree-btn:hover { background: var(--color-bg-hover); border-color: var(--color-text-secondary); color: var(--color-text-primary); }

</style>
