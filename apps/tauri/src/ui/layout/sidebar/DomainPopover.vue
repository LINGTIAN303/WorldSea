<template>
  <div ref="listRef">
    <DomainList :domains="domains" :active="filter" @select="onSelectDomain" />
  </div>
  <Teleport to="body">
    <div
      v-if="openId"
      ref="panelRef"
      class="ws-sn-popover"
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
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { PluginView } from '@worldsea/entity-core/types'
import type { SproutDomainFilter } from '@/stores/uiStore'
import DomainList from './DomainList.vue'
import SproutList from './SproutList.vue'
import type { DomainOfPlugin, SproutDomainGroup } from './sproutNavigation'

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
  const top = Math.min(Math.max(8, rect.top), Math.max(8, window.innerHeight - 160))
  const left = props.sidebarRight ? rect.left - width - 8 : rect.right + 8
  return {
    top: `${top}px`,
    left: `${Math.max(8, left)}px`,
    width: `${width}px`,
    maxHeight: `${Math.max(160, Math.min(420, window.innerHeight - top - 8))}px`,
  }
})

function onSelectDomain(id: SproutDomainGroup['id'], event: MouseEvent) {
  if (openId.value === id) {
    close()
    return
  }
  emit('select-domain', id)
  openId.value = id
  openLabel.value = props.domains.find(domain => domain.id === id)?.label ?? '全部'
  anchorRect.value = (event.currentTarget as HTMLElement).getBoundingClientRect()
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
