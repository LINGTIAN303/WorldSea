<template>
  <div
    class="ws-sn-sidebar"
    :class="{ collapsed: uiStore.sidebarCollapsed, 'sidebar-right': sidebarRight }"
    role="navigation"
    aria-label="芽导航"
  >
    <!-- 侧栏背景层：宿主为 z10 堆叠上下文（contain: strict），层 z-1 位于底色之上、内容之下 -->
    <BackgroundLayer target="sidebar" />
    <button
      v-if="uiStore.sidebarCollapsed"
      class="ws-sn-toggle"
      aria-label="展开侧边栏"
      title="展开侧边栏"
      data-ws-tip-keys="Ctrl+B"
      @click="uiStore.toggleSidebar()"
    >
      <WsIcon name="menu" size="md" />
    </button>
    <div v-else class="ws-sn-inner">
      <div class="ws-sn-header">
        <QuickAccess :side="sidebarRight ? 'right' : 'left'" />
        <button
          class="ws-sn-collapse"
          aria-label="收起侧边栏"
          title="收起侧边栏"
          data-ws-tip-keys="Ctrl+B"
          @pointerdown.stop
          @click="uiStore.toggleSidebar()"
        >
          <WsIcon :name="sidebarRight ? 'chevron-right' : 'chevron-left'" size="sm" />
        </button>
      </div>
      <div class="ws-sn-body">
        <SproutList
          v-if="mode === 'flat'"
          :views="views"
          :active-id="activeId"
          @select="selectView"
        />
        <DomainRail
          v-else-if="mode === 'rail'"
          :domains="nav.domains"
          :filter="uiStore.sproutDomainFilter"
          :views="nav.views"
          :active-id="activeId"
          @select-domain="selectDomain"
          @select-view="selectView"
        />
        <DomainTabs
          v-else-if="mode === 'tabs'"
          :domains="nav.domains"
          :filter="uiStore.sproutDomainFilter"
          :views="nav.views"
          :active-id="activeId"
          @select-domain="selectDomain"
          @select-view="selectView"
        />
        <DomainDual
          v-else-if="mode === 'dual'"
          :domains="nav.domains"
          :filter="uiStore.sproutDomainFilter"
          :views="nav.views"
          :active-id="activeId"
          @select-domain="selectDomain"
          @select-view="selectView"
        />
        <DomainPopover
          v-else
          :domains="nav.domains"
          :filter="uiStore.sproutDomainFilter"
          :all-views="views"
          :domain-of="domainOf"
          :active-id="activeId"
          :sidebar-right="sidebarRight"
          @select-domain="selectDomain"
          @select-view="selectView"
        />
      </div>
    </div>
    <div class="ws-sn-footer">
      <AppMenu />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { WsIcon, BackgroundLayer } from '@worldsea/ui-kit'
import type { PluginView } from '@worldsea/entity-core/types'
import { useUIStore, type SproutDomainFilter } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { availablePlugins } from '@/world'
import AppMenu from '@/ui/layout/AppMenu.vue'
import { allVisibleViewsInSidebarOrder, visibleViewsInSidebarOrder } from './viewOrder'
import { buildDomainMap, buildSproutNavigation, filterForView, makeDomainOfPlugin } from './sproutNavigation'
import DomainDual from './DomainDual.vue'
import DomainPopover from './DomainPopover.vue'
import DomainRail from './DomainRail.vue'
import DomainTabs from './DomainTabs.vue'
import QuickAccess from './QuickAccess.vue'
import SproutList from './SproutList.vue'
import './sidebar-nav.css'

const props = defineProps<{ mode: 'flat' | 'popover' | 'rail' | 'tabs' | 'dual'; forceSide?: 'left' | 'right' }>()

const uiStore = useUIStore()
const settingsStore = useSettingsStore()

/** flat 静态回退：平铺看全量；左右侧栏仍按独立域栏的过滤结果。 */
const views = computed(() => (
  props.mode === 'flat' && uiStore.sproutNavMode === 'flat'
    ? allVisibleViewsInSidebarOrder()
    : visibleViewsInSidebarOrder()
))
// availablePlugins() 非响应式；views 随树装载/卸载变化，借它触发域映射重读
const domainMap = computed(() => {
  void views.value
  return buildDomainMap(availablePlugins())
})
const domainOf = computed(() => makeDomainOfPlugin(domainMap.value))
const nav = computed(() => buildSproutNavigation(views.value, domainOf.value, uiStore.sproutDomainFilter))
const activeId = computed(() => uiStore.currentView)
const sidebarRight = computed(() => (props.forceSide ?? settingsStore.sidebarPosition) === 'right')

function selectDomain(id: SproutDomainFilter) {
  uiStore.sproutDomainFilter = id
}

function selectView(view: PluginView) {
  uiStore.showView(view)
}

/** 静态回退没有 SidebarV2 的落点 watcher：冷启动或 split 换域后补一次首芽兜底。 */
watch(
  () => [views.value.map(view => view.id).join('|'), uiStore.currentView, uiStore.sproutNavMode] as const,
  () => {
    if (views.value.length === 0) return
    if (uiStore.currentView && views.value.some(view => view.id === uiStore.currentView)) return
    const first = views.value[0]
    uiStore.showView(first)
  },
  { immediate: true, flush: 'post' },
)

// 快捷键/跳转把主视图切到别的域时，域过滤跟随；「全部」保持不变。
watch(() => uiStore.currentView, id => {
  if (uiStore.sproutNavMode === 'flat' || uiStore.sproutDomainFilter === 'all') return
  const view = views.value.find(item => item.id === id)
  const next = filterForView(view, domainOf.value)
  if (next !== uiStore.sproutDomainFilter) uiStore.sproutDomainFilter = next
})

// 记住的域已没有可见芽（例如芽被停用）时回到「全部」；树未就绪时不要清记忆。
watch(() => nav.value.domains.map(domain => domain.id).join('|'), () => {
  if (views.value.length === 0) return
  const filter = uiStore.sproutDomainFilter
  if (filter !== 'all' && !nav.value.domains.some(domain => domain.id === filter)) {
    uiStore.sproutDomainFilter = 'all'
  }
})
</script>
