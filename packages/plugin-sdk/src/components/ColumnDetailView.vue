<template>
  <Transition name="ws-fade" appear>
  <aside v-if="visible" class="dp-shell detail-column" :style="{ width: panelWidth + 'px' }">
    <div class="resize-handle-left" @mousedown="onResizeStart" />

    <DetailShell
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
 * L1 载体·栏式整页：详情与列表**同排分栏**而非浮层，与抽屉只差容器——
 * 在流内占一格、无遮罩、不改根容器就看不到它；属性/事件/槽/暴露面与其他载体逐一对齐。
 * 详细见 docs/details/注释/packages/plugin-sdk/实体详情内容形态.md §十
 */
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
  /** 与抽屉同名的属性（载体契约对齐才有 `<component :is>` 分发）；分栏在流内、无遮罩，本件不消费 */
  entityType?: string
}>(), {
  icon: '',
  title: '',
  subtitle: '',
  tabs: () => [],
  defaultTab: '',
  showEdit: false,
  editing: false,
  minWidth: 380,
  maxWidth: 0,
  defaultWidth: 560,
  panelId: 'detail-column-default',
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
  },
  tabId => emit('tab-change', tabId),
)

defineExpose({ switchTab, activeTab })
</script>

<style scoped>
/* 载体独有的部分：在流内、随分栏父容器占位 */
.detail-column {
  position: relative;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: 100%;
  min-height: 0;
  min-width: 0;
  background: var(--sf-panel-bg);
  border-left: 1px solid var(--sf-panel-edge);
}
/* 分栏载体：宽度随淡入淡出收缩/展开，避免父级 split 布局在关闭瞬间先塌 */
.ws-fade-enter-active,
.ws-fade-leave-active {
  transition: opacity var(--dur-fast) var(--ease), width var(--dur-fast) var(--ease-out),
              border-left-width var(--dur-fast) var(--ease-out);
}
.ws-fade-enter-from,
.ws-fade-leave-to {
  opacity: 0;
  width: 0 !important;
  border-left-width: 0;
}
:root[data-anim-panels='off'] .ws-fade-enter-active,
:root[data-anim-panels='off'] .ws-fade-leave-active,
:root[data-reduce-motion='on'] .ws-fade-enter-active,
:root[data-reduce-motion='on'] .ws-fade-leave-active { transition: none; }
</style>
