<template>
  <div class="magic-view">
    <div v-if="viewMode === 'tree'" class="mv-tree">
      <SkillTreeView @back="viewMode = 'list'" />
    </div>
    <SchemaRenderer v-else type-key="magic" :additional-filter="levelFn" :detail-tabs="magicTabs">
      <template #toolbar-extra>
        <CustomDropdown v-model="levelFilter" :options="levelFilterOpts" />
        <button class="mv-tree-btn" @click="viewMode = 'tree'" title="技能树视图">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="8" cy="3" r="2"/><circle cx="4" cy="11" r="2"/><circle cx="12" cy="11" r="2"/>
            <line x1="8" y1="5" x2="4" y2="9"/><line x1="8" y1="5" x2="12" y2="9"/>
          </svg>
          技能树
        </button>
      </template>
    </SchemaRenderer>
  </div>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import { SchemaRenderer, CustomDropdown, type RelationTabDef } from '@worldsmith/plugin-sdk'
import SkillTreeView from './SkillTreeView.vue'
import type { Entity } from '@worldsmith/entity-core'
import { useAgentPluginBridge } from '../../../composables/useAgentPluginBridge'

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
.mv-tree-btn {
  display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px;
  border: 1px solid var(--color-border); border-radius: 4px; background: var(--color-bg-elevated);
  color: var(--color-text-primary); font-size: var(--font-size-sm); cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; white-space: nowrap;
}
.mv-tree-btn:hover { background: var(--color-bg-hover); border-color: var(--color-text-secondary); color: var(--color-text-primary); }

</style>
