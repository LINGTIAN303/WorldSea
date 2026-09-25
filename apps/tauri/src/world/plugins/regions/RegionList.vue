<template>
  <GenericEntityView
    entity-type="region"
    :form-fields="fields"
    :filter-defs="filterDefs"
    :custom-tabs="customTabs"
    :detail-tabs="detailTabs"
    :card-footer-fields="cardFooterFields"
    card-subtitle="regionType"
    entity-label="区域"
    id-prefix="rgn"
    :icon-fn="iconFn"
    @select-entity="onSelectEntity"
  >
    <!-- Toolbar: view mode toggle buttons -->
    <template #toolbar-extra>
      <button class="btn-view" :class="{ active: viewMode === 'tree' }" @click="viewMode = 'tree'" title="树形视图">
        <WsIcon name="tree" size="sm" />
      </button>
      <button class="btn-view" :class="{ active: viewMode === 'grid' }" @click="viewMode = 'grid'" title="卡片视图">
        <WsIcon name="grid" size="sm" />
      </button>
      <button class="btn-view" :class="{ active: viewMode === 'map' }" @click="viewMode = 'map'" title="地图视图">
        <WsIcon name="map" size="sm" />
      </button>
    </template>

    <!-- Custom list slot: tree view or map view; fall through to default for cards -->
    <template #list="{ entities, selectedIds: batchIds, toggleSelect: batchToggle, select: selectFn }">
      <!-- Tree view -->
      <div v-if="viewMode === 'tree' && entities.length" class="tree-view">
        <div v-for="item in visibleTree(entities)" :key="item.entity.id" class="tree-item"
          :class="{ selected: selectedRegion?.id === item.entity.id, 'batch-selected': batchIds.has(item.entity.id) }"
          :style="{ paddingLeft: (item.depth * 20 + 8) + 'px' }"
          role="button"
          tabindex="0"
          :aria-current="selectedRegion?.id === item.entity.id ? 'true' : undefined"
          :aria-label="`打开区域 ${item.entity.name}`"
          @click="onTreeSelect(item.entity, selectFn)"
          @keydown.enter.prevent="onTreeSelect(item.entity, selectFn)"
          @keydown.space.prevent="onTreeSelect(item.entity, selectFn)">
          <span v-if="item.children.length" class="tree-toggle" tabindex="-1" role="button" :aria-label="`${expandedMap[item.entity.id] !== false ? '收起' : '展开'} ${item.entity.name}`" @click.stop="toggleExpand(item.entity.id)" @keydown.enter.prevent.stop="toggleExpand(item.entity.id)">
            {{ expandedMap[item.entity.id] !== false ? 'v' : '>' }}
          </span>
          <span v-else class="tree-toggle tree-toggle-spacer"></span>
          <label class="batch-check-inline" @click.stop><input type="checkbox" :checked="batchIds.has(item.entity.id)" @change="batchToggle(item.entity.id)" /></label>
          <span><WsIcon :name="typeIcon(item.entity)" size="xs" /></span>
          <span>{{ item.entity.name }}</span>
          <span class="region-type">{{ item.entity.properties?.regionType }}</span>
        </div>
      </div>

      <!-- Map view -->
      <RegionMap v-else-if="viewMode === 'map' && entities.length" :regions="entities" @select="(e: any) => { selectedRegion = e; selectFn(e) }" />

      <!-- Cards view: render default card grid manually (since we're in the list slot) -->
      <template v-else-if="viewMode === 'grid'">
        <div
          v-for="e in entities"
          :key="e.id"
          class="entity-card-wrapper"
          :class="{ 'batch-selected': batchIds.has(e.id) }"
        >
          <div class="entity-card" role="button" tabindex="0" :aria-label="`打开区域 ${e.name}`" @click="selectFn(e)" @keydown.enter.prevent="selectFn(e)" @keydown.space.prevent="selectFn(e)">
            <input type="checkbox" class="batch-check" :checked="batchIds.has(e.id)" @change="batchToggle(e.id)" @click.stop />
            <div class="card-header">
              <WsIcon class="card-icon" :name="typeIcon(e)" size="sm" />
              <div class="card-body">
                <h3>{{ e.name }}</h3>
                <p>{{ e.properties?.regionType || '区域' }}</p>
              </div>
            </div>
          </div>
        </div>
      </template>

      <WsEmpty v-if="entities.length === 0" title="暂无区域" description="点击上方按钮创建第一个区域">
        <template #icon><WsIcon name="region" size="xl" /></template>
      </WsEmpty>
    </template>

    <!-- Detail: extra fields for parent region and enclave -->
    <template #detail-extra="{ entity, editing }">
      <div class="region-field-row">
        <span class="region-field-key">父级区域</span>
        <span class="region-field-val">{{ getParentName(entity.id) || '无' }}</span>
        <EntityRelationSelector v-if="editing" :entity-id="entity.id" entity-type="region" relation-type="located_in" :reverse-direction="false" compact />
      </div>

      <div class="region-field-row">
        <span class="region-field-key">飞地联结</span>
        <span class="region-field-val">{{ getEnclaveName(entity.id) || '无' }}</span>
        <EntityRelationSelector v-if="editing" :entity-id="entity.id" entity-type="region" relation-type="enclave_of" :reverse-direction="false" compact />
      </div>
    </template>

    <!-- Custom tab: sub-regions -->
    <template #tab-subregions="{ entity }">
      <div v-for="child in childRegions(entity.id)" :key="child.id" class="rel-item" role="button" tabindex="0" @click="onRelSelect(child)" @keydown.enter="onRelSelect(child)">
        <WsIcon :name="typeIcon(child)" size="xs" /> {{ child.name }}
        <span class="rel-type-badge">{{ child.properties?.regionType || '区域' }}</span>
        <button class="rel-remove" @click.stop="removeLocatedIn(child.id, entity.id)" title="移除"><WsIcon name="close" size="xs" /></button>
      </div>
      <p v-if="childRegions(entity.id).length === 0" class="rel-empty">尚无子区域</p>
      <EntityRelationSelector v-if="entity" :entity-id="entity.id" entity-type="region" relation-type="located_in" :reverse-direction="true" />
    </template>

    <!-- Custom tab: enclaves -->
    <template #tab-enclaves="{ entity }">
      <div v-for="enc in enclaveRegions(entity.id)" :key="enc.id" class="rel-item" role="button" tabindex="0" @click="onRelSelect(enc)" @keydown.enter="onRelSelect(enc)">
        <WsIcon :name="typeIcon(enc)" size="xs" /> {{ enc.name }}
        <button class="rel-remove" @click.stop="removeEnclave(enc.id, entity.id)" title="移除"><WsIcon name="close" size="xs" /></button>
      </div>
      <p v-if="enclaveRegions(entity.id).length === 0" class="rel-empty">尚无飞地</p>
      <EntityRelationSelector v-if="entity" :entity-id="entity.id" entity-type="region" relation-type="enclave_of" :reverse-direction="true" />
    </template>

    <!-- Custom tab: resident characters -->
    <template #tab-residents="{ entity }">
      <div v-for="res in residentCharacters(entity.id)" :key="res.relation.id" class="rel-item">
        <WsIcon name="user" size="xs" /> {{ res.character?.name || '(未知)' }}
        <button class="rel-remove" @click="removeRelation(res.relation.id)" title="移除"><WsIcon name="close" size="xs" /></button>
      </div>
      <p v-if="residentCharacters(entity.id).length === 0" class="rel-empty">尚无驻扎角色</p>
      <EntityRelationSelector v-if="entity" :entity-id="entity.id" entity-type="region" relation-type="resides_in" :reverse-direction="true" />
    </template>

    <!-- Custom tab: controlling faction -->
    <template #tab-faction="{ entity }">
      <div v-for="ctrl in controllingOrgs(entity.id)" :key="ctrl.relation.id" class="rel-item">
        <WsIcon name="building" size="xs" /> {{ ctrl.org?.name || '(未知)' }}
        <button class="rel-remove" @click="removeRelation(ctrl.relation.id)" title="移除"><WsIcon name="close" size="xs" /></button>
      </div>
      <p v-if="controllingOrgs(entity.id).length === 0" class="rel-empty">尚无控制势力</p>
      <EntityRelationSelector v-if="entity" :entity-id="entity.id" entity-type="region" relation-type="controls" :reverse-direction="true" />
    </template>
  </GenericEntityView>
</template>

<script setup lang="ts">
import { ref, computed, reactive } from 'vue'
import { GenericEntityView, type FormFieldDef, type FilterDef, type CardFieldDef, type CustomTabDef, type RelationTabDef } from '@worldsea/plugin-sdk'
import { useEntityStore, useRelationStore } from '@worldsea/entity-core'
import { EntityRelationSelector } from '@worldsea/plugin-sdk'
import { RegionMap, WsIcon, WsEmpty } from '@worldsea/ui-kit'
import { typeIconMap } from './regionConfig'

const entityStore = useEntityStore()
const relationStore = useRelationStore()

// ── View mode ──
const viewMode = ref<string>('tree')
const selectedRegion = ref<any>(null)

// ── Tree expand state ──
const expandedMap = reactive<Record<string, boolean>>({})
function toggleExpand(id: string) {
  expandedMap[id] = expandedMap[id] !== false ? false : true
}

// ── Icon function ──
function iconFn() { return 'region' }
function typeIcon(r: any) { return typeIconMap[r.properties?.regionType as string] || 'region' }

// ── Form fields ──
const fields: FormFieldDef[] = [
  { key: 'name', label: '名称', type: 'text', required: true, placeholder: '区域名称' },
  { key: 'description', label: '描述', type: 'textarea', placeholder: '简要描述' },
  { key: 'regionType', label: '类型', type: 'select', options: [
    { value: '大陆', label: '大陆' }, { value: '国家', label: '国家' },
    { value: '行省', label: '行省' }, { value: '城市', label: '城市' },
    { value: '地标', label: '地标' }, { value: '区域', label: '区域' },
  ] },
  { key: 'climate', label: '气候', type: 'select', options: [
    { value: '热带雨林', label: '热带雨林' }, { value: '热带草原', label: '热带草原' },
    { value: '热带沙漠', label: '热带沙漠' }, { value: '地中海', label: '地中海' },
    { value: '温带海洋', label: '温带海洋' }, { value: '温带大陆', label: '温带大陆' },
    { value: '温带季风', label: '温带季风' }, { value: '亚寒带', label: '亚寒带' },
    { value: '寒带苔原', label: '寒带苔原' }, { value: '寒带冰原', label: '寒带冰原' },
    { value: '高山高原', label: '高山高原' },
  ] },
  { key: 'population', label: '人口', type: 'number' },
  { key: 'area', label: '面积', type: 'text' },
  { key: 'government', label: '政体/统治', type: 'select', options: [
    { value: '君主制', label: '君主制' }, { value: '共和制', label: '共和制' },
    { value: '民主制', label: '民主制' }, { value: '寡头制', label: '寡头制' },
    { value: '神权制', label: '神权制' }, { value: '军事独裁', label: '军事独裁' },
    { value: '部落制', label: '部落制' }, { value: '联邦制', label: '联邦制' },
    { value: '其他', label: '其他' },
  ] },
  { key: 'significance', label: '重要性', type: 'textarea' },
  { key: 'tags', label: '标签', type: 'tags' },
]

// ── Filter definitions ──
const filterDefs: FilterDef[] = [
  { key: 'regionType', label: '类型', dynamic: true },
  { key: 'climate', label: '气候', dynamic: true },
]

// ── Card footer fields ──
const cardFooterFields: CardFieldDef[] = [
  { key: 'regionType', type: 'tag' },
]

// ── Custom tabs (rendered via tab-${id} slots) ──
const customTabs: CustomTabDef[] = [
  { id: 'subregions', label: '子区域', icon: 'location' },
  { id: 'enclaves', label: '飞地', icon: 'location' },
  { id: 'residents', label: '驻留角色', icon: 'user' },
  { id: 'faction', label: '所属势力', icon: 'building' },
]

// ── Detail tabs (relation-based, rendered by GenericEntityView) ──
const detailTabs: RelationTabDef[] = []

// ── Region list helper ──
const regionList = computed(() => entityStore.entities.filter(e => e.type === 'region'))

// ── Tree computation ──
interface TreeItem {
  entity: any
  depth: number
  children: TreeItem[]
}

function buildTree(entities: any[]): TreeItem[] {
  const rels = relationStore.relations
  const parentMap: Record<string, string> = {}
  const enclaveMap: Record<string, string> = {}
  for (const rel of rels) {
    if (rel.type === 'located_in') parentMap[rel.sourceId] = rel.targetId
    if (rel.type === 'enclave_of') enclaveMap[rel.sourceId] = rel.targetId
  }
  const roots: any[] = []
  const childrenMap: Record<string, any[]> = {}
  const entityIds = new Set(entities.map(r => r.id))
  for (const r of entities) {
    const pid = parentMap[r.id]
    const eid = enclaveMap[r.id]
    if (pid && entityIds.has(pid)) {
      if (!childrenMap[pid]) childrenMap[pid] = []
      childrenMap[pid].push(r)
    } else if (eid && entityIds.has(eid)) {
      if (!childrenMap[eid]) childrenMap[eid] = []
      childrenMap[eid].push(r)
    } else {
      roots.push(r)
    }
  }
  function buildItems(items: any[], depth: number): TreeItem[] {
    return items.map(e => ({
      entity: e, depth,
      children: childrenMap[e.id] ? buildItems(childrenMap[e.id], depth + 1) : [],
    }))
  }
  return buildItems(roots, 0)
}

function visibleTree(entities: any[]): TreeItem[] {
  const tree = buildTree(entities)
  function walk(items: TreeItem[]): TreeItem[] {
    const result: TreeItem[] = []
    for (const item of items) {
      result.push(item)
      if (expandedMap[item.entity.id] !== false && item.children.length > 0) {
        result.push(...walk(item.children))
      }
    }
    return result
  }
  return walk(tree)
}

// ── Parent/enclave helpers ──
function getParentName(id: string) {
  const rel = relationStore.relations.find(r => r.type === 'located_in' && r.sourceId === id)
  return rel ? entityStore.entityMap.get(rel.targetId)?.name || '' : ''
}

function getEnclaveName(id: string) {
  const rel = relationStore.relations.find(r => r.type === 'enclave_of' && r.sourceId === id)
  return rel ? entityStore.entityMap.get(rel.targetId)?.name || '' : ''
}

// ── Relation helpers ──
function childRegions(parentId: string) {
  return regionList.value.filter(r => {
    const rel = relationStore.relations.find(rel => rel.type === 'located_in' && rel.sourceId === r.id && rel.targetId === parentId)
    return !!rel
  })
}

function enclaveRegions(parentId: string) {
  return regionList.value.filter(r => {
    const rel = relationStore.relations.find(rel => rel.type === 'enclave_of' && rel.sourceId === r.id && rel.targetId === parentId)
    return !!rel
  })
}

function controllingOrgs(regionId: string) {
  return relationStore.relations
    .filter(r => r.type === 'controls' && r.targetId === regionId)
    .map(r => ({ relation: r, org: entityStore.entityMap.get(r.sourceId) }))
}

function residentCharacters(regionId: string) {
  return relationStore.relations
    .filter(r => r.type === 'resides_in' && r.targetId === regionId)
    .map(r => ({ relation: r, character: entityStore.entityMap.get(r.sourceId) }))
}

async function removeLocatedIn(childId: string, parentId: string) {
  const rel = relationStore.relations.find(r => r.type === 'located_in' && r.sourceId === childId && r.targetId === parentId)
  if (rel) { await relationStore.remove(rel.id); await relationStore.loadAll() }
}

async function removeEnclave(encId: string, parentId: string) {
  const rel = relationStore.relations.find(r => r.type === 'enclave_of' && r.sourceId === encId && r.targetId === parentId)
  if (rel) { await relationStore.remove(rel.id); await relationStore.loadAll() }
}

async function removeRelation(relId: string) {
  await relationStore.remove(relId)
  await relationStore.loadAll()
}

// ── Selection ──
function onSelectEntity(entity: any) {
  selectedRegion.value = entity
}

function onTreeSelect(entity: any, selectFn: (e: any) => void) {
  selectedRegion.value = entity
  selectFn(entity)
}

function onRelSelect(entity: any) {
  selectedRegion.value = entity
}
</script>

<style scoped>
.btn-view { width: 36px; height: 36px; border: 1px solid var(--border-color); border-radius: var(--radius-xs); cursor: pointer; font-size: var(--font-size-base); background: var(--card-bg); display: inline-flex; align-items: center; justify-content: center; }
.btn-view.active { border-color: var(--primary); background: var(--primary-light); }

.tree-view { flex: 1; overflow-y: auto; }
.tree-item { display: flex; align-items: center; gap: 6px; padding: 6px 8px; cursor: pointer; font-size: var(--font-size-base); }
.tree-item:hover { background: var(--hover-bg); }
.tree-item.selected { background: var(--accent-bg); font-weight: var(--font-weight-semibold); }
.tree-item.batch-selected { background: var(--primary-light, #eef2ff) !important; }
.tree-toggle { width: 14px; font-size: var(--font-size-xs); color: var(--text-tertiary); cursor: pointer; user-select: none; flex-shrink: 0; }
.tree-toggle-spacer { visibility: hidden; }
.region-type { font-size: var(--font-size-xs); color: var(--text-tertiary); margin-left: auto; }
.batch-check-inline { display: inline-flex; align-items: center; }
.batch-check-inline input[type="checkbox"] { margin: 0; cursor: pointer; accent-color: var(--primary, #4f46e5); }

.region-field-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; font-size: var(--font-size-sm); }
.region-field-row .region-field-key { color: var(--text-secondary); min-width: 64px; flex-shrink: 0; }
.region-field-row .region-field-val { color: var(--text); flex: 1; }

.rel-item { display: flex; align-items: center; gap: 6px; padding: 6px 0; font-size: var(--font-size-sm); cursor: pointer; }
.rel-item:hover { background: var(--hover-bg); border-radius: var(--radius-xs); }
.rel-type-badge { font-size: var(--font-size-xs); color: var(--text-tertiary); margin-left: 4px; }
.rel-remove { margin-left: auto; background: none; border: none; cursor: pointer; color: var(--text-tertiary); padding: 2px; border-radius: var(--radius-xs); display: flex; align-items: center; }
.rel-remove:hover { color: var(--danger); background: var(--danger-light); }
.rel-empty { font-size: var(--font-size-sm); color: var(--text-tertiary); }
</style>
