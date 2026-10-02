<template>
  <GenericEntityView
    entity-type="organization"
    :form-fields="orgFields"
    :filter-defs="filterDefs"
    :custom-tabs="customTabs"
    :detail-tabs="detailTabs"
    :card-footer-fields="cardFooterFields"
    card-subtitle="orgType"
    :icon-fn="orgIconFn"
    entity-label="势力"
    id-prefix="org"
    @select-entity="onSelectEntity"
  >
    <!-- Tree list view via list slot -->
    <template #list="{ entities, selectedIds: batchIds, toggleSelect: batchToggle, select: gevSelect, batchMode }">
      <div class="org-tree" :class="{ 'is-empty': entities.length === 0 }">
        <OrgTreeNode
          v-for="node in buildTree(entities)"
          :key="node.entity.id"
          :node="node"
          :depth="0"
          :selected-id="selectedOrgId ?? undefined"
          :batch-mode="batchMode"
          :selected-ids="batchIds"
          @select="gevSelect"
          @toggle-select="batchToggle"
          @add-child="openNewFormWithParent"
        />
        <WsEmpty v-if="entities.length === 0" title="暂无势力" description="点击上方按钮创建第一个势力">
          <template #icon><WsIcon name="organization" size="xl" /></template>
        </WsEmpty>
      </div>
    </template>

    <!-- Members tab -->
    <template #tab-members="{ entity }">
      <div v-for="m in getMembers(entity.id)" :key="m.relation.id" class="rel-item">
        <span class="rel-name">{{ m.character?.name || '(未知)' }}</span>
        <span v-if="m.relation.properties.role" class="rel-role">{{ m.relation.properties.role }}</span>
        <button class="rel-remove" @click="removeRelation(m.relation.id)" title="移除"><WsIcon name="close" size="xs" /></button>
      </div>
      <p v-if="getMembers(entity.id).length === 0" class="rel-empty">尚无成员</p>
      <EntityRelationSelector :entity-id="entity.id" entity-type="organization" relation-type="member_of" :reverse-direction="true" />
    </template>

    <!-- Sub-factions tab -->
    <template #tab-subfactions="{ entity }">
      <div v-for="sub in getSubOrgs(entity.id)" :key="sub.id" class="rel-item" role="button" tabindex="0" @click="onSelectEntity(sub)" @keydown.enter="onSelectEntity(sub)">
        <WsIcon :name="orgIconFn(sub)" size="xs" /> {{ sub.name }}
        <button class="rel-remove" @click.stop="removeSubOrg(sub.id, entity.id)" title="移除"><WsIcon name="close" size="xs" /></button>
      </div>
      <p v-if="getSubOrgs(entity.id).length === 0" class="rel-empty">尚无下属势力</p>
      <EntityRelationSelector :entity-id="entity.id" entity-type="organization" relation-type="sub_organization" :reverse-direction="true" />
    </template>

    <!-- Territories tab -->
    <template #tab-territories="{ entity }">
      <div v-for="t in getTerritories(entity.id)" :key="t.relation.id" class="rel-item">
        <span class="rel-name">{{ t.region?.name || '(未知)' }}</span>
        <button class="rel-remove" @click="removeRelation(t.relation.id)" title="移除"><WsIcon name="close" size="xs" /></button>
      </div>
      <p v-if="getTerritories(entity.id).length === 0" class="rel-empty">尚无控制区域</p>
      <EntityRelationSelector :entity-id="entity.id" entity-type="organization" relation-type="controls" />
    </template>

    <!-- Diplomacy tab -->
    <template #tab-diplomacy="{ entity }">
      <div v-for="rel in getDiplomacy(entity.id)" :key="rel.relation.id" class="rel-item" :class="rel.class">
        <WsIcon :name="rel.icon" size="xs" /> {{ rel.label }}
        <button class="rel-remove" @click="removeRelation(rel.relation.id)" title="移除"><WsIcon name="close" size="xs" /></button>
      </div>
      <p v-if="getDiplomacy(entity.id).length === 0" class="rel-empty">尚无外交关系</p>
      <EntityRelationSelector :entity-id="entity.id" entity-type="organization" relation-type="allied_with" />
    </template>
  </GenericEntityView>

  <!-- Parent hint for new org with parent -->
  <div v-if="showParentHint && parentCandidate" class="efm-parent-hint">
    上级势力：{{ parentCandidate.name }}
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { GenericEntityView, EntityRelationSelector, type FilterDef, type CardFieldDef, type CustomTabDef, type RelationTabDef } from '@worldsea/plugin-sdk'
import { WsIcon } from '@worldsea/ui-kit'
import { WsEmpty } from '@worldsea/ui-kit'
import { useEntityStore, useRelationStore } from '@worldsea/entity-core'
import type { Entity } from '@worldsea/entity-core'
import OrgTreeNode from './OrgTreeNode.vue'
import { orgFields, orgIconOf } from './organizationConfig'

const entityStore = useEntityStore()
const relationStore = useRelationStore()

const selectedOrgId = ref<string | null>(null)
const parentCandidate = ref<Entity | null>(null)
const showParentHint = ref(false)

/* ─── Form fields (from config) ─── */

const filterDefs: FilterDef[] = [
  { key: 'orgType', label: '类型', dynamic: true },
  { key: 'size', label: '规模', dynamic: true },
  { key: 'alignment', label: '阵营', dynamic: true },
]

const customTabs: CustomTabDef[] = [
  { id: 'members', label: '成员', icon: 'user' },
  { id: 'subfactions', label: '下属势力', icon: 'building' },
  { id: 'territories', label: '控制区域', icon: 'location' },
  { id: 'diplomacy', label: '外交', icon: 'link' },
]

const detailTabs: RelationTabDef[] = []

const cardFooterFields: CardFieldDef[] = [
  { key: 'orgType', type: 'tag' },
]

/* ─── Icon function ─── */

function orgIconFn(org: Entity): string {
  // 委托单一来源（organizationConfig.orgTypeIconMap），原内联副本已分叉故收敛
  return orgIconOf(org)
}

/* ─── Tree building ─── */

interface OrgTreeNodeData {
  entity: Entity
  children: OrgTreeNodeData[]
}

const subOrgRels = computed(() => relationStore.relations.filter(r => r.type === 'sub_organization'))

function buildTree(entities: Entity[]): OrgTreeNodeData[] {
  const childIds = new Set(subOrgRels.value.map(r => r.sourceId))
  const topLevel = entities.filter(o => !childIds.has(o.id))

  function buildNodes(list: Entity[]): OrgTreeNodeData[] {
    return list.map(e => ({
      entity: e,
      children: buildNodes(entities.filter(c =>
        subOrgRels.value.some(r => r.sourceId === c.id && r.targetId === e.id)
      )),
    }))
  }

  return buildNodes(topLevel)
}

/* ─── Tab data helpers ─── */

const orgList = computed(() => entityStore.entities.filter(e => e.type === 'organization'))

function getMembers(entityId: string) {
  const rels = relationStore.relations.filter(r => r.type === 'member_of' && r.targetId === entityId)
  return rels.map(r => ({
    relation: r,
    character: entityStore.entityMap.get(r.sourceId),
  }))
}

function getSubOrgs(entityId: string) {
  const childIds = subOrgRels.value.filter(r => r.targetId === entityId).map(r => r.sourceId)
  return orgList.value.filter(o => childIds.includes(o.id))
}

function getTerritories(entityId: string) {
  const rels = relationStore.relations.filter(r => r.type === 'controls' && r.sourceId === entityId)
  return rels.map(r => ({
    relation: r,
    region: entityStore.entityMap.get(r.targetId),
  }))
}

function getDiplomacy(entityId: string) {
  const all = relationStore.relations.filter(r =>
    (r.sourceId === entityId || r.targetId === entityId) &&
    (r.type === 'allied_with' || r.type === 'at_war_with' || r.type === 'trade_with')
  )
  return all.map(r => {
    const otherId = r.sourceId === entityId ? r.targetId : r.sourceId
    const other = entityStore.entityMap.get(otherId)
    const name = other?.name || '(未知)'
    if (r.type === 'allied_with') return { relation: r, label: `盟友：${name}`, icon: 'handshake', class: 'diplo-ally' }
    if (r.type === 'at_war_with') return { relation: r, label: `交战：${name}`, icon: 'sword', class: 'diplo-war' }
    if (r.type === 'trade_with') return { relation: r, label: `贸易：${name}`, icon: 'item', class: 'diplo-trade' }
    return { relation: r, label: name, icon: 'link', class: '' }
  })
}

/* ─── Actions ─── */

function onSelectEntity(entity: Entity) {
  selectedOrgId.value = entity.id
}

function openNewFormWithParent(parent: Entity) {
  parentCandidate.value = parent
  showParentHint.value = true
  // GenericEntityView handles the form modal; we just set the parent hint
  // The parent relation will need to be created after the form save
  // We use a timeout to auto-hide the hint
  setTimeout(() => { showParentHint.value = false }, 5000)
}

async function removeRelation(relId: string) {
  await relationStore.remove(relId)
  await relationStore.loadAll()
}

async function removeSubOrg(childId: string, parentId: string) {
  const rel = subOrgRels.value.find(r => r.sourceId === childId && r.targetId === parentId)
  if (rel) {
    await relationStore.remove(rel.id)
    await relationStore.loadAll()
  }
}
</script>

<style scoped>
.org-tree { flex: 1; overflow-y: auto; min-width: 250px; }
/* 空实体状态：组织树空提示垂直+水平居中 */
.org-tree.is-empty { display: flex; align-items: center; justify-content: center; }

.rel-item { padding: 5px 8px; font-size: var(--font-size-sm); cursor: pointer; border-radius: var(--radius-sm); transition: background var(--transition-fast); display: flex; align-items: center; }
.rel-item:hover { background: var(--hover-bg); }
.rel-name { flex: 1; }
.rel-role { font-size: var(--font-size-xs); color: var(--text-tertiary); margin-left: 6px; }
.rel-remove { margin-left: auto; background: none; border: none; cursor: pointer; color: var(--text-tertiary); padding: 2px; border-radius: var(--radius-xs); display: flex; align-items: center; }
.rel-remove:hover { color: var(--danger); background: var(--danger-light); }
.rel-empty { font-size: var(--font-size-sm); color: var(--text-tertiary); }

.diplo-ally { color: var(--success); }
.diplo-war { color: var(--danger); }
.diplo-trade { color: var(--warning); }

.efm-parent-hint {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 8px 16px;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  z-index: 99999;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}
</style>

