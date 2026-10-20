<template>
  <div
    ref="listRef"
    class="ws-wheel-domain-list"
    @wheel.prevent="onWheel"
    @pointerdown="onPointerDown"
  >
    <button
      v-for="(domain, index) in domains"
      :key="domain.id"
      class="sidebar-btn ws-sn-domain ws-wheel-domain"
      :class="{ active: domain.id === active }"
      :data-index="index"
      :data-offset="0"
      :title="domain.label"
      :aria-label="domain.label"
      :aria-pressed="domain.id === active"
      :aria-current="domain.id === active ? 'page' : undefined"
      @click="onDomainClick(domain, index, $event)"
    >
      <WsIcon :name="domain.icon" size="sm" class="ws-sn-domain-icon" />
      <span class="ws-sn-domain-label">{{ domain.label }}</span>
      <span class="ws-sn-domain-count">{{ domain.count }}</span>
    </button>
    <div v-if="domains.length === 0" class="ws-sn-empty">暂无语义域</div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import type { SproutDomainFilter } from '@/stores/uiStore'
import { useSidebarInteraction } from './useSidebarInteraction'
import { useSidebarPhysics } from './useSidebarPhysics'
import type { SproutDomainGroup } from './sproutNavigation'

const props = defineProps<{
  domains: SproutDomainGroup[]
  active: SproutDomainFilter
}>()

const emit = defineEmits<{
  select: [id: SproutDomainGroup['id'], event: MouseEvent]
  settle: [id: SproutDomainGroup['id'], rect: DOMRect]
}>()

const ITEM_H = 32
const listRef = ref<HTMLElement | null>(null)

const physics = useSidebarPhysics({
  getViewCount: () => props.domains.length,
  onTick: () => syncDomStyles(),
  onSettle: idx => {
    const domain = props.domains[idx]
    if (!domain) return
    void nextTick(() => {
      const el = listRef.value?.querySelector<HTMLElement>(`[data-index="${idx}"]`)
      if (el) emit('settle', domain.id, el.getBoundingClientRect())
    })
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
  if (props.domains.length === 0) return
  const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX
  physics.applyImpulse(delta > 0 ? 1 : -1)
}

/** 环形偏移：域列表所有项各出现一次，选中项固定在列表垂直中线。 */
function offsetOf(index: number, center: number, n: number): number {
  let offset = index - center
  if (offset > n / 2 || (n % 2 === 0 && offset === n / 2)) offset -= n
  if (offset < -n / 2) offset += n
  return offset
}

function syncDomStyles() {
  const container = listRef.value
  const n = props.domains.length
  if (!container || n === 0) return
  const center = Math.round(physics.pos.value)
  const fractional = physics.pos.value - center
  container.querySelectorAll<HTMLElement>('.ws-wheel-domain').forEach(el => {
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

function onDomainClick(
  domain: SproutDomainGroup,
  index: number,
  event: MouseEvent,
) {
  if (suppressClick) return
  physics.setPosition(index)
  physics.syncSettledIdx(index)
  syncDomStyles()
  emit('select', domain.id, event)
}

function syncToActive() {
  const idx = props.domains.findIndex(domain => domain.id === props.active)
  const target = idx >= 0 ? idx : 0
  physics.setPosition(target)
  physics.syncSettledIdx(target)
  void nextTick(() => syncDomStyles())
}

watch(() => [props.active, props.domains.map(domain => domain.id).join('|')], syncToActive, {
  immediate: true,
  flush: 'post',
})

onBeforeUnmount(() => physics.stopPhysics())
</script>
