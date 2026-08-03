<template>
  <GenericEntityView
    entityType="concept"
    :form-fields="fields"
    :filter-defs="filterDefs"
    cardSubtitle="definition"
    :card-footer-fields="cardFooterFields"
    :detail-tabs="detailTabs"
    entity-label="概念"
    id-prefix="con"
  >
    <template #detail-backlinks="{ entity }">
      <div v-for="c in getBacklinks(entity.id)" :key="c.id" class="backlink-item">
        <WsIcon :name="typeIcon(c)" size="xs" /> {{ c.name }}
      </div>
      <WsEmpty v-if="getBacklinks(entity.id).length === 0" preset="no-data" title="暂无其他概念引用本条" />
      <EntityRelationSelector v-if="entity" :entity-id="entity.id" entity-type="concept" relation-type="references" :reverse-direction="true" />
    </template>

    <template #detail-forwardLinks="{ entity }">
      <div v-for="c in getForwardLinks(entity.id)" :key="c.id" class="backlink-item">
        <WsIcon :name="typeIcon(c)" size="xs" /> {{ c.name }}
      </div>
      <WsEmpty v-if="getForwardLinks(entity.id).length === 0" preset="no-data" title="暂无引用其他概念" />
      <EntityRelationSelector v-if="entity" :entity-id="entity.id" entity-type="concept" relation-type="references" />
    </template>

    <template #detail-contradictions="{ entity }">
      <div v-for="item in getContradictions(entity.id)" :key="item.relation.id" class="contradiction-item">
        <span>↔ {{ item.other?.name || '(未知)' }}</span>
        <p v-if="item.relation.properties.explanation" class="contra-explain">
          {{ item.relation.properties.explanation }}
        </p>
      </div>
      <WsEmpty v-if="getContradictions(entity.id).length === 0" preset="no-data" title="暂无矛盾设定" />
      <EntityRelationSelector v-if="entity" :entity-id="entity.id" entity-type="concept" relation-type="contradicts" />
    </template>
  </GenericEntityView>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { GenericEntityView, EntityRelationSelector, type FormFieldDef, type FilterDef, type CardFieldDef, type RelationTabDef } from '@worldsmith/plugin-sdk'
import { WsIcon } from '@worldsmith/ui-kit'
import { WsEmpty } from '@worldsmith/ui-kit'
import { useEntityStore, useRelationStore } from '@worldsmith/entity-core'
import type { Entity } from '@worldsmith/entity-core'

const entityStore = useEntityStore()
const relationStore = useRelationStore()

const fields: FormFieldDef[] = [
  { key: 'name', label: '名称', type: 'text', required: true, placeholder: '概念名称' },
  { key: 'description', label: '描述', type: 'textarea', placeholder: '简要描述' },
  { key: 'conceptType', label: '类型', type: 'select', options: [
    { value: '概念', label: '概念' }, { value: '规则', label: '规则' },
    { value: '魔法', label: '魔法' }, { value: '科技', label: '科技' },
    { value: '文化', label: '文化' }, { value: '历史', label: '历史' },
    { value: '宗教', label: '宗教' }, { value: '生物', label: '生物' },
    { value: '语言', label: '语言' }, { value: '社会制度', label: '社会制度' },
  ] },
  { key: 'aliases', label: '别名/同义词', type: 'tags', placeholder: '逗号分隔' },
  { key: 'definition', label: '定义', type: 'textarea', placeholder: '一句话定义这个概念' },
  { key: 'tags', label: '标签', type: 'tags' },
]

const filterDefs: FilterDef[] = [
  { key: 'conceptType', label: '类型', dynamic: true },
]

const cardFooterFields: CardFieldDef[] = [
  { key: 'conceptType', type: 'tag' },
]

const detailTabs: RelationTabDef[] = [
  { id: 'backlinks', label: '被引用', icon: 'link', relationType: 'references', targetLabel: '概念' },
  { id: 'forwardLinks', label: '引用其他', icon: 'paperclip', relationType: 'references', targetLabel: '概念' },
  { id: 'contradictions', label: '矛盾设定', icon: 'warning', relationType: 'contradicts', targetLabel: '概念', showProperty: 'explanation' },
]

const conceptList = computed(() => entityStore.entities.filter(e => e.type === 'concept'))
const referenceRels = computed(() => relationStore.relations.filter(r => r.type === 'references'))

function getBacklinks(entityId: string): Entity[] {
  const sourceIds = referenceRels.value.filter(r => r.targetId === entityId).map(r => r.sourceId)
  return conceptList.value.filter(c => sourceIds.includes(c.id))
}

function getForwardLinks(entityId: string): Entity[] {
  const targetIds = referenceRels.value.filter(r => r.sourceId === entityId).map(r => r.targetId)
  return conceptList.value.filter(c => targetIds.includes(c.id))
}

function getContradictions(entityId: string) {
  const rels = relationStore.relations.filter(r =>
    r.type === 'contradicts' && (r.sourceId === entityId || r.targetId === entityId)
  )
  return rels.map(r => ({
    relation: r,
    other: entityStore.entityMap.get(r.sourceId === entityId ? r.targetId : r.sourceId),
  }))
}

function typeIcon(concept: Entity): string {
  const t = concept.properties.conceptType as string
  const icons: Record<string, string> = {
    '概念': 'brain', '规则': 'ruler', '魔法': 'crystal', '科技': 'gear',
    '文化': 'theater', '历史': 'scroll', '宗教': 'church', '生物': 'dragon',
    '语言': 'language', '社会制度': 'building',
  }
  return icons[t] || 'document'
}
</script>

<style scoped>
.backlink-item {
  padding: 5px 8px;
  cursor: pointer;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  transition: background var(--transition-fast);
}
.backlink-item:hover {
  background: var(--hover-bg);
}
.contradiction-item {
  padding: 6px 10px;
  background: var(--danger-light);
  border-radius: var(--radius-sm);
  margin: 4px 0;
  font-size: var(--font-size-sm);
  border-left: 3px solid var(--danger);
}
.contra-explain {
  margin: 4px 0 0;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}
</style>

