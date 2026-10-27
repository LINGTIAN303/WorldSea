<template>
  <div class="creature-view">
    <SchemaRenderer type-key="creature" detail-carrier="column" :detail-tabs="creatureTabs" :schema-loader="loadEntityTypeSchema" />
  </div>
</template>
<script setup lang="ts">
import { SchemaRenderer, type RelationTabDef } from '@worldsea/plugin-sdk'
import { schemaGetEntityType } from '@/core/coreBackend'

/** 实体类型 schema 加载器（从 WASM/后端加载，供 SchemaRenderer 注入） */
const loadEntityTypeSchema = (k: string) => schemaGetEntityType(k)

// 关系 Tab 用正向类型名（本实体为受端时加 reverseDirection，与 languages/buildings 同约定）
const creatureTabs: RelationTabDef[] = [
  { id: 'inhabits', label: '栖息区域', icon: 'location', relationType: 'inhabits' },
  { id: 'drops', label: '产出物品', icon: 'item', relationType: 'drops' },
  { id: 'hunts', label: '猎人', icon: 'user', relationType: 'hunts', reverseDirection: true },
  { id: 'tames', label: '契约者', icon: 'user', relationType: 'tames', reverseDirection: true },
]
</script>
<style scoped>
/* 根容器撑满视图高度，保证 SchemaRenderer → GenericEntityView 空状态可垂直居中 */
.creature-view { display: flex; flex-direction: column; height: 100%; }
</style>
