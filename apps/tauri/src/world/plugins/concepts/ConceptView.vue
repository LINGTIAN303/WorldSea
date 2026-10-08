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
  </GenericEntityView>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { GenericEntityView, type FormFieldDef, type FilterDef, type CardFieldDef, type RelationTabDef } from '@worldsea/plugin-sdk'
import { useEntityStore } from '@worldsea/entity-core'

const entityStore = useEntityStore()

/**
 * 清理重复「中心主题」概念（保留 1 个，删除其余）。
 * 历史背景：旧思维导图芽会自动创建「中心主题」概念实体且可能重复；
 * 芽已删除（2026-09-13），此处保留自愈逻辑清理存量数据。
 */
onMounted(async () => {
  await entityStore.loadAll()
  const centers = entityStore.entities.filter(e => e.type === 'concept' && e.name === '中心主题')
  if (centers.length > 1) {
    await Promise.all(centers.slice(1).map(c => entityStore.remove(c.id)))
  }
})

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

// 2026-10-08 合并批：关系类页收编进「关联」面板的类型分组——references 双向归一为一条
// （行上以 ←/→ 箭头区分方向），自绘槽随之下线（面板默认渲染含定向「＋」与属性行）
const detailTabs: RelationTabDef[] = [
  { id: 'references', label: '引用', icon: 'link', relationType: 'references', targetLabel: '概念' },
  { id: 'contradictions', label: '矛盾设定', icon: 'warning', relationType: 'contradicts', targetLabel: '概念', showProperty: 'explanation' },
]

</script>
