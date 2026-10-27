<template>
  <div class="set-card deck-card" v-show="match('芽 sprout 启用 禁用 域 domain 分组 全选 管理')">
    <div class="sc-head">
      <div class="sc-head-left">
        <span>芽管理</span>
        <span class="sp-sub">按语义域</span>
      </div>
    </div>
    <div class="sp-domain-tabs-wrap">
      <button
        v-if="canScrollTabsLeft"
        type="button"
        class="sp-domain-tabs-arrow"
        aria-label="向左滚动域筛选"
        @click="scrollDomainTabs(-1)"
      >
        <WsIcon name="chevron-left" size="xs" />
      </button>
      <div
        ref="domainTabsRef"
        class="sp-domain-tabs"
        role="tablist"
        aria-label="芽域筛选"
        @scroll="updateDomainTabsOverflow"
        @wheel="onDomainTabsWheel"
      >
        <button
          type="button"
          class="sp-domain-tab"
          :class="{ active: activeDomain === 'all' }"
          role="tab"
          :aria-selected="activeDomain === 'all'"
          @click="activeDomain = 'all'"
        >全部</button>
        <button
          v-for="domain in domainChips"
          :key="domain.id"
          type="button"
          class="sp-domain-tab"
          :class="{ active: activeDomain === domain.id }"
          role="tab"
          :aria-selected="activeDomain === domain.id"
          @click="activeDomain = activeDomain === domain.id ? 'all' : domain.id"
        >{{ domain.label }}</button>
      </div>
      <button
        v-if="canScrollTabsRight"
        type="button"
        class="sp-domain-tabs-arrow"
        aria-label="向右滚动域筛选"
        @click="scrollDomainTabs(1)"
      >
        <WsIcon name="chevron-right" size="xs" />
      </button>
    </div>

    <div class="set-plugin-search">
      <button
        type="button"
        class="sp-selectall-btn"
        :disabled="filteredSprouts.length === 0"
        :title="filteredAllActive ? '取消当前可见芽的启用（至少保留人物志兜底）' : '启用当前可见芽'"
        @click="onToggleSelectAll"
      >{{ filteredAllActive ? '全不选' : '全选' }}</button>
      <input type="text" v-model="sproutSearch" placeholder="搜索芽..." class="set-input" />
    </div>

    <div v-if="displayGroups.length === 0" class="sp-empty">暂无匹配芽</div>

    <section v-for="group in displayGroups" :key="group.id" class="sp-domain-group">
      <button
        type="button"
        class="sp-domain-head"
        :aria-expanded="!isCollapsed(group.id)"
        @click="onGroupHead(group.id)"
      >
        <WsIcon :name="group.icon" size="xs" class="sp-domain-icon" />
        <span class="sp-domain-name">{{ group.label }}</span>
        <span class="sp-domain-count">已启用 {{ activeCount(group) }} / {{ group.items.length }}</span>
        <WsIcon :name="isCollapsed(group.id) ? 'chevron-right' : 'chevron-down'" size="xs" class="sp-domain-chevron" />
      </button>

      <template v-if="!isCollapsed(group.id)">
        <draggable
          v-if="showDraggable"
          :list="group.items"
          item-key="id"
          ghost-class="sp-ghost"
          drag-class="sp-drag"
          handle=".sp-grip"
          class="set-plugin-list"
          @end="onGroupDragEnd(group.id)"
        >
          <template #item="{ element: p }">
            <div class="set-plugin-item">
              <span class="sp-grip" title="域内拖拽排序"><WsIcon name="grip" size="xs" /></span>
              <span v-if="p.source" class="sp-source">{{ sourceLabel(p) }}</span>
              <span
                class="sp-icon-btn"
                role="button"
                tabindex="0"
                :title="`换图标：${p.label}`"
                :aria-label="`${p.label}图标，点击更换`"
                @click.stop="emit('edit-icon', p.id)"
                @keydown.enter.prevent="emit('edit-icon', p.id)"
                @keydown.space.prevent="emit('edit-icon', p.id)"
              ><WsIcon v-if="hasIcon(resolvedIcon(p))" :name="resolvedIcon(p)" size="sm" /><span v-else>{{ resolvedIcon(p) }}</span></span>
              <label class="sp-toggle"><input type="checkbox" :checked="p.active" @change="onSproutToggle(p.id)" /><span class="sp-label">{{ p.label }}</span></label>
              <button
                type="button"
                class="sp-info"
                :class="{ warn: attentionIds.includes(p.id) }"
                :aria-label="`${p.label}详情`"
                :aria-expanded="expandedId === p.id"
                :title="attentionIds.includes(p.id) ? '芽详情（状态异常）' : '芽详情'"
                @click="toggleDetail(p.id)"
              >
                <WsIcon name="info" size="xs" />
              </button>
            </div>
          </template>
        </draggable>
        <div v-else class="set-plugin-list">
          <div v-for="p in group.items" :key="p.id" class="set-plugin-item">
            <span v-if="p.source" class="sp-source">{{ sourceLabel(p) }}</span>
            <span
                class="sp-icon-btn"
                role="button"
                tabindex="0"
                :title="`换图标：${p.label}`"
                :aria-label="`${p.label}图标，点击更换`"
                @click.stop="emit('edit-icon', p.id)"
                @keydown.enter.prevent="emit('edit-icon', p.id)"
                @keydown.space.prevent="emit('edit-icon', p.id)"
              ><WsIcon v-if="hasIcon(resolvedIcon(p))" :name="resolvedIcon(p)" size="sm" /><span v-else>{{ resolvedIcon(p) }}</span></span>
              <label class="sp-toggle"><input type="checkbox" :checked="p.active" @change="onSproutToggle(p.id)" /><span class="sp-label">{{ p.label }}</span></label>
            <button
              type="button"
              class="sp-info"
              :class="{ warn: attentionIds.includes(p.id) }"
              :aria-label="`${p.label}详情`"
              :aria-expanded="expandedId === p.id"
              :title="attentionIds.includes(p.id) ? '芽详情（状态异常）' : '芽详情'"
              @click="toggleDetail(p.id)"
            >
              <WsIcon name="info" size="xs" />
            </button>
          </div>
        </div>
        <div v-if="expandedId && group.items.some(p => p.id === expandedId)" class="sp-detail">
          <slot name="sprout-detail" :id="expandedId" />
        </div>
      </template>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, onUpdated, ref, watch } from 'vue'
import { SPROUT_DOMAINS, usePluginStore, useSettingsStore, useUIStore, type SproutToggle } from '@worldsea/entity-core'
import { hasIcon } from '@worldsea/ui-kit'
import WsIcon from '../../WsIcon.vue'
import draggable from 'vuedraggable'
import { matchKeywords } from '../utils'
import { groupSproutsByDomain, mergeDomainOrder, UNCLASSIFIED_DOMAIN, type SproutDomainGroup } from './sproutDomainGroups'

const props = withDefaults(defineProps<{
  searchQuery?: string
  excludeIds?: string[]
  /** manifest.domain 查询口（由应用侧注入；ui-kit 不反向依赖世界树） */
  domainOf?: (pluginId: string) => string
  /** 需要提示状态异常的芽 id（已启用但未装载/被拒/无入口视图） */
  attentionIds?: string[]
  /** 图标解析口（应用侧注入覆盖层；缺省原样返回芽默认） */
  iconOf?: (sproutId: string, fallback: string) => string
}>(), {
  domainOf: () => () => UNCLASSIFIED_DOMAIN,
  attentionIds: () => [],
  iconOf: () => (_id: string, fallback: string) => fallback,
})

const emit = defineEmits<{ dirty: []; inspect: [id: string]; 'edit-icon': [id: string] }>()

const store = useSettingsStore()
const uiStore = useUIStore()
const pluginStore = usePluginStore()

const sproutSearch = ref('')
const expandedId = ref<string | null>(null)

function toggleDetail(id: string) {
  expandedId.value = expandedId.value === id ? null : id
  emit('inspect', id)
}

const activeDomain = ref<string>('all')
const flatSprouts = ref<SproutToggle[]>([])
const groups = ref<SproutDomainGroup<SproutToggle>[]>([])

const COLLAPSE_KEY = 'worldsea_sprout_domain_collapsed'

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY)
    if (raw === null) return new Set(['tool'])
    const parsed = JSON.parse(raw)
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set(['tool'])
  }
}

const collapsedDomains = ref<Set<string>>(loadCollapsed())

function saveCollapsed() {
  try {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsedDomains.value]))
  } catch { /* quota exceeded, 静默 */ }
}

function match(keywords: string): boolean {
  return matchKeywords(props.searchQuery ?? '', keywords)
}

/** 注册表外的域（外部插件自造域/缺省）统一归未分类，筛选与分组同口径。 */
function domainKey(pluginId: string): string {
  const domain = props.domainOf(pluginId)
  return SPROUT_DOMAINS.some(item => item.id === domain) ? domain : UNCLASSIFIED_DOMAIN
}

function sourceLabel(p: SproutToggle): string {
  return p.source === 'builtin' ? '内置' : p.source === 'local' ? '本地' : p.source === 'external' ? '外部' : '远程'
}

function resolvedIcon(p: SproutToggle): string {
  return props.iconOf(p.id, p.icon)
}

function syncSproutList() {
  const excluded = new Set(props.excludeIds ?? [])
  const order = uiStore.sidebarOrder
  const sorted = [...store.sprouts]
    .filter(p => !excluded.has(p.id))
    .sort((a, b) => {
      const va = pluginStore.views.find(v => v.pluginId === a.id)
      const vb = pluginStore.views.find(v => v.pluginId === b.id)
      const ia = va ? order.indexOf(va.id) : 999
      const ib = vb ? order.indexOf(vb.id) : 999
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
    })
    .map(p => ({ ...p }))
  flatSprouts.value = sorted
  groups.value = groupSproutsByDomain(sorted, domainKey)
  if (activeDomain.value !== 'all' && !groups.value.some(group => group.id === activeDomain.value)) {
    activeDomain.value = 'all'
  }
}

watch(() => [uiStore.sidebarOrder, store.sprouts, props.excludeIds, props.domainOf] as const, () => {
  syncSproutList()
}, { deep: true, immediate: true })

const domainChips = computed<Array<{ id: string; label: string }>>(() => {
  const chips: Array<{ id: string; label: string }> = SPROUT_DOMAINS.map(domain => ({ id: domain.id, label: domain.label }))
  if (groups.value.some(group => group.id === UNCLASSIFIED_DOMAIN)) {
    chips.push({ id: UNCLASSIFIED_DOMAIN, label: '未分类' })
  }
  return chips
})

const filterActive = computed(() => !!sproutSearch.value || activeDomain.value !== 'all')
const showDraggable = computed(() => !filterActive.value)

/* ── 域 Tab 单行横向滚动（与设置顶部 Tab 同语言） ── */
const domainTabsRef = ref<HTMLElement | null>(null)
const canScrollTabsLeft = ref(false)
const canScrollTabsRight = ref(false)

function updateDomainTabsOverflow() {
  const el = domainTabsRef.value
  if (!el) return
  canScrollTabsLeft.value = el.scrollLeft > 0
  canScrollTabsRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
}

function scrollDomainTabs(dir: number) {
  const el = domainTabsRef.value
  if (!el) return
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  el.scrollBy({ left: dir * 180, behavior: reduced ? 'auto' : 'smooth' })
}

function onDomainTabsWheel(event: WheelEvent) {
  const el = domainTabsRef.value
  if (!el) return
  el.scrollLeft += event.deltaY
  event.preventDefault()
}

onMounted(() => {
  nextTick(updateDomainTabsOverflow)
  window.addEventListener('resize', updateDomainTabsOverflow)
})
onUpdated(updateDomainTabsOverflow)
onBeforeUnmount(() => {
  window.removeEventListener('resize', updateDomainTabsOverflow)
})

watch(domainChips, () => nextTick(updateDomainTabsOverflow))
watch(activeDomain, () => nextTick(() => {
  const active = domainTabsRef.value?.querySelector<HTMLElement>('.sp-domain-tab.active')
  active?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  updateDomainTabsOverflow()
}))

const visibleGroups = computed(() => {
  let list = groups.value
  if (activeDomain.value !== 'all') list = list.filter(group => group.id === activeDomain.value)
  if (!sproutSearch.value) return list
  const q = sproutSearch.value.toLowerCase()
  return list
    .map(group => ({
      ...group,
      items: group.items.filter(p => p.label.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)),
    }))
    .filter(group => group.items.length > 0)
})

const displayGroups = computed(() => (showDraggable.value ? groups.value : visibleGroups.value))

const filteredSprouts = computed(() => {
  let list = flatSprouts.value
  if (activeDomain.value !== 'all') list = list.filter(p => domainKey(p.id) === activeDomain.value)
  if (sproutSearch.value) {
    const q = sproutSearch.value.toLowerCase()
    list = list.filter(p => p.label.toLowerCase().includes(q) || p.id.toLowerCase().includes(q))
  }
  return list
})

const filteredAllActive = computed(() =>
  filteredSprouts.value.length > 0 && filteredSprouts.value.every(p => p.active),
)

function activeCount(group: SproutDomainGroup<SproutToggle>): number {
  return group.items.filter(p => p.active).length
}

function isCollapsed(domainId: string): boolean {
  return !filterActive.value && collapsedDomains.value.has(domainId)
}

function onGroupHead(domainId: string) {
  if (filterActive.value) return
  const next = new Set(collapsedDomains.value)
  if (next.has(domainId)) next.delete(domainId)
  else next.add(domainId)
  collapsedDomains.value = next
  saveCollapsed()
}

function onSproutToggle(id: string) {
  store.toggleSprout(id)
  emit('dirty')
}

function onToggleSelectAll() {
  onSelectAll(!filteredAllActive.value)
}

function onSelectAll(active: boolean) {
  store.setSproutsActive(filteredSprouts.value.map(p => p.id), active)
  emit('dirty')
}

function onGroupDragEnd(domainId: string) {
  const group = groups.value.find(item => item.id === domainId)
  if (!group) return
  const orderedIds = group.items
    .map(p => pluginStore.views.find(view => view.pluginId === p.id)?.id)
    .filter((id): id is string => !!id)
  uiStore.sidebarOrder = mergeDomainOrder(uiStore.sidebarOrder, orderedIds)
  emit('dirty')
}

defineExpose({ resetSproutSearch: () => { sproutSearch.value = '' } })
</script>

<style scoped src="./sprouts-card.css"></style>
