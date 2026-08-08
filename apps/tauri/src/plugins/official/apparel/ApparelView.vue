<template>
  <GenericEntityView
    entityType="item"
    :form-fields="fields"
    :filter-defs="filterDefs"
    cardSubtitle="material"
    :card-footer-fields="cardFooterFields"
    :detail-tabs="detailTabs"
    :additional-filter="isApparelItem"
    entity-label="服饰"
    id-prefix="apr"
    :icon-fn="() => 'apparel'"
    facet-on-create="apparel"
  />
</template>

<script setup lang="ts">
import { GenericEntityView, type FormFieldDef, type FilterDef, type CardFieldDef, type RelationTabDef } from '@worldsmith/plugin-sdk'

/** 过滤出包含 apparel facet 的 item 实体 */
function isApparelItem(entity: any): boolean {
  return entity?.facets?.apparel != null || entity?.properties?.itemType === '防具'
}

const fields: FormFieldDef[] = [
  { key: 'name', label: '名称', type: 'text', required: true },
  { key: 'description', label: '描述', type: 'textarea' },
  { key: 'apparelType', label: '类型', type: 'select',
    options: [
      { value: '上衣', label: '上衣' }, { value: '下装', label: '下装' },
      { value: '连衣裙', label: '连衣裙' }, { value: '外套/披风', label: '外套/披风' },
      { value: '头饰', label: '头饰' }, { value: '鞋履', label: '鞋履' },
      { value: '手套', label: '手套' }, { value: '饰品/首饰', label: '饰品/首饰' },
      { value: '轻甲', label: '轻甲' }, { value: '中甲', label: '中甲' },
      { value: '重甲', label: '重甲' }, { value: '盾牌', label: '盾牌' },
      { value: '法袍', label: '法袍' }, { value: '套装', label: '套装' },
    ] },
  { key: 'armorClass', label: '护甲等级', type: 'select',
    options: [
      { value: '无防护', label: '无防护' }, { value: '布甲', label: '布甲' },
      { value: '皮甲', label: '皮甲' }, { value: '锁甲', label: '锁甲' },
      { value: '板甲', label: '板甲' }, { value: '法袍', label: '法袍' },
      { value: '饰品', label: '饰品' },
    ] },
  { key: 'material', label: '材质', type: 'text' },
  { key: 'color', label: '颜色', type: 'text' },
  { key: 'style', label: '风格', type: 'select',
    options: [
      { value: '朴素', label: '朴素' }, { value: '华丽', label: '华丽' },
      { value: '异域', label: '异域' }, { value: '军用', label: '军用' },
      { value: '仪式', label: '仪式' }, { value: '日常', label: '日常' },
      { value: '伪装', label: '伪装' }, { value: '工装', label: '工装' },
    ] },
  { key: 'defense', label: '防御值', type: 'number' },
  { key: 'weight', label: '重量', type: 'select',
    options: [
      { value: '极轻', label: '极轻' }, { value: '轻', label: '轻' },
      { value: '中等', label: '中等' }, { value: '重', label: '重' },
      { value: '极重', label: '极重' },
    ] },
  { key: 'durability', label: '耐久度', type: 'select',
    options: [
      { value: '易损', label: '易损' }, { value: '普通', label: '普通' },
      { value: '耐用', label: '耐用' }, { value: '坚固', label: '坚固' },
      { value: '不毁', label: '不毁' },
    ] },
  { key: 'origin', label: '产地', type: 'entityRef', refType: 'region', relationType: 'located_at', placeholder: '搜索区域...' },
  { key: 'era', label: '时代', type: 'text' },
  { key: 'condition', label: '状况', type: 'select',
    options: [
      { value: '完好', label: '完好' }, { value: '轻微磨损', label: '轻微磨损' },
      { value: '破损', label: '破损' }, { value: '已修复', label: '已修复' },
      { value: '已毁', label: '已毁' }, { value: '遗失', label: '遗失' },
    ] },
  { key: 'significance', label: '意义', type: 'textarea' },
  { key: 'tags', label: '标签', type: 'tags' },
]

const filterDefs: FilterDef[] = [
  { key: 'apparelType', label: '类型', dynamic: true },
  { key: 'armorClass', label: '护甲', options: [
    { value: '', label: '全部护甲' },
    { value: '无防护', label: '无防护' }, { value: '布甲', label: '布甲' },
    { value: '皮甲', label: '皮甲' }, { value: '锁甲', label: '锁甲' },
    { value: '板甲', label: '板甲' }, { value: '法袍', label: '法袍' },
    { value: '饰品', label: '饰品' },
  ] },
]

const cardFooterFields: CardFieldDef[] = [
  { key: 'apparelType', type: 'tag' },
  { key: 'defense', type: 'badge' },
]

const detailTabs: RelationTabDef[] = [
  { id: 'wearer', label: '穿着者', icon: 'user', relationType: 'worn_by', targetLabel: '角色', targetIcon: 'user', showProperty: 'since' },
  { id: 'location', label: '存放地', icon: 'location', relationType: 'located_at', targetLabel: '地点' },
]
</script>
