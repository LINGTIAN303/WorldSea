<template>
  <Transition name="slide">
    <div v-if="visible" class="detail-panel dp-shell" :style="{ width: panelWidth + 'px' }">
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
    </div>
  </Transition>

  <DetailBackdrop :visible="visible" :entity-type="entityType" @close="emit('close')" />
</template>

<script setup lang="ts">
/**
 * L1 载体·右栏抽屉（缺省）。详细见 docs/details/注释/packages/plugin-sdk/实体详情内容形态.md §十
 *
 * 本件只剩「容器该有的样子」：贴右浮层、滑入动效、拖宽、遮罩档位。
 * 表头/标签页/正文在 `DetailShell`，穿透或拦截在 `DetailBackdrop`——各载体共用一份，
 * 免得加一种载体抄一遍（1a 之前的四套字段控件正是这么长出来的）。
 */
import { computed } from 'vue'
import DetailShell from './DetailShell.vue'
import DetailBackdrop from './DetailBackdrop.vue'
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
  resizeSide?: 'left' | 'right'
  /** 遮罩档位按实体类型解析（覆写 > 全局），调用方报类型即可，不自己拼默认值 */
  entityType?: string
}>(), {
  icon: '',
  title: '',
  subtitle: '',
  tabs: () => [],
  defaultTab: '',
  showEdit: false,
  editing: false,
  minWidth: 240,
  maxWidth: 0,
  defaultWidth: 380,
  panelId: 'detail-default',
  resizeSide: 'left',
  entityType: '',
})

const emit = defineEmits<{
  close: []
  edit: []
  'update:editing': [value: boolean]
  'tab-change': [tabId: string]
}>()

const resizeSide = computed(() => props.resizeSide || 'left')

const { activeTab, switchTab, panelWidth, onResizeStart } = useDetailChrome(
  {
    panelId: props.panelId,
    defaultWidth: props.defaultWidth,
    minWidth: props.minWidth,
    maxWidth: props.maxWidth,
    defaultTab: props.defaultTab,
    tabs: props.tabs,
    resizeSide: resizeSide.value,
  },
  tabId => emit('tab-change', tabId),
)

defineExpose({ switchTab, activeTab })
</script>

<style scoped>
/* 载体独有的部分：浮在列表之上、贴右边。共用外壳见 detail/carrier-chrome.css */
.detail-panel {
  position: fixed;
  top: 0;
  right: 0;
  height: 100vh;
  background: var(--color-bg-surface);
  border-left: 1px solid var(--color-border);
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.3);
  z-index: 100;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.slide-enter-active,
.slide-leave-active {
  transition: transform 0.25s ease;
}
.slide-enter-from,
.slide-leave-to {
  transform: translateX(100%);
}
</style>
