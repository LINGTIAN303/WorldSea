<template>
  <div class="rel-selector">
    <div class="rel-s-header">
      <span class="rel-s-title"><WsIcon name="link" size="xs" /> 添加关联</span>
    </div>
    <div class="rel-s-search">
      <input v-model="query" class="rel-s-input" placeholder="搜索实体名称..." @input="onSearch" />
      <select v-model="typeFilter" class="rel-s-filter">
        <option value="">全部类型</option>
        <option v-for="t in allTypes" :key="t.type" :value="t.type"><WsIcon :name="t.iconName" size="xs" /> {{ t.label }}</option>
      </select>
    </div>
    <div class="rel-s-list">
      <div v-for="e in searchResults" :key="e.entity.id"
        class="rel-s-item"
        @click="openTypePicker(e, $event)">
        <WsIcon class="rel-s-icon" :name="e.iconName" size="xs" />
        <span class="rel-s-name">{{ e.entity.name }}</span>
        <span v-if="e.typeLabel" class="rel-s-tag">{{ e.typeLabel }}</span>
        <span class="rel-s-status">＋ 关联</span>
      </div>
      <div v-if="searchResults.length === 0 && query.trim()" class="rel-s-create-hint">
        <button class="rel-s-create-btn" @click="onCreateNewEntity">+ 创建新实体「{{ query.trim() }}」</button>
      </div>
      <p v-else-if="searchResults.length === 0" class="rel-s-empty">无结果</p>
    </div>

    <FloatingPanel
      v-model:visible="pickerVisible"
      v-model:pinned="pickerPinned"
      :title="pendingTarget ? `选择关系类型：${pendingTarget.entity.name}` : '选择关系类型'"
      :width="260"
      :height="340"
      :trigger-rect="triggerRect"
    >
      <div class="rel-s-picker-body">
        <template v-if="!selectedType">
          <div class="rel-s-picker-list">
            <button v-for="rt in getTypeOptions(pendingTarget?.type || '')" :key="rt.type"
              class="rel-s-type-opt"
              :class="{ recommended: rt.recommended }"
              @click="selectRelationType(rt.type)">
              <span class="rel-s-type-label">{{ rt.label }}</span>
              <span v-if="rt.recommended" class="rel-s-type-rec">推荐</span>
            </button>
          </div>
        </template>

        <template v-else>
          <div class="rel-s-selected-type">
            类型：<strong>{{ getTypeLabel(selectedType) }}</strong>
            <button class="rel-s-back-btn" @click="selectedType = null">← 返回</button>
          </div>
          <div v-if="getTypeProperties(selectedType).length > 0" class="rel-s-props">
            <div v-for="prop in getTypeProperties(selectedType)" :key="prop.key" class="rel-s-prop-row">
              <label class="rel-s-prop-label">{{ prop.label }}</label>
              <input v-if="prop.type === 'text'" v-model="propForm[prop.key]"
                class="rel-s-prop-input" :placeholder="prop.placeholder || ''" />
              <textarea v-else-if="prop.type === 'textarea'" v-model="propForm[prop.key]"
                class="rel-s-prop-textarea" :placeholder="prop.placeholder || ''" rows="2" />
            </div>
          </div>
          <p v-else class="rel-s-no-props">该关系类型无额外属性</p>
          <button class="rel-s-confirm-btn" @click="confirmCreateRelation"><WsIcon name="check" size="xs" /> 确认关联</button>
        </template>
      </div>
    </FloatingPanel>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useEntityStore, useRelationStore, entitySchemaRegistry, RelationTypes } from '@worldsmith/entity-core'
import type { Entity } from '@worldsmith/entity-core'
import { useBidirectional } from '@worldsmith/entity-core/composables'
import { FloatingPanel, WsIcon } from '@worldsmith/ui-kit'

const props = defineProps<{
  entityId: string
  entityType?: string
  relationType?: string
  reverseDirection?: boolean
  autoSave?: boolean
}>()

const entityStore = useEntityStore()
const relationStore = useRelationStore()
const { createBidirectional } = useBidirectional()

entityStore.loadAll()

const query = ref('')
const typeFilter = ref('')
const pendingTarget = ref<{ entity: Entity; type: string } | null>(null)
const triggerRect = ref<DOMRect | null>(null)
const pickerVisible = ref(false)
const pickerPinned = ref(false)
const selectedType = ref<string | null>(null)
const propForm = ref<Record<string, string>>({})

const allTypes = computed(() => {
  const used = new Set(entityStore.entities.map(e => e.type))
  return entitySchemaRegistry.getAll()
    .filter(s => used.has(s.typeKey))
    .map(s => ({ type: s.typeKey, label: s.label, iconName: entitySchemaRegistry.getIconName(s.typeKey) }))
})

const linkedIds = computed(() => {
  return relationStore.relations
    .filter(r => r.sourceId === props.entityId || r.targetId === props.entityId)
    .map(r => r.sourceId === props.entityId ? r.targetId : r.sourceId)
})

interface SearchItem {
  entity: Entity
  iconName: string
  typeLabel: string
  type: string
}

const allItems = computed<SearchItem[]>(() => {
  return entityStore.entities
    .filter(e => e.id !== props.entityId)
    .map(e => ({
      entity: e,
      iconName: entitySchemaRegistry.getIconName(e.type),
      typeLabel: entitySchemaRegistry.getLabel(e.type),
      type: e.type,
    }))
})

const searchResults = computed(() => {
  let items = allItems.value
  const linkedSet = new Set(linkedIds.value)
  items = items.filter(i => !linkedSet.has(i.entity.id))
  if (typeFilter.value) {
    items = items.filter(i => i.type === typeFilter.value)
  }
  if (query.value) {
    const q = query.value.toLowerCase()
    items = items.filter(i => i.entity.name.toLowerCase().includes(q))
  }
  return items.slice(0, 50)
})

function onSearch() {}

function openTypePicker(e: SearchItem, event: MouseEvent) {
  pendingTarget.value = { entity: e.entity, type: e.type }
  const target = event.currentTarget as HTMLElement
  if (target) {
    triggerRect.value = target.getBoundingClientRect()
  }
  if (props.relationType) {
    selectedType.value = props.relationType
  } else {
    selectedType.value = null
  }
  propForm.value = {}
  pickerVisible.value = true
}

function selectRelationType(relType: string) {
  selectedType.value = relType
  propForm.value = {}
}

function getTypeLabel(relType: string): string {
  const found = Object.values(RELATION_TYPE_OPTIONS)
    .flat()
    .find(rt => rt.type === relType)
  return found?.label || relType
}

interface RelationProperty {
  key: string
  label: string
  type: 'text' | 'textarea'
  placeholder?: string
}

function getTypeProperties(relType: string): RelationProperty[] {
  return RELATION_PROPERTIES[relType] || []
}

async function confirmCreateRelation() {
  if (!pendingTarget.value || !selectedType.value) return
  const properties: Record<string, any> = {}
  for (const [k, v] of Object.entries(propForm.value)) {
    if (v) properties[k] = v
  }
  const sourceId = props.reverseDirection ? pendingTarget.value.entity.id : props.entityId
  const targetId = props.reverseDirection ? props.entityId : pendingTarget.value.entity.id
  await createBidirectional({
    type: selectedType.value,
    sourceId,
    targetId,
    properties,
  })
  pickerVisible.value = false
  pendingTarget.value = null
  selectedType.value = null
  propForm.value = {}
}

const emit = defineEmits<{
  created: [entity: Entity]
}>()

async function onCreateNewEntity() {
  const { useAutoCreateEntity } = await import('@worldsmith/entity-core/composables')
  const { promptAndCreate } = useAutoCreateEntity()
  const entity = await promptAndCreate({
    name: query.value.trim(),
    entityType: typeFilter.value || props.entityType || 'custom',
    relationType: selectedType.value || undefined,
    sourceId: props.reverseDirection ? undefined : props.entityId,
  })
  if (entity) {
    pickerVisible.value = false
    emit('created', entity)
    await entityStore.loadAll()
  }
}

interface TypeOption {
  type: string
  label: string
  recommended: boolean
}

function getTypeOptions(targetType: string): TypeOption[] {
  const srcType = props.entityType || ''
  const pairKey = `${srcType}_${targetType}`
  const recommendedType = guessRelationType(srcType, targetType)

  const pairOptions = RELATION_TYPE_OPTIONS[pairKey] || RELATION_TYPE_OPTIONS[`*_${targetType}`] || RELATION_TYPE_OPTIONS['*_*']

  return pairOptions.map(rt => ({
    type: rt.type,
    label: rt.label,
    recommended: rt.type === recommendedType,
  }))
}

function guessRelationType(srcType: string, tgtType: string): string {
  const map: Record<string, string> = {
    [`character_item`]: RelationTypes.OWNS,
    [`item_character`]: RelationTypes.OWNED_BY,
    [`character_region`]: RelationTypes.RESIDES_IN,
    [`region_character`]: RelationTypes.NOTABLE_FOR,
    [`character_organization`]: RelationTypes.BELONGS_TO,
    [`organization_character`]: RelationTypes.MEMBER_OF,
    [`character_event`]: RelationTypes.PARTICIPATED_IN,
    [`event_character`]: RelationTypes.INVOLVED_IN,
    [`character_concept`]: RelationTypes.ASSOCIATED_WITH,
    [`event_region`]: RelationTypes.OCCURRED_AT,
    [`organization_event`]: RelationTypes.INVOLVED_IN,
    [`item_region`]: RelationTypes.LOCATED_AT,
    [`organization_region`]: RelationTypes.LOCATED_IN,
    [`region_organization`]: RelationTypes.CONTROLS,
    [`organization_item`]: RelationTypes.OWNS,
    [`event_item`]: RelationTypes.ASSOCIATED_WITH,
    [`item_event`]: RelationTypes.ASSOCIATED_WITH,
    [`concept_character`]: RelationTypes.ASSOCIATED_WITH,
    [`concept_region`]: RelationTypes.ASSOCIATED_WITH,
    [`concept_organization`]: RelationTypes.ASSOCIATED_WITH,
    [`concept_event`]: RelationTypes.ASSOCIATED_WITH,
    [`concept_item`]: RelationTypes.ASSOCIATED_WITH,
    [`region_event`]: RelationTypes.HAPPENS_IN,
  }
  const pairKey = `${srcType}_${tgtType}`
  return map[pairKey] || RelationTypes.ASSOCIATED_WITH
}

const RELATION_TYPE_OPTIONS: Record<string, Array<{ type: string; label: string }>> = {
  'character_organization': [
    { type: RelationTypes.BELONGS_TO, label: '属于' },
    { type: RelationTypes.MEMBER_OF, label: '成员' },
    { type: RelationTypes.ALLIED_WITH, label: '同盟' },
    { type: RelationTypes.HOSTILE_TO, label: '敌对' },
    { type: RelationTypes.ASSOCIATED_WITH, label: '关联' },
    { type: RelationTypes.KNOWS, label: '认识' },
  ],
  'organization_character': [
    { type: RelationTypes.MEMBER_OF, label: '成员' },
    { type: RelationTypes.BELONGS_TO, label: '属于' },
    { type: RelationTypes.ALLIED_WITH, label: '同盟' },
    { type: RelationTypes.HOSTILE_TO, label: '敌对' },
    { type: RelationTypes.ASSOCIATED_WITH, label: '关联' },
    { type: RelationTypes.KNOWS, label: '认识' },
  ],
  'character_region': [
    { type: RelationTypes.RESIDES_IN, label: '居住于' },
    { type: RelationTypes.LOCATED_IN, label: '位于' },
    { type: RelationTypes.NOTABLE_FOR, label: '著名于' },
    { type: RelationTypes.ASSOCIATED_WITH, label: '关联' },
    { type: RelationTypes.OWNS, label: '拥有' },
  ],
  'region_character': [
    { type: RelationTypes.NOTABLE_FOR, label: '著名于' },
    { type: RelationTypes.LOCATED_IN, label: '位于' },
    { type: RelationTypes.RESIDES_IN, label: '居住' },
    { type: RelationTypes.ASSOCIATED_WITH, label: '关联' },
    { type: RelationTypes.CONTROLS, label: '控制' },
  ],
  'character_event': [
    { type: RelationTypes.PARTICIPATED_IN, label: '参与' },
    { type: RelationTypes.INVOLVED_IN, label: '涉及' },
    { type: RelationTypes.CAUSES, label: '导致' },
    { type: RelationTypes.ASSOCIATED_WITH, label: '关联' },
  ],
  'event_character': [
    { type: RelationTypes.INVOLVED_IN, label: '涉及' },
    { type: RelationTypes.PARTICIPATED_IN, label: '参与' },
    { type: RelationTypes.CAUSES, label: '导致' },
    { type: RelationTypes.ASSOCIATED_WITH, label: '关联' },
  ],
  'character_character': [
    { type: RelationTypes.PARENT_OF, label: '父母' },
    { type: RelationTypes.CHILD_OF, label: '子女' },
    { type: RelationTypes.KNOWS, label: '认识' },
    { type: RelationTypes.ALLIED_WITH, label: '盟友' },
    { type: RelationTypes.HOSTILE_TO, label: '敌对' },
    { type: RelationTypes.ASSOCIATED_WITH, label: '关联' },
  ],
  'character_item': [
    { type: RelationTypes.OWNS, label: '拥有' },
    { type: RelationTypes.OWNED_BY, label: '归属' },
    { type: RelationTypes.ASSOCIATED_WITH, label: '关联' },
  ],
  'item_character': [
    { type: RelationTypes.OWNED_BY, label: '归属' },
    { type: RelationTypes.OWNS, label: '拥有' },
    { type: RelationTypes.ASSOCIATED_WITH, label: '关联' },
  ],
  'organization_region': [
    { type: RelationTypes.LOCATED_IN, label: '位于' },
    { type: RelationTypes.CONTROLS, label: '控制' },
    { type: RelationTypes.ASSOCIATED_WITH, label: '关联' },
    { type: RelationTypes.ALLIED_WITH, label: '同盟' },
  ],
  'region_organization': [
    { type: RelationTypes.CONTROLS, label: '控制' },
    { type: RelationTypes.LOCATED_IN, label: '位于' },
    { type: RelationTypes.ASSOCIATED_WITH, label: '关联' },
  ],
  'region_region': [
    { type: RelationTypes.CONTAINS, label: '包含' },
    { type: RelationTypes.BORDERS, label: '接壤' },
    { type: RelationTypes.LOCATED_IN, label: '位于' },
    { type: RelationTypes.ROUTE, label: '航路' },
    { type: RelationTypes.ASSOCIATED_WITH, label: '关联' },
  ],
  'event_region': [
    { type: RelationTypes.OCCURRED_AT, label: '发生于' },
    { type: RelationTypes.HAPPENS_IN, label: '发生在' },
    { type: RelationTypes.ASSOCIATED_WITH, label: '关联' },
  ],
  'region_event': [
    { type: RelationTypes.HAPPENS_IN, label: '发生在' },
    { type: RelationTypes.OCCURRED_AT, label: '发生于' },
    { type: RelationTypes.ASSOCIATED_WITH, label: '关联' },
  ],
  'event_event': [
    { type: RelationTypes.CAUSES, label: '导致' },
    { type: RelationTypes.PRECEDES, label: '先于' },
    { type: RelationTypes.ASSOCIATED_WITH, label: '关联' },
  ],
  'organization_organization': [
    { type: RelationTypes.ALLIED_WITH, label: '同盟' },
    { type: RelationTypes.HOSTILE_TO, label: '敌对' },
    { type: RelationTypes.CONTROLS, label: '控制' },
    { type: RelationTypes.BELONGS_TO, label: '属于' },
    { type: RelationTypes.ASSOCIATED_WITH, label: '关联' },
  ],
  'item_region': [
    { type: RelationTypes.LOCATED_AT, label: '位于' },
    { type: RelationTypes.ASSOCIATED_WITH, label: '关联' },
  ],
  'region_item': [
    { type: RelationTypes.LOCATED_AT, label: '位于' },
    { type: RelationTypes.ASSOCIATED_WITH, label: '关联' },
  ],
  'item_item': [
    { type: RelationTypes.ASSOCIATED_WITH, label: '关联' },
    { type: RelationTypes.INSPIRED_BY, label: '启发' },
    { type: RelationTypes.CONTAINS, label: '包含' },
  ],
  'item_event': [
    { type: RelationTypes.ASSOCIATED_WITH, label: '关联' },
    { type: RelationTypes.INVOLVED_IN, label: '涉及' },
  ],
  'event_item': [
    { type: RelationTypes.ASSOCIATED_WITH, label: '关联' },
    { type: RelationTypes.INVOLVED_IN, label: '涉及' },
  ],
  'organization_event': [
    { type: RelationTypes.INVOLVED_IN, label: '涉及' },
    { type: RelationTypes.PARTICIPATED_IN, label: '参与' },
    { type: RelationTypes.ASSOCIATED_WITH, label: '关联' },
  ],
  'event_organization': [
    { type: RelationTypes.INVOLVED_IN, label: '涉及' },
    { type: RelationTypes.PARTICIPATED_IN, label: '参与' },
    { type: RelationTypes.ASSOCIATED_WITH, label: '关联' },
  ],
  'concept_character': [
    { type: RelationTypes.ASSOCIATED_WITH, label: '关联' },
    { type: RelationTypes.INSPIRED_BY, label: '启发' },
  ],
  'concept_region': [
    { type: RelationTypes.ASSOCIATED_WITH, label: '关联' },
  ],
  'concept_organization': [
    { type: RelationTypes.ASSOCIATED_WITH, label: '关联' },
  ],
  'concept_event': [
    { type: RelationTypes.ASSOCIATED_WITH, label: '关联' },
  ],
  'concept_item': [
    { type: RelationTypes.ASSOCIATED_WITH, label: '关联' },
  ],
  'concept_concept': [
    { type: RelationTypes.REFERENCES, label: '引用' },
    { type: RelationTypes.INSPIRED_BY, label: '启发' },
    { type: RelationTypes.ASSOCIATED_WITH, label: '关联' },
    { type: RelationTypes.CONTAINS, label: '包含' },
  ],
  '*_*': [
    { type: RelationTypes.ASSOCIATED_WITH, label: '关联' },
    { type: RelationTypes.KNOWS, label: '认识' },
    { type: RelationTypes.ALLIED_WITH, label: '同盟' },
    { type: RelationTypes.HOSTILE_TO, label: '敌对' },
  ],
}

const RELATION_PROPERTIES: Record<string, RelationProperty[]> = {
  [RelationTypes.BELONGS_TO]: [
    { key: 'role', label: '角色/职位', type: 'text', placeholder: '如：成员、长老、学徒' },
    { key: 'since', label: '始于', type: 'text', placeholder: '如：第三纪元' },
  ],
  [RelationTypes.MEMBER_OF]: [
    { key: 'role', label: '角色/职位', type: 'text', placeholder: '如：将军、祭司' },
    { key: 'since', label: '加入时间', type: 'text' },
  ],
  [RelationTypes.OWNS]: [
    { key: 'acquisition', label: '获得方式', type: 'text', placeholder: '如：继承、发现、锻造' },
    { key: 'since', label: '获得时间', type: 'text' },
  ],
  [RelationTypes.OWNED_BY]: [
    { key: 'acquisition', label: '获得方式', type: 'text' },
    { key: 'since', label: '获得时间', type: 'text' },
  ],
  [RelationTypes.PARTICIPATED_IN]: [
    { key: 'role', label: '扮演角色', type: 'text', placeholder: '如：见证者、主力' },
  ],
  [RelationTypes.INVOLVED_IN]: [
    { key: 'role', label: '参与角色', type: 'text' },
    { key: 'impact', label: '影响', type: 'textarea', placeholder: '对该事件的影响描述' },
  ],
  [RelationTypes.RESIDES_IN]: [
    { key: 'since', label: '定居时间', type: 'text' },
    { key: 'status', label: '居住状态', type: 'text', placeholder: '如：常住、暂居' },
  ],
  [RelationTypes.LOCATED_IN]: [
    { key: 'since', label: '始于', type: 'text' },
    { key: 'detail', label: '具体位置', type: 'text', placeholder: '如：北城区' },
  ],
  [RelationTypes.LOCATED_AT]: [
    { key: 'since', label: '始于', type: 'text' },
    { key: 'detail', label: '具体位置', type: 'text' },
  ],
  [RelationTypes.ALLIED_WITH]: [
    { key: 'since', label: '结盟时间', type: 'text' },
    { key: 'terms', label: '盟约内容', type: 'textarea' },
  ],
  [RelationTypes.HOSTILE_TO]: [
    { key: 'since', label: '始于', type: 'text' },
    { key: 'reason', label: '原因', type: 'textarea' },
  ],
  [RelationTypes.KNOWS]: [
    { key: 'since', label: '认识于', type: 'text' },
    { key: 'nature', label: '关系性质', type: 'text', placeholder: '如：同窗、旧友、一面之缘' },
  ],
  [RelationTypes.PARENT_OF]: [
    { key: 'biological', label: '血缘', type: 'text', placeholder: '如：亲生、养父母' },
  ],
  [RelationTypes.CHILD_OF]: [
    { key: 'biological', label: '血缘', type: 'text', placeholder: '如：亲生、养子女' },
  ],
  [RelationTypes.CAUSES]: [
    { key: 'mechanism', label: '因果机制', type: 'textarea', placeholder: '描述因果关系的详细机制' },
  ],
  [RelationTypes.PRECEDES]: [
    { key: 'gap', label: '时间间隔', type: 'text' },
  ],
  [RelationTypes.BORDERS]: [
    { key: 'length', label: '边境长度', type: 'text' },
    { key: 'type', label: '边境类型', type: 'text', placeholder: '如：山脉、河流、城墙' },
  ],
  [RelationTypes.CONTROLS]: [
    { key: 'since', label: '始于', type: 'text' },
    { key: 'method', label: '控制方式', type: 'text', placeholder: '如：军事占领、经济控制' },
  ],
  [RelationTypes.ROUTE]: [
    { key: 'distance', label: '距离', type: 'text' },
    { key: 'method', label: '交通方式', type: 'text', placeholder: '如：陆路、海路、传送门' },
  ],
  [RelationTypes.CONTAINS]: [
    { key: 'since', label: '始于', type: 'text' },
  ],
  [RelationTypes.REFERENCES]: [
    { key: 'nature', label: '引用性质', type: 'text', placeholder: '如：理论基础、灵感来源' },
  ],
  [RelationTypes.INSPIRED_BY]: [
    { key: 'aspect', label: '启发方面', type: 'text' },
  ],
  [RelationTypes.NOTABLE_FOR]: [
    { key: 'detail', label: '著名原因', type: 'textarea' },
  ],
  [RelationTypes.OCCURRED_AT]: [
    { key: 'detail', label: '具体地点', type: 'text' },
  ],
  [RelationTypes.HAPPENS_IN]: [
    { key: 'detail', label: '具体地点', type: 'text' },
  ],
  [RelationTypes.ASSOCIATED_WITH]: [
    { key: 'nature', label: '关联性质', type: 'text', placeholder: '如：世界观关联、剧情关联' },
  ],
}
</script>

<style scoped>
.rel-selector { border: 1px solid var(--border-color); border-radius: var(--radius-md); margin-top: 8px; }
.rel-s-header { padding: 8px 10px; border-bottom: 1px solid var(--border-light); }
.rel-s-title { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--text-secondary); }
.rel-s-search { display: flex; gap: 4px; padding: 6px 8px; border-bottom: 1px solid var(--border-light); }
.rel-s-input { flex: 1; padding: 4px 8px; border: 1px solid var(--border-color); border-radius: 4px; font-size: var(--font-size-sm); }
.rel-s-filter { padding: 4px; border: 1px solid var(--border-color); border-radius: 4px; font-size: var(--font-size-xs); }
.rel-s-list { max-height: 160px; overflow-y: auto; }
.rel-s-item { display: flex; align-items: center; gap: 6px; padding: 5px 8px; cursor: pointer; font-size: var(--font-size-sm); transition: background 0.1s; }
.rel-s-item:hover { background: var(--hover-bg); }
.rel-s-icon { font-size: var(--font-size-base); }
.rel-s-name { flex: 1; color: var(--text-color); }
.rel-s-tag { font-size: var(--font-size-xs); color: var(--text-tertiary); background: var(--tag-bg); padding: 1px 4px; border-radius: 3px; }
.rel-s-status { font-size: var(--font-size-xs); color: var(--text-tertiary); flex-shrink: 0; }
.rel-s-empty { padding: 12px; text-align: center; font-size: var(--font-size-sm); color: var(--text-tertiary); }

.rel-s-picker-body { padding: 10px; }
.rel-s-picker-list { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
.rel-s-type-opt {
  padding: 3px 8px; border: 1px solid var(--border-color); border-radius: 4px;
  background: var(--bg); cursor: pointer; font-size: var(--font-size-xs); color: var(--text-color);
  transition: background 0.12s, border-color 0.12s, color 0.12s, box-shadow 0.12s, transform 0.12s, opacity 0.12s, filter 0.12s; display: flex; align-items: center; gap: 4px;
}
.rel-s-type-opt:hover { border-color: var(--primary); background: var(--primary-light); }
.rel-s-type-opt.recommended { border-color: var(--primary); background: var(--primary-light); color: var(--primary); font-weight: var(--font-weight-semibold); }
.rel-s-type-rec { font-size: var(--text-micro-font-size); background: var(--primary); color: #fff; padding: 1px 4px; border-radius: 3px; }

.rel-s-selected-type {
  display: flex; align-items: center; gap: 6px; font-size: var(--font-size-sm); margin-bottom: 8px; padding-bottom: 6px;
  border-bottom: 1px solid var(--border-light);
}
.rel-s-selected-type strong { color: var(--primary); }
.rel-s-back-btn {
  margin-left: auto; padding: 2px 6px; border: 1px solid var(--border-color); border-radius: 3px;
  background: none; cursor: pointer; font-size: var(--font-size-xs); color: var(--text-secondary);
}
.rel-s-back-btn:hover { background: var(--hover-bg); }
.rel-s-props { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
.rel-s-prop-row { display: flex; flex-direction: column; gap: 2px; }
.rel-s-prop-label { font-size: var(--font-size-xs); color: var(--text-secondary); }
.rel-s-prop-input {
  padding: 4px 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: var(--font-size-xs);
  background: var(--bg); color: var(--text-color);
}
.rel-s-prop-textarea {
  padding: 4px 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: var(--font-size-xs);
  background: var(--bg); color: var(--text-color); resize: vertical; font-family: inherit;
}
.rel-s-no-props { font-size: var(--font-size-xs); color: var(--text-tertiary); margin-bottom: 8px; text-align: center; }
.rel-s-confirm-btn {
  display: block; width: 100%; padding: 5px; border: none; border-radius: 4px;
  background: var(--primary); color: #fff; cursor: pointer; font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold);
}
.rel-s-confirm-btn:hover { opacity: 0.9; }
.rel-s-create-hint { padding: 8px 12px; border-top: 1px dashed var(--border-color); }
.rel-s-create-btn {
  width: 100%; padding: 6px 12px;
  background: var(--primary-light, #eef2ff); color: var(--primary, #4f46e5);
  border: 1px dashed var(--primary, #4f46e5); border-radius: 4px;
  cursor: pointer; font-size: var(--font-size-sm); transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}
.rel-s-create-btn:hover { background: var(--primary, #4f46e5); color: white; }
</style>
