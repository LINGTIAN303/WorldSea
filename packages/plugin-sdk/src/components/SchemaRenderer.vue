<template>
  <div v-if="loading" class="schema-loading">
    <WsSkeleton
      v-for="n in 5"
      :key="n"
      variant="row"
      :lines="1"
      label="正在载入实体视图"
      :aria-hidden="n > 1 || undefined"
    />
  </div>
  <div v-else-if="error" class="schema-error">{{ error }}</div>
  <div v-else-if="!schema" class="schema-empty">
    <span>未找到「{{ typeKey }}」的实体类型定义</span>
  </div>
  <GenericEntityView
    v-else-if="schema"
    :entity-type="schema.typeKey"
    :form-fields="formFields"
    :icon-fn="iconFn || schemaIconFn"
    :filter-options="filterOpts"
    :filter-field-key="filterFieldKey"
    :filter-defs="filterDefs"
    :id-prefix="schema.idPrefix || defaultIdPrefix"
    :entity-label="entityLabel || schema.label"
    :additional-filter="additionalFilter"
    :detail-tabs="detailTabs"
    :custom-tabs="customTabs"
    :card-footer-fields="cardFooterFields"
    :card-subtitle="cardSubtitle"
    :sort-options="sortOptions"
    :hide-create-button="hideCreateButton"
    :facet-on-create="facetOnCreate"
    :detail-layout="detailLayout"
    :detail-carrier="detailCarrier"
  >
    <template #toolbar-extra>
      <slot name="toolbar-extra" />
    </template>
    <!-- 仅当消费者真正提供 list 插槽时才转发，避免 GenericEntityView 误判 hasListSlot
         跳过空状态居中（SchemaRenderer 默认列表应走 GenericEntityView 自带居中） -->
    <template v-if="hasListSlot" #list="listSlotProps">
      <slot name="list" v-bind="listSlotProps" />
    </template>
    <template #card-subtitle="{ entity }">
      <slot name="card-subtitle" :entity="entity" />
    </template>
    <template #detail-header="{ entity, editing }">
      <slot name="detail-header" :entity="entity" :editing="editing" />
    </template>
    <template #detail-info="{ entity, editing, editForm }">
      <slot name="detail-info" :entity="entity" :editing="editing" :edit-form="editForm" />
    </template>
    <template #detail-extra="{ entity, editing }">
      <slot name="detail-extra" :entity="entity" :editing="editing" />
    </template>
    <template v-for="ct in customTabs" :key="ct.id" #[`tab-${ct.id}`]="{ entity, editing }">
      <slot :name="`tab-${ct.id}`" :entity="entity" :editing="editing" />
    </template>
    <template v-for="rt in detailTabs" :key="rt.id" #[`detail-${rt.id}`]="{ entity }">
      <slot :name="`detail-${rt.id}`" :entity="entity" />
    </template>
    <template #detail-relations="{ entity }">
      <slot name="detail-relations" :entity="entity" />
    </template>
  </GenericEntityView>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, useSlots } from 'vue'
import { entitySchemaRegistry } from '@worldsea/entity-core'
import type { EntityTypeSchema } from '@worldsea/core-api-types'
import GenericEntityView from './GenericEntityView.vue'
import { WsSkeleton } from '@worldsea/ui-kit'
import type { FormFieldDef, RelationTabDef, CardFieldDef, CustomTabDef, FilterDef } from './types'
import type { LayoutSource } from '../detail/detailLayout'

const slots = useSlots()
/** 消费者是否真正提供了 list 插槽（用于条件转发，避免 GenericEntityView 误判） */
const hasListSlot = computed(() => !!slots['list'])

const props = withDefaults(defineProps<{
  typeKey: string
  additionalFilter?: (entity: any) => boolean
  detailTabs?: RelationTabDef[]
  customTabs?: CustomTabDef[]
  cardFooterFields?: CardFieldDef[]
  cardSubtitle?: string
  filterDefs?: FilterDef[]
  sortOptions?: { key: string; label: string }[]
  hideCreateButton?: boolean
  facetOnCreate?: string
  /** 覆盖实体显示名（空状态提示语等；默认用 schema.label）——供复用其他类型的视图定制文案（如武器复用 item） */
  entityLabel?: string
  /** 覆盖实体图标解析（卡片/详情/空状态；默认按 schema.iconMap → schema.icon） */
  iconFn?: (entity: any) => string
  /** 实体类型 schema 加载器（端分离后由宿主注入；未提供时降级到 entitySchemaRegistry） */
  schemaLoader?: (typeKey: string) => Promise<EntityTypeSchema | null>
  /** 芽声明的详情默认（顺序/分组/可见性/内容形态），原样下传 GenericEntityView */
  detailLayout?: LayoutSource
  /** 芽声明的 L1 载体 id，原样下传 */
  detailCarrier?: string
}>(), {
  detailTabs: () => [],
  customTabs: () => [],
  cardFooterFields: () => [],
  cardSubtitle: '',
  filterDefs: () => [],
  sortOptions: () => [],
  hideCreateButton: false,
  facetOnCreate: '',
})

const schema = ref<EntityTypeSchema | null>(null)
const loading = ref(true)
const error = ref('')

async function loadSchema() {
  loading.value = true
  error.value = ''
  try {
    let result: EntityTypeSchema | null = null
    if (props.schemaLoader) {
      result = await props.schemaLoader(props.typeKey)
    }
    if (!result) {
      const fallback = entitySchemaRegistry.get(props.typeKey)
      if (fallback) {
        // entity-core 注册表 schema 已与契约层同源（typeKey 主键、fieldType 字段），
        // 仅需补齐契约层必填的扩展字段默认值
        result = {
          ...fallback,
          iconMap: fallback.iconMap || {},
          relations: fallback.relations || [],
          validations: fallback.validations || [],
          views: fallback.views || [],
          idPrefix: fallback.idPrefix || '',
        } as unknown as EntityTypeSchema
      }
    }
    schema.value = result
  } catch (e: any) {
    const fallback = entitySchemaRegistry.get(props.typeKey)
    if (fallback) {
      schema.value = {
        ...fallback,
        iconMap: fallback.iconMap || {},
        relations: fallback.relations || [],
        validations: fallback.validations || [],
        views: fallback.views || [],
        idPrefix: fallback.idPrefix || '',
      } as unknown as EntityTypeSchema
    } else {
      error.value = e?.message || String(e)
    }
  } finally {
    loading.value = false
  }
}

onMounted(loadSchema)
watch(() => props.typeKey, loadSchema)

const defaultIdPrefix = computed(() => {
  if (!schema.value) return ''
  return schema.value.typeKey.slice(0, 3) + '-'
})

const formFields = computed<FormFieldDef[]>(() => {
  if (!schema.value) return []
  return schema.value.fields.map(f => ({
    key: f.key,
    label: f.label,
    type: mapFieldType(f.fieldType) as FormFieldDef['type'],
    required: f.required,
    options: f.options?.map(o => ({ value: o.value, label: o.label })),
    placeholder: f.placeholder,
    refType: f.refType,
    autoLink: f.autoLink,
  })) as FormFieldDef[]
})

const filterFieldKey = computed(() => {
  if (!schema.value) return ''
  const selectField = schema.value.fields.find(f => f.fieldType === 'select')
  return selectField?.key || ''
})

const filterOpts = computed(() => {
  if (!schema.value || !filterFieldKey.value) return []
  const field = schema.value.fields.find(f => f.key === filterFieldKey.value)
  if (!field?.options) return []
  return [{ value: '', label: '全部' }, ...field.options.map(o => ({ value: o.value, label: o.label }))]
})

/** schema 内建的图标解析（iconMap 按筛选字段映射 → schema.icon 兜底）；消费者传入 iconFn 时被覆盖 */
const schemaIconFn = computed(() => {
  if (!schema.value || Object.keys(schema.value.iconMap).length === 0) return undefined
  return (entity: any) => {
    const filterVal = entity?.[filterFieldKey.value]
    if (filterVal && schema.value?.iconMap[filterVal]) {
      return schema.value.iconMap[filterVal]
    }
    return schema.value?.icon || 'manuscript'
  }
})

function mapFieldType(ft: string): string {
  const map: Record<string, string> = {
    text: 'text',
    textarea: 'textarea',
    number: 'number',
    boolean: 'boolean',
    date: 'date',
    image: 'image',
    select: 'select',
    multiSelect: 'multiSelect',
    formula: 'formula',
    color: 'color',
    entityRef: 'entityRef',
    tags: 'tags',
  }
  return map[ft] || 'text'
}
</script>

<style scoped>
.schema-loading {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 200px;
  padding: 16px;
}
.schema-loading .ws-skeleton { width: 100%; }
.schema-error,
.schema-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--text-muted, #888);
  font-size: var(--font-size-base);
}
.schema-error {
  color: var(--danger, #e74c3c);
}
</style>
