<template>
  <div
    ref="listRef"
    class="ws-wheel-list"
    @wheel.prevent="onWheel"
    @pointerdown="onPointerDown"
  >
    <button
      v-for="(view, index) in views"
      :key="view.id"
      class="sidebar-btn ws-sn-view ws-wheel-view"
      :class="{ active: view.id === activeId }"
      :data-index="index"
      :data-offset="0"
      :title="view.label"
      :aria-current="view.id === activeId ? 'page' : undefined"
      @click="onViewClick(view, index)"
    >
      <WsIcon v-if="hasIcon(view.icon)" :name="view.icon" size="sm" class="ws-sn-view-icon" />
      <span v-else class="ws-sn-view-icon ws-sn-view-icon-text">{{ view.icon }}</span>
      <span class="ws-sn-view-label">{{ view.label }}</span>
      <CountBadge v-if="uiStore.sproutCountEnabled && countOf(view) > 0" :value="countOf(view)" />
    </button>
    <div v-if="views.length === 0" class="ws-sn-empty">
      当前域暂无可见芽
      <span>可在设置的芽管理中启用</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import { useEntityStore, useUIStore } from '@worldsea/entity-core'
import type { PluginView } from '@worldsea/entity-core/types'
import { hasIcon } from '@/assets/iconRegistry'
import CountBadge from './CountBadge.vue'
import { countEntitiesByPlugin } from './sproutEntityCounts'
import { useSidebarInteraction } from './useSidebarInteraction'
import { useSidebarPhysics } from './useSidebarPhysics'

const props = defineProps<{
  views: PluginView[]
  activeId: string | null
}>()

const emit = defineEmits<{ select: [view: PluginView] }>()

/** 固定行高：选中项以自身中心对齐列表垂直中线，不依赖容器内剩余空间。 */
const ITEM_H = 32

const uiStore = useUIStore()
const entityStore = useEntityStore()
const listRef = ref<HTMLElement | null>(null)
const counts = computed(() => (
  uiStore.sproutCountEnabled ? countEntitiesByPlugin(entityStore.allTypeCounts) : new Map<string, number>()
))

function countOf(view: PluginView): number {
  return counts.value.get(view.pluginId || '') || 0
}

const physics = useSidebarPhysics({
  getViewCount: () => props.views.length,
  onTick: () => syncDomStyles(),
  onSettle: idx => {
    const view = props.views[idx]
    if (view) emit('select', view)
  },
})

let suppressClick = false
const interaction = useSidebarInteraction({
  onDragStart: () => {
    suppressClick = true
    physics.stopPhysics()
  },
  onDragMove: newPos => {
    physics.setPosition(newPos, false)
    syncDomStyles()
  },
  onDragEnd: velocity => {
    physics.fling(velocity)
    setTimeout(() => { suppressClick = false }, 0)
  },
})

function onPointerDown(e: PointerEvent) {
  interaction.onPointerDown(e, physics.pos.value)
}

function onWheel(e: WheelEvent) {
  if (props.views.length === 0) return
  const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX
  physics.applyImpulse(delta > 0 ? 1 : -1)
}

/** 环形偏移：列表所有项各出现一次，选中项固定在列表垂直中线。 */
function offsetOf(index: number, center: number, n: number): number {
  let offset = index - center
  if (offset > n / 2 || (n % 2 === 0 && offset === n / 2)) offset -= n
  if (offset < -n / 2) offset += n
  return offset
}

function syncDomStyles() {
  const container = listRef.value
  const n = props.views.length
  if (!container || n === 0) return
  const center = Math.round(physics.pos.value)
  const fractional = physics.pos.value - center
  container.querySelectorAll<HTMLElement>('.ws-wheel-view').forEach(el => {
    const index = Number(el.dataset.index)
    const integerOffset = offsetOf(index, center, n)
    const displayOffset = integerOffset - fractional
    const absOffset = Math.abs(displayOffset)
    el.dataset.offset = String(integerOffset)
    el.style.opacity = String(Math.max(0, 1 - absOffset * 0.13))
    el.style.transform = `translateY(calc(-50% + ${displayOffset * ITEM_H}px)) scale(${Math.max(0.6, 1 - absOffset * 0.04)})`
    el.style.zIndex = String(20 - Math.floor(absOffset))
  })
}

function triggerPulse() {
  const center = listRef.value?.querySelector<HTMLElement>('.ws-wheel-view[data-offset="0"]')
  if (!center) return
  center.classList.remove('pulse')
  void center.offsetWidth
  center.classList.add('pulse')
  setTimeout(() => center.classList.remove('pulse'), 300)
}

function onViewClick(view: PluginView, index: number) {
  if (suppressClick) return
  if (view.id === props.activeId) {
    physics.setPosition(index)
    physics.syncSettledIdx(index)
    void nextTick(() => {
      syncDomStyles()
      triggerPulse()
    })
    return
  }
  physics.setPosition(index)
  physics.syncSettledIdx(index)
  void nextTick(() => syncDomStyles())
  emit('select', view)
}

function syncToActive() {
  const idx = props.views.findIndex(view => view.id === props.activeId)
  const target = idx >= 0 ? idx : 0
  physics.setPosition(target)
  physics.syncSettledIdx(target)
  void nextTick(() => syncDomStyles())
}

watch(() => [props.activeId, props.views.map(view => view.id).join('|')], syncToActive, {
  immediate: true,
  flush: 'post',
})

onBeforeUnmount(() => physics.stopPhysics())
</script>
