<template>
  <div class="faith-view">
    <SchemaRenderer type-key="faith" detail-carrier="column" :detail-tabs="faithTabs" :schema-loader="loadEntityTypeSchema" />
  </div>
</template>
<script setup lang="ts">
import { SchemaRenderer, type RelationTabDef } from '@worldsea/plugin-sdk'
import { schemaGetEntityType } from '@/core/coreBackend'

/** 实体类型 schema 加载器（从 WASM/后端生成，供 SchemaRenderer 注入） */
const loadEntityTypeSchema = (k: string) => schemaGetEntityType(k)

// 关系 Tab 用正向类型名（本实体为受端时加 reverseDirection，与 creatures/languages 同约定）
const faithTabs: RelationTabDef[] = [
  { id: 'believes_in', label: '信众', icon: 'user', relationType: 'believes_in', reverseDirection: true },
  { id: 'holy_site', label: '圣地', icon: 'location', relationType: 'holy_site' },
  { id: 'festival_of', label: '节日', icon: 'timeline', relationType: 'festival_of', reverseDirection: true },
]
</script>
<style scoped>
/* 根容器撑满视图高度，保证 SchemaRenderer → GenericEntityView 空状态可垂直居中 */
.faith-view { display: flex; flex-direction: column; height: 100%; }
</style>
