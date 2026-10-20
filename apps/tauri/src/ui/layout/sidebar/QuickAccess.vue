<template>
  <button
    ref="triggerRef"
    class="ws-qa-trigger"
    :class="{ 'is-right': side === 'right' }"
    aria-label="快捷访问"
    aria-haspopup="dialog"
    :aria-expanded="open"
    title="快捷访问（收藏/最近）"
    @mouseenter="onTriggerEnter"
    @mouseleave="scheduleClose"
    @click="togglePinned"
  >
    <WsIcon name="star-outline" size="sm" />
  </button>
  <Teleport to="body">
    <div
      v-if="open"
      ref="panelRef"
      class="ws-qa-panel"
      :style="panelStyle"
      role="dialog"
      aria-label="快捷访问"
      @mouseenter="cancelClose"
      @mouseleave="scheduleClose"
    >
      <div class="ws-qa-head">
        <WsIcon name="star-outline" size="sm" class="ws-qa-head-icon" />
        <strong>快捷访问</strong>
        <button
          class="ws-qa-current"
          :class="{ on: isFavorite(uiStore.currentView) }"
          :disabled="!currentView"
          :title="currentView ? (isFavorite(uiStore.currentView) ? '取消收藏当前芽' : '收藏当前芽') : '暂无当前芽'"
          @click="toggleCurrent"
        >
          <WsIcon name="star-outline" size="sm" />
        </button>
      </div>

      <div class="ws-qa-section">
        <div class="ws-qa-section-title">收藏</div>
        <div v-for="view in favoriteViews" :key="view.id" class="ws-qa-row-wrap">
          <button class="ws-qa-row" :class="{ active: view.id === uiStore.currentView }" :title="view.label" @click="select(view)">
            <WsIcon v-if="hasIcon(view.icon)" :name="view.icon" size="sm" class="ws-qa-icon" />
            <span v-else class="ws-qa-icon ws-qa-icon-text">{{ view.icon }}</span>
            <span class="ws-qa-label">{{ view.label }}</span>
            <span class="ws-qa-domain">{{ domainLabel(view) }}</span>
          </button>
          <button class="ws-qa-star on" title="取消收藏" @click.stop="toggleFavorite(view.id)">
            <WsIcon name="star-outline" size="xs" />
          </button>
        </div>
        <div v-if="favoriteViews.length === 0" class="ws-qa-empty">暂无收藏</div>
      </div>

      <div class="ws-qa-section">
        <div class="ws-qa-section-title">最近</div>
        <div v-for="view in recentViews" :key="view.id" class="ws-qa-row-wrap">
          <button class="ws-qa-row" :class="{ active: view.id === uiStore.currentView }" :title="view.label" @click="select(view)">
            <WsIcon v-if="hasIcon(view.icon)" :name="view.icon" size="sm" class="ws-qa-icon" />
            <span v-else class="ws-qa-icon ws-qa-icon-text">{{ view.icon }}</span>
            <span class="ws-qa-label">{{ view.label }}</span>
            <span class="ws-qa-domain">{{ domainLabel(view) }}</span>
          </button>
          <button class="ws-qa-star" title="收藏" @click.stop="toggleFavorite(view.id)">
            <WsIcon name="star-outline" size="xs" />
          </button>
        </div>
        <div v-if="recentViews.length === 0" class="ws-qa-empty">浏览芽后自动记录</div>
      </div>

      <div class="ws-qa-foot">排序：设置 → 芽管理</div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import { getSproutDomain, useUIStore } from '@worldsea/entity-core'
import type { PluginView } from '@worldsea/entity-core/types'
import { hasIcon } from '@/assets/iconRegistry'
import { availablePlugins } from '@/world'
import { allVisibleViewsInSidebarOrder } from './viewOrder'
import { buildDomainMap, makeDomainOfPlugin } from './sproutNavigation'
import { useQuickAccess } from './useQuickAccess'

const props = withDefaults(defineProps<{ side?: 'left' | 'right' }>(), { side: 'left' })

const uiStore = useUIStore()
const { favorites, recent, isFavorite, toggleFavorite, recordRecent } = useQuickAccess()

const views = computed(() => allVisibleViewsInSidebarOrder())
const domainMap = computed(() => {
  void views.value
  return buildDomainMap(availablePlugins())
})
const domainOf = computed(() => makeDomainOfPlugin(domainMap.value))
const viewById = computed(() => new Map(views.value.map(view => [view.id, view])))
const currentView = computed(() => viewById.value.get(uiStore.currentView ?? '') ?? null)

const favoriteViews = computed(() => favorites.value.flatMap(id => {
  const view = viewById.value.get(id)
  return view ? [view] : []
}))
const recentViews = computed(() => recent.value
  .filter(id => !isFavorite(id))
  .flatMap(id => {
    const view = viewById.value.get(id)
    return view ? [view] : []
  }))

function domainLabel(view: PluginView): string {
  return getSproutDomain(domainOf.value(view.pluginId))?.label ?? '未分类'
}

const triggerRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const open = ref(false)
const pinned = ref(false)
const anchorRect = ref<DOMRect | null>(null)
let closeTimer: ReturnType<typeof setTimeout> | null = null

const panelStyle = computed(() => {
  const rect = anchorRect.value
  if (!rect) return {}
  const width = 260
  const top = rect.bottom + 8
  const left = props.side === 'right' ? rect.right - width : rect.left
  return {
    top: `${Math.max(8, top)}px`,
    left: `${Math.max(8, Math.min(left, window.innerWidth - width - 8))}px`,
    width: `${width}px`,
    maxHeight: `${Math.max(200, Math.min(420, window.innerHeight - top - 8))}px`,
  }
})

function updateAnchor() {
  anchorRect.value = triggerRef.value?.getBoundingClientRect() ?? null
}

function cancelClose() {
  if (closeTimer !== null) {
    clearTimeout(closeTimer)
    closeTimer = null
  }
}

function openPanel(pin: boolean) {
  cancelClose()
  updateAnchor()
  open.value = true
  pinned.value = pin
}

function close() {
  cancelClose()
  open.value = false
  pinned.value = false
  anchorRect.value = null
}

function scheduleClose() {
  if (pinned.value) return
  cancelClose()
  closeTimer = setTimeout(() => {
    if (!pinned.value) open.value = false
  }, 180)
}

function onTriggerEnter() {
  cancelClose()
  if (!open.value) openPanel(false)
}

function togglePinned() {
  if (open.value && pinned.value) close()
  else openPanel(true)
}

function select(view: PluginView) {
  uiStore.setView(view.id)
  uiStore.viewComponent = view.component
  if (!pinned.value) close()
}

function toggleCurrent() {
  toggleFavorite(uiStore.currentView)
}

function onPointerDown(event: PointerEvent) {
  if (!open.value) return
  const target = event.target as Node
  if (triggerRef.value?.contains(target) || panelRef.value?.contains(target)) return
  close()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close()
}

function onWindowChange() {
  if (open.value) updateAnchor()
}

watch(() => uiStore.currentView, id => recordRecent(id), { immediate: true })

onMounted(() => {
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', onWindowChange)
  window.addEventListener('scroll', onWindowChange, true)
})

onBeforeUnmount(() => {
  cancelClose()
  window.removeEventListener('pointerdown', onPointerDown, true)
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', onWindowChange)
  window.removeEventListener('scroll', onWindowChange, true)
})
</script>

<style scoped src="./quick-access.css"></style>
