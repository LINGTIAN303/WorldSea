<template>
  <aside v-if="visible" class="dp-shell detail-column" :style="{ width: panelWidth + 'px' }">
    <div class="resize-handle-left" @mousedown="onResizeStart" />

    <div class="dp-header">
      <slot name="header" :entity="entity" :editing="editing">
        <WsIcon v-if="icon" :name="icon" size="sm" />
        <div class="dp-title-area">
          <h3>{{ title }}</h3>
          <span v-if="subtitle" class="dp-subtitle">{{ subtitle }}</span>
        </div>
      </slot>
      <button v-if="showEdit" class="detail-edit-toggle" @click="emit('edit')">
        <WsIcon name="edit" size="sm" />
      </button>
      <button class="detail-close" @click="emit('close')">
        <WsIcon name="x" size="sm" />
      </button>
    </div>

    <div v-if="tabs.length > 1" class="dp-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="dp-tab"
        :class="{ active: activeTab === tab.id }"
        @click="switchTab(tab.id)"
      >
        <WsIcon v-if="tab.icon" :name="tab.icon" size="xs" />
        {{ tab.label }}
      </button>
    </div>

    <div class="dp-content">
      <slot :name="activeTab" :entity="entity" :editing="editing" />
      <slot name="default" :entity="entity" :editing="editing" />
    </div>
  </aside>
</template>

<script setup lang="ts">
/**
 * L1 载体·栏式整页：详情与列表**同排分栏**，不是压在列表上的浮层。
 * 详细见 docs/details/注释/packages/plugin-sdk/实体详情内容形态.md §十
 *
 * 与抽屉（`EntityDetailPanel`）的差别只有一处——容器：
 * 属性、事件、槽名、暴露面**逐一对齐**，GEV 才能用同一个 `<component :is>` 分发；
 * 外壳逻辑走 `useDetailChrome`、外壳样式走 `carrier-chrome.css`，两边都不再各写一份。
 */
import { WsIcon } from '@worldsea/ui-kit'
import { useDetailChrome, type DetailTab } from '../detail/useDetailChrome'

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
/* 载体独有的部分：在流内、随分栏父容器占位；共用外壳见 carrier-chrome.css */
.detail-column {
  position: relative;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: 100%;
  min-height: 0;
  background: var(--color-bg-surface);
  border-left: 1px solid var(--color-border);
}
</style>
