<template>
  <div class="fm-root fm-shell">
    <MatrixToolbar
      :stats="model.stats"
      :query="query"
      :only-required="onlyRequired"
      :only-own="onlyOwn"
      :type-filter="typeFilter"
      :type-options="typeOptions"
      :jump-options="jumpOptions"
      @update:query="setQuery"
      @update:only-required="setOnlyRequired"
      @update:only-own="setOnlyOwn"
      @update:type-filter="setTypeFilter"
      @clear="clearFilters"
      :sidebar-collapsed="sidebarCollapsed"
      @jump="handleJump"
      @toggle-sidebar="sidebarCollapsed = !sidebarCollapsed"
    />
    <div ref="panelRef" class="fm-scroll">
      <div class="fm-panel-inner" @click="handlePanelClick">
        <div v-if="isFiltering" class="fm-panel-status">
          <span>显示 {{ visibleFieldCount }} / {{ totalFieldCount }} 个字段</span>
          <span class="fm-panel-status-hint">搜索覆盖字段键、中文名、类型、来源、选项与说明</span>
        </div>
        <div class="fm-panel-stage">
          <Transition name="fm-panel-switch">
            <div :key="activePanelId || 'empty'" class="fm-panel-content">
              <section v-if="activePanelId === 'overview'" class="doc-section">
                <OverviewSection :stats="model.stats" :entities="model.entities" />
              </section>
              <section v-else-if="activePanelId === 'traits'" class="doc-section">
                <TraitMatrixSection :traits="model.traits" :entities="model.entities" />
              </section>
              <EntityFieldTable
                v-else-if="activeEntity"
                :entity="activeEntity"
                :fields="activeEntityFields"
                :notify="notify"
              />
              <section v-else-if="activePanelId === 'facets'" class="doc-section">
                <FacetSection :facets="visibleFacets" :notify="notify" />
              </section>
              <section v-else-if="activePanelId === 'system'" class="doc-section">
                <SystemSection :fields="visibleSystemFields" :notify="notify" />
              </section>
              <section v-else-if="activePanelId === 'relations'" class="doc-section">
                <RelationSection :relations="model.relations" :entity-types="entityTypes" />
              </section>
              <section v-else-if="activePanelId === 'views'" class="doc-section">
                <ViewSection :views="model.views" />
              </section>
              <section v-else-if="activePanelId === 'autolink'" class="doc-section">
                <AutoLinkSection />
              </section>
              <section v-else-if="activePanelId === 'view-only'" class="doc-section">
                <ViewOnlySection />
              </section>
              <section v-else-if="activePanelId === 'scope'" class="doc-section">
                <ScopeSection />
              </section>
              <div v-else class="empty-state">
                <b>没有匹配的字段</b>
                <span>试试清空搜索，或换一个字段键 / 中文名 / 芽名</span>
              </div>
            </div>
          </Transition>
        </div>
      </div>
    </div>
    <MatrixSidebar
      :groups="navGroups"
      :active="activePanelId"
      :collapsed="sidebarCollapsed"
      @select="selectPanel"
    />
    <div class="toast" :class="{ show: toast.show }" role="status" aria-live="polite">{{ toast.message }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import AutoLinkSection from './components/AutoLinkSection.vue'
import EntityFieldTable from './components/EntityFieldTable.vue'
import FacetSection from './components/FacetSection.vue'
import MatrixSidebar from './components/MatrixSidebar.vue'
import MatrixToolbar from './components/MatrixToolbar.vue'
import OverviewSection from './components/OverviewSection.vue'
import RelationSection from './components/RelationSection.vue'
import ScopeSection from './components/ScopeSection.vue'
import SystemSection from './components/SystemSection.vue'
import TraitMatrixSection from './components/TraitMatrixSection.vue'
import ViewOnlySection from './components/ViewOnlySection.vue'
import ViewSection from './components/ViewSection.vue'
import { useFieldMatrixData } from './composables/useFieldMatrixData'
import { useFieldMatrixFilter } from './composables/useFieldMatrixFilter'
import { FIELD_MATRIX_GROUPS } from './model/fieldMeta'
import type { MatrixNavGroup } from './model/nav'
import { SYSTEM_CONTEXT, SYSTEM_FIELDS } from './model/system'
import { VIEW_ONLY } from './model/viewOnly'
import type { MatrixEntity } from './model/types'
import './styles/matrix.css'

const { model } = useFieldMatrixData()
const {
  query, onlyRequired, onlyOwn, typeFilter, isFiltering, matches, matchesContext, typeOptions, clearFilters,
} = useFieldMatrixFilter(model)

const panelRef = ref<HTMLElement | null>(null)
const sidebarCollapsed = ref(false)
const activePanelId = ref('overview')
const toast = ref({ show: false, message: '' })
let toastTimer: number | undefined

const knownTypes = new Set(FIELD_MATRIX_GROUPS.flatMap(group => group.types))

const visibleFacets = computed(() => model.value.facets
  .map(facet => ({
    ...facet,
    fields: facet.fields.filter(field => matchesContext(
      { label: facet.label, type: `facet:${facet.id}`, pluginId: 'entity-core' },
      field,
    )),
  }))
  .filter(facet => !isFiltering.value || facet.fields.length > 0))

const visibleSystemFields = computed(() =>
  SYSTEM_FIELDS.filter(field => matchesContext(SYSTEM_CONTEXT, field)),
)

const facetFieldTotal = computed(() =>
  model.value.facets.reduce((sum, facet) => sum + facet.fields.length, 0),
)
const entityTypes = computed(() => new Set(model.value.entities.map(entity => entity.type)))

const totalFieldCount = computed(() =>
  model.value.stats.instances + facetFieldTotal.value + SYSTEM_FIELDS.length,
)
const visibleFieldCount = computed(() =>
  model.value.entities.reduce((sum, entity) =>
    sum + entity.fields.filter(field => matches(entity, field)).length, 0)
  + visibleFacets.value.reduce((sum, facet) => sum + facet.fields.length, 0)
  + visibleSystemFields.value.length,
)

const navGroups = computed<MatrixNavGroup[]>(() => {
  const groups: MatrixNavGroup[] = [
    {
      title: '总览',
      fixed: true,
      items: isFiltering.value ? [] : [
        { id: 'overview', label: '速览' },
        { id: 'traits', label: 'Trait 矩阵' },
      ],
    },
  ]

  for (const group of FIELD_MATRIX_GROUPS) {
    const items = group.types
      .map(type => model.value.entities.find(entity => entity.type === type))
      .filter((entity): entity is MatrixEntity => Boolean(entity))
      .map(entity => ({
        id: `entity-${entity.type}`,
        label: entity.label,
        meta: entity.type,
        count: entity.fields.filter(field => matches(entity, field)).length,
      }))
      .filter(item => !isFiltering.value || item.count > 0)
    if (items.length > 0) groups.push({ title: group.title, items })
  }

  const extras = model.value.entities
    .filter(entity => !knownTypes.has(entity.type))
    .map(entity => ({
      id: `entity-${entity.type}`,
      label: entity.label,
      meta: entity.type,
      count: entity.fields.filter(field => matches(entity, field)).length,
    }))
    .filter(item => !isFiltering.value || item.count > 0)
  if (extras.length > 0) groups.push({ title: '其他实体', items: extras })

  if (!isFiltering.value) {
    groups.push({
      title: '运行时',
      items: [
        { id: 'relations', label: '关系类型', count: model.value.relations.length },
        { id: 'views', label: '视图', count: model.value.views.length },
        { id: 'autolink', label: 'AutoLink 运转' },
      ],
    })
  }

  const matchingFacetCount = visibleFacets.value.filter(facet => facet.fields.length > 0).length
  const facetCount = isFiltering.value ? matchingFacetCount : model.value.facets.length
  const systemCount = isFiltering.value ? visibleSystemFields.value.length : SYSTEM_FIELDS.length
  const otherItems = [
    ...(facetCount > 0 ? [{ id: 'facets', label: 'Facet 字段', count: facetCount }] : []),
    ...(systemCount > 0 ? [{ id: 'system', label: '系统字段', count: systemCount }] : []),
    ...(isFiltering.value ? [] : [
      { id: 'view-only', label: '无实体字段芽', count: VIEW_ONLY.length },
      { id: 'scope', label: '口径与维护' },
    ]),
  ]
  if (otherItems.length > 0) groups.push({ title: '其他', items: otherItems })

  return groups
})

const jumpOptions = computed(() => navGroups.value.flatMap(group =>
  group.items.map(item => ({
    value: `#${item.id}`,
    label: item.meta ? `${item.label} · ${item.meta}` : item.label,
  })),
))

const availablePanelIds = computed(() =>
  navGroups.value.flatMap(group => group.items.map(item => item.id)),
)

const activeEntityType = computed(() =>
  activePanelId.value.startsWith('entity-') ? activePanelId.value.slice('entity-'.length) : '',
)
const activeEntity = computed(() =>
  activeEntityType.value
    ? model.value.entities.find(entity => entity.type === activeEntityType.value) ?? null
    : null,
)
const activeEntityFields = computed(() => {
  const entity = activeEntity.value
  return entity ? entity.fields.filter(field => matches(entity, field)) : []
})

watch(availablePanelIds, ids => {
  if (ids.length === 0) {
    activePanelId.value = ''
    return
  }
  if (!ids.includes(activePanelId.value)) activePanelId.value = ids[0]
}, { immediate: true })

watch(activePanelId, async () => {
  await nextTick()
  panelRef.value?.scrollTo({ top: 0 })
})

function setQuery(value: string) { query.value = value }
function setOnlyRequired(value: boolean) { onlyRequired.value = value }
function setOnlyOwn(value: boolean) { onlyOwn.value = value }
function setTypeFilter(value: string) { typeFilter.value = value }

function handleJump(value: string) {
  selectPanel(value.replace(/^#/, ''))
}

// 单面板内 #entity-* 链接改为切面板，避免只改 hash 的死链
function handlePanelClick(event: MouseEvent) {
  const link = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[href^="#entity-"]')
  if (!link) return
  event.preventDefault()
  selectPanel(link.getAttribute('href')?.slice(1) ?? '')
}

function selectPanel(id: string) {
  if (!availablePanelIds.value.includes(id)) return
  activePanelId.value = id
}

function notify(message: string) {
  toast.value = { show: true, message }
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => { toast.value.show = false }, 1700)
}

onBeforeUnmount(() => {
  window.clearTimeout(toastTimer)
})
</script>

<style scoped>
.fm-root {
  display: flex;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: transparent;
  --topbar-h: 0px;
}
/* 视图内容本身即面板：只保留一层内容内边距，目录列与画布同层 */
.fm-root .fm-scroll {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  scrollbar-gutter: stable;
  container-type: inline-size;
  container-name: fm;
}
.fm-root .fm-panel-inner {
  box-sizing: border-box;
  /* 右侧让出 scrollbar-gutter 的稳定槽位，视觉留白与左侧一致 */
  padding: 18px 11px 18px 20px;
}
/* 旧页内卡片让位给视图面板 */
.fm-root .fm-panel-inner :deep(.doc-section),
.fm-root .fm-panel-inner :deep(.entity) {
  margin: 0;
  padding: 0;
  background: transparent;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
.fm-root .fm-panel-inner :deep(.entity-body) {
  padding-left: 0;
  padding-right: 0;
}
.fm-panel-status {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin: 0 0 14px;
  padding: 0 0 10px;
  border-bottom: 1px solid var(--color-border-subtle);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}
.fm-panel-status-hint {
  color: var(--text-tertiary);
}
.fm-panel-stage {
  display: grid;
  background: var(--region-bg, var(--bg-surface));
}
.fm-panel-content {
  grid-area: 1 / 1;
  min-width: 0;
}
.fm-panel-switch-enter-active {
  transition: opacity 0.15s ease-out, transform 0.15s ease-out;
  pointer-events: none;
}
.fm-panel-switch-leave-active {
  transition: opacity 0.12s ease-in, transform 0.12s ease-in;
  pointer-events: none;
}
.fm-panel-switch-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.fm-panel-switch-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
@media (prefers-reduced-motion: reduce) {
  .fm-panel-switch-enter-active,
  .fm-panel-switch-leave-active {
    transition: none;
  }
}
</style>
