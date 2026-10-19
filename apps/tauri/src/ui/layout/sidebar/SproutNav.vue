<template>
  <div
    class="ws-sn-sidebar"
    :class="{ collapsed: uiStore.sidebarCollapsed, 'sidebar-right': sidebarRight }"
    role="navigation"
    aria-label="芽导航"
  >
    <button
      v-if="uiStore.sidebarCollapsed"
      class="ws-sn-toggle"
      aria-label="展开侧边栏"
      title="展开侧边栏（Ctrl+B）"
      @click="uiStore.toggleSidebar()"
    >
      <WsIcon name="menu" size="md" />
    </button>
    <div v-else class="ws-sn-inner">
      <div class="ws-sn-header">
        <button
          class="ws-sn-collapse"
          aria-label="收起侧边栏"
          title="收起侧边栏（Ctrl+B）"
          @click="uiStore.toggleSidebar()"
        >
          <WsIcon :name="sidebarRight ? 'chevron-right' : 'chevron-left'" size="sm" />
        </button>
      </div>
      <div class="ws-sn-body">
        <DomainRail
          v-if="mode === 'rail'"
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
import { WsIcon } from '@worldsea/ui-kit'
import type { PluginView } from '@worldsea/entity-core/types'
import { useUIStore, type SproutDomainFilter } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { availablePlugins } from '@/world'
import AppMenu from '@/ui/layout/AppMenu.vue'
import { visibleViewsInSidebarOrder } from './viewOrder'
import { buildDomainMap, buildSproutNavigation, filterForView, makeDomainOfPlugin } from './sproutNavigation'
import DomainPopover from './DomainPopover.vue'
import DomainRail from './DomainRail.vue'
import DomainTabs from './DomainTabs.vue'
import './sidebar-nav.css'

defineProps<{ mode: 'popover' | 'rail' | 'tabs' }>()

const uiStore = useUIStore()
const settingsStore = useSettingsStore()

const views = computed(() => visibleViewsInSidebarOrder())
// availablePlugins() 非响应式；views 随树装载/卸载变化，借它触发域映射重读
const domainMap = computed(() => {
  void views.value
  return buildDomainMap(availablePlugins())
})
const domainOf = computed(() => makeDomainOfPlugin(domainMap.value))
const nav = computed(() => buildSproutNavigation(views.value, domainOf.value, uiStore.sproutDomainFilter))
const activeId = computed(() => uiStore.currentView)
const sidebarRight = computed(() => settingsStore.sidebarPosition === 'right')

function selectDomain(id: SproutDomainFilter) {
  uiStore.sproutDomainFilter = id
}

function selectView(view: PluginView) {
  uiStore.setView(view.id)
  uiStore.viewComponent = view.component
}

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
