<template>
  <div ref="listRef" class="ws-sn-popover-trigger">
    <WheelDomainList
      v-if="uiStore.sproutWheelEnabled"
      :domains="domains"
      :active="filter"
      @select="onSelectDomain"
      @settle="onSettleDomain"
    />
    <DomainList v-else :domains="domains" :active="filter" @select="onSelectDomain" />
  </div>
  <Teleport to="body">
    <div
      v-if="openId"
      ref="panelRef"
      class="ws-sn-popover"
      :class="{ 'is-sidebar-right': sidebarRight }"
      :style="popoverStyle"
      role="dialog"
      :aria-label="openLabel"
    >
      <div class="ws-sn-popover-head">
        <strong>{{ openLabel }}</strong>
        <span>{{ popoverViews.length }}</span>
        <button class="ws-sn-popover-close" aria-label="关闭" @click="close">✕</button>
      </div>
      <SproutList :views="popoverViews" :active-id="activeId" @select="onSelectView" />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useUIStore } from '@worldsea/entity-core'
import type { PluginView } from '@worldsea/entity-core/types'
import type { SproutDomainFilter } from '@/stores/uiStore'
import DomainList from './DomainList.vue'
import SproutList from './SproutList.vue'
import WheelDomainList from './WheelDomainList.vue'
import type { DomainOfPlugin, SproutDomainGroup } from './sproutNavigation'

const uiStore = useUIStore()

const props = defineProps<{
  domains: SproutDomainGroup[]
  filter: SproutDomainFilter
  allViews: PluginView[]
  domainOf: DomainOfPlugin
  activeId: string | null
  sidebarRight: boolean
}>()

const emit = defineEmits<{
  'select-domain': [id: SproutDomainGroup['id']]
  'select-view': [view: PluginView]
}>()

const listRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const openId = ref<SproutDomainGroup['id'] | null>(null)
const openLabel = ref('')
const anchorRect = ref<DOMRect | null>(null)
const panelHeight = ref(0)

const popoverViews = computed(() => {
  const id = openId.value
  if (!id) return []
  if (id === 'all') return props.allViews
  return props.allViews.filter(view => props.domainOf(view.pluginId) === id)
})

const popoverStyle = computed(() => {
  const rect = anchorRect.value
  if (!rect) return {}
  const width = 220
  const height = Math.min(panelHeight.value || 240, 420, window.innerHeight - 16)
  const anchorCenter = rect.top + rect.height / 2
  const top = Math.min(
    Math.max(8, anchorCenter - height / 2),
    Math.max(8, window.innerHeight - height - 8),
  )
  const left = props.sidebarRight ? rect.left - width - 8 : rect.right + 8
  // 浮层与选中的域行同水平线居中；箭头始终保持在该行中心（受面板内边距约束）。
  const arrowTop = Math.min(Math.max(12, anchorCenter - top), Math.max(12, height - 12))
  return {
    top: `${top}px`,
    left: `${Math.max(8, left)}px`,
    width: `${width}px`,
    maxHeight: `${Math.max(160, Math.min(420, window.innerHeight - top - 8))}px`,
    '--ws-sn-arrow-top': `${arrowTop}px`,
  }
})

function measurePanel() {
  nextTick(() => {
    panelHeight.value = panelRef.value?.offsetHeight || 0
  })
}

watch(() => popoverViews.value.length, measurePanel)

function openDomain(id: SproutDomainGroup['id'], rect: DOMRect) {
  emit('select-domain', id)
  openId.value = id
  openLabel.value = props.domains.find(domain => domain.id === id)?.label ?? '全部'
  anchorRect.value = rect
  panelHeight.value = 0
  measurePanel()
}

function onSelectDomain(id: SproutDomainGroup['id'], event: MouseEvent) {
  if (openId.value === id) {
    close()
    return
  }
  openDomain(id, (event.currentTarget as HTMLElement).getBoundingClientRect())
}

/** 域轮盘落定：浮层跟随居中域；滚轮/拖拽浏览时保持内容与锚点同步。 */
function onSettleDomain(id: SproutDomainGroup['id'], rect: DOMRect) {
  if (id === openId.value) {
    anchorRect.value = rect
    return
  }
  openDomain(id, rect)
}

function onSelectView(view: PluginView) {
  emit('select-view', view)
  close()
}

function close() {
  openId.value = null
  anchorRect.value = null
}

function onPointerDown(event: PointerEvent) {
  if (!openId.value) return
  const target = event.target as Node
  if (panelRef.value?.contains(target) || listRef.value?.contains(target)) return
  close()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close()
}

onMounted(() => {
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onPointerDown, true)
  window.removeEventListener('keydown', onKeydown)
})
</script>
