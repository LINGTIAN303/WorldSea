<template>
  <GenericEntityView
    entityType="item"
    :form-fields="fields"
    :filter-defs="filterDefs"
    :card-footer-fields="cardFooterFields"
    :detail-tabs="detailTabs"
    entity-label="道具"
    id-prefix="item"
    :icon-fn="() => 'item'"
  />
</template>

<script setup lang="ts">
import { GenericEntityView, type FormFieldDef, type FilterDef, type CardFieldDef, type RelationTabDef } from '@worldsmith/plugin-sdk'

const fields: FormFieldDef[] = [
  { key: 'name', label: '名称', type: 'text', required: true, placeholder: '道具名称' },
  { key: 'description', label: '描述', type: 'textarea', placeholder: '简要描述' },
  { key: 'itemType', label: '类型', type: 'select', options: [
    { value: '武器', label: '武器' }, { value: '防具', label: '防具' },
    { value: '法器', label: '法器' }, { value: '文书', label: '文书' },
    { value: '信物', label: '信物' }, { value: '药水', label: '药水' },
    { value: '工具', label: '工具' }, { value: '交通工具', label: '交通工具' },
    { value: '乐器', label: '乐器' }, { value: '艺术品', label: '艺术品' },
    { value: '容器', label: '容器' }, { value: '食物', label: '食物' },
    { value: '衣物', label: '衣物' }, { value: '杂物', label: '杂物' },
    { value: '神器', label: '神器' }, { value: '其他', label: '其他' },
  ] },
  { key: 'rarity', label: '稀有度', type: 'select', options: [
    { value: '普通', label: '普通' }, { value: '珍贵', label: '珍贵' },
    { value: '稀有', label: '稀有' }, { value: '传说', label: '传说' },
    { value: '唯一', label: '唯一' },
  ] },
  { key: 'condition', label: '状况', type: 'select', options: [
    { value: '完好', label: '完好' }, { value: '轻微破损', label: '轻微破损' },
    { value: '严重破损', label: '严重破损' }, { value: '已修复', label: '已修复' },
    { value: '已毁', label: '已毁' }, { value: '遗失', label: '遗失' },
    { value: '未知', label: '未知' },
  ] },
  { key: 'material', label: '材质', type: 'text' },
  { key: 'origin', label: '来源/产地', type: 'text' },
  { key: 'creator', label: '制作者', type: 'text' },
  { key: 'era', label: '所属时代', type: 'text' },
  { key: 'currentOwner', label: '当前持有者', type: 'text' },
  { key: 'powers', label: '能力/功效', type: 'textarea' },
  { key: 'significance', label: '意义/价值', type: 'textarea' },
  { key: 'tags', label: '标签', type: 'tags' },
]

const filterDefs: FilterDef[] = [
  { key: 'itemType', label: '类型', dynamic: true },
  { key: 'rarity', label: '稀有度', options: [
    { value: '', label: '全部稀有度' },
    { value: '普通', label: '普通' }, { value: '珍贵', label: '珍贵' },
    { value: '稀有', label: '稀有' }, { value: '传说', label: '传说' },
    { value: '唯一', label: '唯一' },
  ] },
]

const cardFooterFields: CardFieldDef[] = [
  { key: 'itemType', type: 'tag' },
  { key: 'currentOwner', type: 'text' },
]

const detailTabs: RelationTabDef[] = [
  { id: 'provenance', label: '流转谱系', icon: 'scroll', relationType: 'possessed_by', targetLabel: '角色', targetIcon: 'user', showProperty: 'since' },
  { id: 'location', label: '当前存放', icon: 'location', relationType: 'kept_at', targetLabel: '地点' },
  { id: 'usage', label: '使用记录', icon: 'lightning', relationType: 'used_in', targetLabel: '事件', showProperty: 'manner' },
  { id: 'related', label: '关联道具', icon: 'link', relationType: 'related_item', targetLabel: '道具', targetIcon: 'item' },
]
</script>
