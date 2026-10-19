<template>
  <SidebarV2 />
  <DomainSidebar
    :side="domainSide"
    :domains="nav.domains"
    :filter="uiStore.sproutDomainFilter"
    @select="selectDomain"
  />
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { useUIStore, type SproutDomainFilter } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { availablePlugins } from '@/world'
import SidebarV2 from './SidebarV2.vue'
import DomainSidebar from './DomainSidebar.vue'
import { allVisibleViewsInSidebarOrder } from './viewOrder'
import { buildDomainMap, buildSproutNavigation, filterForView, makeDomainOfPlugin } from './sproutNavigation'

const uiStore = useUIStore()
const settingsStore = useSettingsStore()

const views = computed(() => allVisibleViewsInSidebarOrder())
// availablePlugins() 非响应式；views 随树装载/卸载变化，借它触发域映射重读
const domainMap = computed(() => {
  void views.value
  return buildDomainMap(availablePlugins())
})
const domainOf = computed(() => makeDomainOfPlugin(domainMap.value))
const nav = computed(() => buildSproutNavigation(views.value, domainOf.value, uiStore.sproutDomainFilter))
const domainSide = computed(() => (settingsStore.sidebarPosition === 'right' ? 'left' : 'right'))

function selectDomain(id: SproutDomainFilter) {
  uiStore.sproutDomainFilter = id
}

// 跳转/快捷键把主视图切到别的域时，域过滤跟随；「全部」保持不变。
watch(() => uiStore.currentView, id => {
  if (uiStore.sproutDomainFilter === 'all') return
  const view = views.value.find(item => item.id === id)
  const next = filterForView(view, domainOf.value)
  if (next !== uiStore.sproutDomainFilter) uiStore.sproutDomainFilter = next
})

// 记住的域已没有可见芽时回到「全部」；树未就绪时不要清记忆。
watch(() => nav.value.domains.map(domain => domain.id).join('|'), () => {
  if (views.value.length === 0) return
  const filter = uiStore.sproutDomainFilter
  if (filter !== 'all' && !nav.value.domains.some(domain => domain.id === filter)) {
    uiStore.sproutDomainFilter = 'all'
  }
})
</script>
