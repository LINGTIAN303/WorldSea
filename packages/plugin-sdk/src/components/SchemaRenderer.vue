<template>
  <div v-if="loading" class="schema-loading">加载中...</div>
  <div v-else-if="error" class="schema-error">{{ error }}</div>
  <div v-else-if="!schema" class="schema-empty">
    <span>未找到「{{ typeKey }}」的实体类型定义</span>
  </div>
  <GenericEntityView
    v-else-if="schema"
    :entity-type="schema.typeKey"
    :form-fields="formFields"
    :icon-fn="iconFn"
    :filter-options="filterOpts"
    :filter-field-key="filterFieldKey"
    :filter-defs="filterDefs"
    :id-prefix="schema.idPrefix || defaultIdPrefix"
    :entity-label="schema.label"
    :additional-filter="additionalFilter"
    :detail-tabs="detailTabs"
    :custom-tabs="customTabs"
    :card-footer-fields="cardFooterFields"
    :card-subtitle="cardSubtitle"
    :sort-options="sortOptions"
    :hide-create-button="hideCreateButton"
    :facet-on-create="facetOnCreate"
  >
    <template #toolbar-extra>
      <slot name="toolbar-extra" />
    </template>
    <template #list="listSlotProps">
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
import { ref, computed, onMounted, watch } from 'vue'
import { entitySchemaRegistry } from '@worldsmith/entity-core'
import GenericEntityView from './GenericEntityView.vue'
import type { FormFieldDef, RelationTabDef, CardFieldDef, CustomTabDef, FilterDef } from './types'

// ── 本地类型定义（与后端 coreBackend.EntityTypeSchema 结构兼容）
// 端分离后 plugin-sdk 不再直接引用业务层，schema 加载能力由调用方通过 schemaLoader prop 注入 ──
export interface SchemaFieldOption { value: string; label: string }
export interface SchemaField {
  key: string
  label: string
  fieldType: string
  required?: boolean
  options?: SchemaFieldOption[]
  placeholder?: string
  refType?: string
  autoLink?: { targetType: string; relationType: string; searchField?: string; createIfMissing?: boolean }
}
export interface EntityTypeSchema {
  typeKey: string
  label: string
  icon: string
  fields: SchemaField[]
  relations: unknown[]
  validations: unknown[]
  views: unknown[]
  iconMap: Record<string, string>
  idPrefix: string
  pluginId?: string
}

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
  /** 实体类型 schema 加载器（端分离后由宿主注入；未提供时降级到 entitySchemaRegistry） */
  schemaLoader?: (typeKey: string) => Promise<EntityTypeSchema | null>
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
        result = { ...fallback, typeKey: fallback.type, fields: fallback.fields || [], iconMap: (fallback as any).iconMap || {}, relations: [], validations: [], views: [], idPrefix: '' } as unknown as EntityTypeSchema
      }
    }
    schema.value = result
  } catch (e: any) {
    const fallback = entitySchemaRegistry.get(props.typeKey)
    if (fallback) {
      schema.value = { ...fallback, typeKey: fallback.type, fields: fallback.fields || [], iconMap: (fallback as any).iconMap || {}, relations: [], validations: [], views: [], idPrefix: '' } as unknown as EntityTypeSchema
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

const iconFn = computed(() => {
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
.schema-loading,
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
