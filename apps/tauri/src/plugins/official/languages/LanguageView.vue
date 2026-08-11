<template>
  <div class="language-view">
    <div v-if="viewMode === 'tree'" class="lv-tree">
      <LanguageFamilyTreeView @back="viewMode = 'list'" />
    </div>
    <SchemaRenderer v-else type-key="language" :detail-tabs="languageTabs" :schema-loader="loadEntityTypeSchema">
      <template #toolbar-extra>
        <button class="lv-tree-btn" @click="viewMode = 'tree'" title="语系树视图">
          <WsIcon name="family-tree" :size="14" :stroke-width="1.5" />
          语系树
        </button>
      </template>
    </SchemaRenderer>
  </div>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { SchemaRenderer, type RelationTabDef } from '@worldsmith/plugin-sdk'
import LanguageFamilyTreeView from './LanguageFamilyTreeView.vue'
import { schemaGetEntityType } from '@/core/coreBackend'

/** 实体类型 schema 加载器（从 WASM/后端加载，供 SchemaRenderer 注入） */
const loadEntityTypeSchema = (k: string) => schemaGetEntityType(k)

const viewMode = ref<'list' | 'tree'>('list')
const languageTabs: RelationTabDef[] = [
  { id: 'derived_from', label: '分支来源', icon: 'link', relationType: 'derived_from' },
  { id: 'spoken_by', label: '使用者', icon: 'user', relationType: 'spoken_by', reverseDirection: true },
]
</script>
<style scoped>
/* 根容器撑满视图高度，保证 SchemaRenderer → GenericEntityView 空状态可垂直居中 */
.language-view { display: flex; flex-direction: column; height: 100%; }
.lv-tree-btn {
  display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px;
  border: 1px solid var(--color-border); border-radius: var(--radius-xs); background: var(--color-bg-elevated);
  color: var(--color-text-primary); font-size: var(--font-size-sm); cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; white-space: nowrap;
}
.lv-tree-btn:hover { background: var(--color-bg-hover); border-color: var(--color-text-secondary); color: var(--color-text-primary); }

</style>
