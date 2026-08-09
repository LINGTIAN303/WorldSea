<template>
  <div class="weapon-view">
    <div v-if="viewMode === 'lineage'" class="wv-lineage">
      <WeaponLineageView @back="viewMode = 'list'" />
    </div>
    <SchemaRenderer v-else type-key="item" :additional-filter="isWeaponItem" :detail-tabs="weaponTabs" facet-on-create="weapon" :schema-loader="loadEntityTypeSchema">
      <template #toolbar-extra>
        <button class="wv-lin-btn" @click="viewMode = 'lineage'" title="传承谱系视图">
          <WsIcon name="family-tree" :size="16" :stroke-width="1.5" />
          谱系
        </button>
      </template>
    </SchemaRenderer>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { SchemaRenderer, type RelationTabDef } from '@worldsmith/plugin-sdk'
import WeaponLineageView from './WeaponLineageView.vue'
import { schemaGetEntityType } from '@/core/coreBackend'

/** 实体类型 schema 加载器（从 WASM/后端加载，供 SchemaRenderer 注入） */
const loadEntityTypeSchema = (k: string) => schemaGetEntityType(k)

const viewMode = ref<'list' | 'lineage'>('list')

/** 过滤出包含 weapon facet 的 item 实体 */
function isWeaponItem(entity: any): boolean {
  return entity?.facets?.weapon != null || entity?.properties?.itemType === '武器'
}

const weaponTabs: RelationTabDef[] = [
  { id: 'wielded_by', label: '持有者', icon: 'user', relationType: 'wielded_by', reverseDirection: true },
  { id: 'related_weapon', label: '关联武器', icon: 'link', relationType: 'related_weapon' },
  { id: 'used_in_battle', label: '关联战役', icon: 'shield', relationType: 'used_in_battle', reverseDirection: true },
]
</script>

<style scoped>
.weapon-view { height: 100%; }

.wv-lin-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  font-size: var(--font-size-sm);
  font-family: inherit;
  color: var(--text-secondary, #aaa);
  background: var(--bg-secondary, #222);
  border: 1px solid var(--border, #333);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}
.wv-lin-btn:hover {
  color: var(--text-primary, #eee);
  background: var(--bg-tertiary, #333);
}
</style>
