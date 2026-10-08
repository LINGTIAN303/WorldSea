<template>
  <div class="dp-header" @mousedown="onHeaderDown">
    <slot name="header" :entity="entity" :editing="editing">
      <WsIcon v-if="icon" :name="icon" size="sm" />
      <div class="dp-title-area">
        <h3>{{ title }}</h3>
        <span v-if="subtitle" class="dp-subtitle">{{ subtitle }}</span>
      </div>
    </slot>
    <button v-if="showEdit" class="detail-edit-toggle" @mousedown.stop @click="emit('edit')">
      <WsIcon name="edit" size="sm" />
    </button>
    <button class="detail-close" @mousedown.stop @click="emit('close')">
      <WsIcon name="x" size="sm" />
    </button>
  </div>

  <div
    v-if="tabs.length > 1"
    class="dp-tabs-wrap"
    :class="{ 'dp-tabs-wrap--left': canLeft, 'dp-tabs-wrap--right': canRight }"
  >
    <div
      ref="tabsEl"
      class="dp-tabs"
      role="tablist"
      aria-label="详情标签页"
      @scroll="updateEdges"
      @wheel="onWheel"
    >
      <button
        v-for="t in tabs"
        :key="t.id"
        class="dp-tab"
        :class="{ active: activeTab === t.id }"
        role="tab"
        :aria-selected="activeTab === t.id"
        :tabindex="activeTab === t.id ? 0 : -1"
        @click="emit('tab-change', t.id)"
        @keydown="onTabKeydown($event, t.id)"
      >
        <WsIcon v-if="t.icon" :name="t.icon" size="xs" />
        {{ t.label }}
        <span v-if="t.count !== undefined" class="dp-tab-count">{{ t.count }}</span>
      </button>
    </div>
  </div>

  <div class="dp-content">
    <slot :entity="entity" :editing="editing" />
  </div>
</template>

<script setup lang="ts">
/**
 * 载体共用的内容壳：表头 + 标签页 + 正文。详细见
 * docs/details/注释/packages/plugin-sdk/实体详情内容形态.md §十
 *
 * 每种载体**只差容器**（右栏浮层 / 同排分栏 / 居中弹层 / 沉浸页 / 浮层小窗），
 * 表头与标签页一个字都不该差。抽屉与栏式当初各写一份，再加三式就是五份拷贝——
 * 正是本线一直在拆的「四套字段控件」那条路，所以把壳抽出来先于加载体。
 * 定位、遮罩、拖宽手柄留在各载体里，那才是它们的真实差别。
 *
 * 2026-10-08（Tab 优化批 B）：标签条三件——溢出（两端 mask 渐隐 + 滚轮横滚 +
 * 激活项自动滚入视野）、无障碍（tablist/tab + aria-selected + roving tabindex +
 * 方向键/Home/End 自动激活）、count 徽标（DetailTab.count）。
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import type { DetailTab } from '../detail/useDetailChrome'

const props = defineProps<{
  entity: any | null
  editing: boolean
  icon?: string
  title?: string
  subtitle?: string
  tabs: DetailTab[]
  showEdit?: boolean
  activeTab: string
  /** 只有浮层小窗用它：表头兼作拖动条，其余载体的表头按下不该有任何动作 */
  draggable?: boolean
}>()

const emit = defineEmits<{
  close: []
  edit: []
  'tab-change': [tabId: string]
  'drag-start': [e: MouseEvent]
}>()

function onHeaderDown(e: MouseEvent) {
  if (props.draggable) emit('drag-start', e)
}

// ── 溢出（2026-10-08）：两端渐隐态 + 滚轮横滚 + 激活项滚入视野 ──

const tabsEl = ref<HTMLDivElement | null>(null)
/** 两端是否还有未露出的内容（决定渐隐遮罩的显示侧） */
const canLeft = ref(false)
const canRight = ref(false)

function updateEdges(): void {
  const el = tabsEl.value
  if (!el) return
  canLeft.value = el.scrollLeft > 1
  canRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
}

/** 滚轮横滚：仅在内容溢出时接管（不溢出则放行，让详情内容区正常滚动） */
function onWheel(e: WheelEvent): void {
  const el = tabsEl.value
  if (!el) return
  
  if (el.scrollWidth <= el.clientWidth) return
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
    el.scrollLeft += e.deltaY
    e.preventDefault()
  }
}

watch(
  () => [props.activeTab, props.tabs] as const,
  () => {
    void nextTick(() => {
      tabsEl.value?.querySelector<HTMLElement>('.dp-tab.active')?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
      updateEdges()
    })
  },
)

onMounted(() => {
  updateEdges()
  window.addEventListener('resize', updateEdges)
})
onBeforeUnmount(() => window.removeEventListener('resize', updateEdges))

// ── 无障碍（2026-10-08）：roving tabindex + 方向键自动激活（ARIA tabs 惯例）──

function onTabKeydown(e: KeyboardEvent, id: string): void {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
  e.preventDefault()
  const idx = props.tabs.findIndex(t => t.id === id)
  if (idx < 0) return
  let next = idx
  if (e.key === 'ArrowLeft') next = (idx - 1 + props.tabs.length) % props.tabs.length
  else if (e.key === 'ArrowRight') next = (idx + 1) % props.tabs.length
  else if (e.key === 'Home') next = 0
  else next = props.tabs.length - 1
  const target = props.tabs[next]
  if (!target) return
  emit('tab-change', target.id)
  // 焦点随激活移动：等 active 类落到目标按钮后再聚焦（roving tabindex 的锚点）
  void nextTick(() => {
    tabsEl.value?.querySelector<HTMLElement>('.dp-tab.active')?.focus()
  })
}
</script>
