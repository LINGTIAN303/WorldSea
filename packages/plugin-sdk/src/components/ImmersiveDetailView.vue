<template>
  <div v-if="visible" class="detail-immersive">
    <div class="di-inner dp-shell">
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
  </div>
</template>

<script setup lang="ts">
/**
 * L1 载体·沉浸页：详情铺满整块内容区（列表盖在下面，不是关掉）。详细见
 * docs/details/注释/packages/plugin-sdk/实体详情内容形态.md §十
 *
 * 三点与其它载体不同：**不拖宽**（宽度由阅读列宽决定，不是用户拖出来的）、**没有遮罩**
 * （它不在列表之上浮着，而是把这一块区域占了）、**靠父容器定位**（`position:absolute`，
 * 所以 GEV / 时间线的根容器要 `position:relative`）——不越到窗口栏外面去。
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
  panelId: 'detail-immersive-default',
  entityType: '',
})

const emit = defineEmits<{
  close: []
  edit: []
  'update:editing': [value: boolean]
  'tab-change': [tabId: string]
}>()

// 沉浸页没有可拖宽度，这里只用 useDetailChrome 的标签页那一半
const { activeTab, switchTab } = useDetailChrome(
  {
    panelId: props.panelId,
    defaultWidth: 0,
    minWidth: 0,
    defaultTab: props.defaultTab,
    tabs: props.tabs,
  },
  tabId => emit('tab-change', tabId),
)

defineExpose({ switchTab, activeTab })
</script>

<style scoped>
.detail-immersive {
  position: absolute;
  inset: 0;
  z-index: 70;
  display: flex;
  background: var(--color-bg-surface);
}
/* 阅读列宽封顶，超宽屏上不至于一段话横跨两千像素 */
.di-inner {
  margin: 0 auto;
  width: min(920px, 100%);
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}
</style>
