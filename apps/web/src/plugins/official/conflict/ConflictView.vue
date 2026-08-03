<template>
  <GenericEntityView
    entityType="conflict"
    :form-fields="fields"
    :filter-defs="filterDefs"
    cardSubtitle="conflictType"
    :card-footer-fields="cardFooterFields"
    :detail-tabs="detailTabs"
    entity-label="冲突"
    id-prefix="cft"
    :icon-fn="() => 'combat'"
  />
</template>

<script setup lang="ts">
import { GenericEntityView, type FormFieldDef, type FilterDef, type CardFieldDef, type RelationTabDef } from '@worldsmith/plugin-sdk'

const fields: FormFieldDef[] = [
  { key: 'name', label: '名称', type: 'text', required: true, placeholder: '冲突名称' },
  { key: 'description', label: '描述', type: 'textarea' },
  { key: 'conflictType', label: '类型', type: 'select', options: [
    { value: '全面战争', label: '全面战争' }, { value: '局部冲突', label: '局部冲突' },
    { value: '内战', label: '内战' }, { value: '起义', label: '起义' },
    { value: '侵略', label: '侵略' }, { value: '防御战', label: '防御战' },
    { value: '冷冲突', label: '冷冲突' }, { value: '贸易战', label: '贸易战' },
    { value: '其他', label: '其他' },
  ] },
  { key: 'scale', label: '规模', type: 'select', options: [
    { value: '全球', label: '全球' }, { value: '区域', label: '区域' },
    { value: '国家', label: '国家' }, { value: '地方', label: '地方' },
    { value: '小规模', label: '小规模' },
  ] },
  { key: 'startDate', label: '开始时间', type: 'text' },
  { key: 'endDate', label: '结束时间', type: 'text' },
  { key: 'cause', label: '起因', type: 'textarea' },
  { key: 'result', label: '结果', type: 'textarea' },
  { key: 'casualties', label: '伤亡', type: 'textarea' },
  { key: 'treaty', label: '和约/停战协议', type: 'textarea' },
  { key: 'tags', label: '标签', type: 'tags' },
]

const filterDefs: FilterDef[] = [
  { key: 'conflictType', label: '类型', dynamic: true },
  { key: 'scale', label: '规模', dynamic: true },
]

const cardFooterFields: CardFieldDef[] = [
  { key: 'conflictType', type: 'tag' },
  { key: 'scale', type: 'tag' },
]

const detailTabs: RelationTabDef[] = [
  { id: 'forces', label: '参战势力', icon: 'organization', relationType: 'participant_force', targetLabel: '势力', targetIcon: 'organization' },
  { id: 'commanders', label: '指挥官', icon: 'user', relationType: 'participant_commander', targetLabel: '人物', targetIcon: 'user' },
  { id: 'battlefields', label: '战场', icon: 'location', relationType: 'battlefield', targetLabel: '地区', targetIcon: 'location' },
  { id: 'events', label: '关联事件', icon: 'event', relationType: 'related_event', targetLabel: '事件', targetIcon: 'event' },
  { id: 'legendary_items', label: '传奇兵器', icon: 'item', relationType: 'legendary_item', targetLabel: '道具', targetIcon: 'item' },
  { id: 'sub_conflicts', label: '子战役', icon: 'combat', relationType: 'sub_conflict', targetLabel: '冲突', targetIcon: 'combat' },
]
</script>
