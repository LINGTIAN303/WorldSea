<template>
  <Transition name="ws-menu" appear>
  <aside
    v-if="visible"
    class="dp-shell detail-floating"
    :style="{ left: `${pos.x}px`, top: `${pos.y}px`, width: `${panelWidth}px` }"
  >
    <div class="resize-handle-left" @mousedown="onResizeStart" />

    <DetailShell
      draggable
      :entity="entity"
      :editing="editing"
      :icon="icon"
      :title="title"
      :subtitle="subtitle"
      :tabs="tabs"
      :show-edit="showEdit"
      :active-tab="activeTab"
      @close="emit('close')"
      @edit="emit('edit')"
      @tab-change="switchTab"
      @drag-start="onDragStart"
    >
      <template #header="s"><slot name="header" v-bind="s" /></template>
      <template #default="s">
        <slot :name="activeTab" :entity="s.entity" :editing="s.editing" />
        <slot name="default" :entity="s.entity" :editing="s.editing" />
      </template>
    </DetailShell>
  </aside>
  </Transition>
</template>

<script setup lang="ts">
/**
 * L1 载体·浮层小窗：可拖动的随手窗，不拦列表点击（所以没有遮罩）；位置只活在会话内、不落盘
 * （窗口尺寸会变，存过坐标下次开可能跑出屏幕外）；拖动条＝共用表头（`DetailShell` 的 `draggable`，
 * 关闭/编辑按钮自带 `@mousedown.stop` 不带拖窗）。详细见 docs/details/注释/packages/plugin-sdk/实体详情内容形态.md §十
 */
import { onBeforeUnmount, reactive, watch } from 'vue'
import DetailShell from './DetailShell.vue'
import { useDetailChrome, type DetailTab } from '../detail/useDetailChrome'
import '../detail/carrier-chrome.css'

const props = withDefaults(defineProps<{
  visible: boolean
  entity: any | null
  icon?: string
  title?: string
  subtitle?: string
  tabs?: DetailTab[]
  defaultTab?: string
  showEdit?: boolean
  editing?: boolean
  minWidth?: number
  maxWidth?: number
  defaultWidth?: number
  panelId?: string
  entityType?: string
}>(), {
  icon: '',
  title: '',
  subtitle: '',
  tabs: () => [],
  defaultTab: '',
  showEdit: false,
  editing: false,
  minWidth: 320,
  maxWidth: 620,
  defaultWidth: 420,
  panelId: 'detail-floating-default',
  entityType: '',
})

const emit = defineEmits<{
  close: []
  edit: []
  'update:editing': [value: boolean]
  'tab-change': [tabId: string]
}>()

const { activeTab, switchTab, panelWidth, onResizeStart } = useDetailChrome(
  {
    panelId: props.panelId,
    defaultWidth: props.defaultWidth,
    minWidth: props.minWidth,
    maxWidth: props.maxWidth,
    defaultTab: props.defaultTab,
    tabs: props.tabs,
    resizeSide: 'left',
  },
  tabId => emit('tab-change', tabId),
)

const pos = reactive({ x: 0, y: 0 })
let placed = false

// 首次打开落到右上角（避开左下列表的主视线区），之后由用户拖动决定
watch(() => props.visible, (v) => {
  if (v && !placed) {
    pos.x = Math.max(8, window.innerWidth - panelWidth.value - 24)
    pos.y = 72
    placed = true
  }
}, { immediate: true })

let dragging = false
let offsetX = 0
let offsetY = 0

function onDragMove(e: MouseEvent) {
  if (!dragging) return
  pos.x = clamp(e.clientX - offsetX, 0, window.innerWidth - 80)
  pos.y = clamp(e.clientY - offsetY, 8, window.innerHeight - 48)
}

function onDragEnd() {
  dragging = false
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
}

function onDragStart(e: MouseEvent) {
  dragging = true
  offsetX = e.clientX - pos.x
  offsetY = e.clientY - pos.y
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)
  e.preventDefault()
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(v, hi))
}

onBeforeUnmount(() => {
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
})

defineExpose({ switchTab, activeTab })
</script>

<style scoped>
.detail-floating {
  position: fixed;
  z-index: 120;
  max-height: 72vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.32);
  cursor: default;
}
.detail-floating :deep(.dp-header) {
  cursor: move;
}
</style>
