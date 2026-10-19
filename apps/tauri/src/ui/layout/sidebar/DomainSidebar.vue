<template>
  <div
    class="ws-split-sidebar"
    :class="[side === 'right' ? 'is-right' : 'is-left', { collapsed: uiStore.sidebarCollapsed }]"
    role="navigation"
    aria-label="语义域导航"
  >
    <button
      v-if="uiStore.sidebarCollapsed"
      class="ws-split-toggle"
      aria-label="展开侧边栏"
      title="展开侧边栏（Ctrl+B）"
      @click="uiStore.toggleSidebar()"
    >
      <WsIcon name="menu" size="md" />
    </button>
    <div v-else class="ws-split-inner">
      <div class="ws-split-header">
        <button
          class="ws-split-collapse"
          aria-label="收起侧边栏"
          title="收起侧边栏（Ctrl+B）"
          @click="uiStore.toggleSidebar()"
        >
          <WsIcon :name="side === 'right' ? 'chevron-right' : 'chevron-left'" size="sm" />
        </button>
      </div>
      <div
        ref="carouselRef"
        class="ws-split-carousel"
        @wheel.prevent="onWheel"
        @pointerdown="onPointerDown"
      >
        <button
          v-for="item in carouselItems"
          :key="item.realIndex"
          class="sidebar-btn ws-split-domain"
          :class="{ active: item.domain.id === filter }"
          :data-offset="item.offset"
          :title="item.domain.label"
          :aria-label="item.domain.label"
          :aria-pressed="item.domain.id === filter"
        >
          <WsIcon :name="item.domain.icon" size="md" class="ws-split-icon" />
          <span class="ws-split-label">{{ item.domain.label }}</span>
          <span class="ws-split-count">{{ item.domain.count }}</span>
        </button>
        <div v-if="domains.length === 0" class="ws-split-empty">暂无语义域</div>
      </div>
    </div>
    <div class="ws-split-footer">
      <AppMenu />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import { useUIStore, type SproutDomainFilter } from '@/stores/uiStore'
import AppMenu from '@/ui/layout/AppMenu.vue'
import { useSidebarInteraction } from './useSidebarInteraction'
import { useSidebarPhysics } from './useSidebarPhysics'
import type { SproutDomainGroup } from './sproutNavigation'

const props = defineProps<{
  side: 'left' | 'right'
  domains: SproutDomainGroup[]
  filter: SproutDomainFilter
}>()

const emit = defineEmits<{ select: [id: SproutDomainGroup['id']] }>()

const uiStore = useUIStore()
const carouselRef = ref<HTMLElement | null>(null)

const physics = useSidebarPhysics({
  getViewCount: () => props.domains.length,
  onTick: () => syncDomStyles(),
  onSettle: idx => {
    const domain = props.domains[idx]
    if (domain) emit('select', domain.id)
  },
})

const interaction = useSidebarInteraction({
  onDragStart: () => physics.stopPhysics(),
  onDragMove: newPos => {
    physics.setPosition(newPos, false)
    syncDomStyles()
  },
  onDragEnd: velocity => physics.fling(velocity),
  onClick: (offset, startPos) => {
    if (offset === 0) {
      triggerPulse()
      return
    }
    physics.springTo(Math.round(startPos) + offset)
  },
})

function onPointerDown(e: PointerEvent) {
  interaction.onPointerDown(e, physics.pos.value)
}

function onWheel(e: WheelEvent) {
  if (props.domains.length === 0) return
  const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX
  physics.applyImpulse(delta > 0 ? 1 : -1)
}

interface CarouselItem {
  domain: SproutDomainGroup
  offset: number
  realIndex: number
}

const carouselItems = computed<CarouselItem[]>(() => {
  const domains = props.domains
  const n = domains.length
  if (n === 0) return []
  const center = physics.getSettledIdx()
  const half = Math.min(Math.ceil(n / 2), 8)
  const items: CarouselItem[] = []
  const seen = new Set<number>()
  for (let offset = -half; offset <= half; offset++) {
    const realIdx = ((center + offset) % n + n) % n
    if (seen.has(realIdx)) continue
    seen.add(realIdx)
    items.push({ domain: domains[realIdx], offset, realIndex: realIdx })
  }
  return items
})

function syncDomStyles() {
  const container = carouselRef.value
  if (!container) return
  const buttons = container.querySelectorAll<HTMLElement>('.ws-split-domain')
  if (buttons.length === 0) return
  const center = Math.round(physics.pos.value)
  const fractional = physics.pos.value - center
  buttons.forEach(el => {
    const raw = el.getAttribute('data-offset')
    if (raw === null) return
    const offset = parseInt(raw, 10)
    const displayOffset = offset - fractional
    const absOffset = Math.abs(displayOffset)
    const opacity = Math.max(0, 1 - absOffset * 0.13)
    const scale = Math.max(0.6, 1 - absOffset * 0.04)
    el.style.opacity = String(opacity)
    el.style.transform = `scale(${scale})`
    el.style.zIndex = String(20 - Math.floor(absOffset))
  })
}

function triggerPulse() {
  const center = carouselRef.value?.querySelector<HTMLElement>('.ws-split-domain[data-offset="0"]')
  if (!center) return
  center.classList.remove('pulse')
  void center.offsetWidth
  center.classList.add('pulse')
  setTimeout(() => center.classList.remove('pulse'), 300)
}

function syncToCurrent() {
  const n = props.domains.length
  if (n === 0) return
  const idx = props.domains.findIndex(domain => domain.id === props.filter)
  const target = idx >= 0 ? idx : 0
  physics.setPosition(target)
  physics.syncSettledIdx(target)
  void nextTick(() => syncDomStyles())
}

watch(() => [props.filter, props.domains.map(domain => domain.id).join('|')], syncToCurrent, {
  immediate: true,
  flush: 'post',
})

watch(() => uiStore.sidebarCollapsed, collapsed => {
  if (collapsed) physics.stopPhysics()
})

onBeforeUnmount(() => physics.stopPhysics())
</script>
