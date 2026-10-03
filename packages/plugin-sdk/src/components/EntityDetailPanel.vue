<template>
  <Transition name="slide">
    <div
      v-if="visible"
      class="detail-panel dp-shell"
      :style="{ width: panelWidth + 'px' }"
    >
      <div class="resize-handle-left" @mousedown="onResizeStart" />

      <div class="dp-header">
        <slot name="header" :entity="entity" :editing="editing">
          <WsIcon v-if="icon" :name="icon" size="sm" />
          <div class="dp-title-area">
            <h3>{{ title }}</h3>
            <span v-if="subtitle" class="dp-subtitle">{{ subtitle }}</span>
          </div>
        </slot>
        <button v-if="showEdit" class="detail-edit-toggle" @click="$emit('edit')">
          <WsIcon name="edit" size="sm" />
        </button>
        <button class="detail-close" @click="$emit('close')">
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
    </div>
  </Transition>

  <div
    v-if="visible"
    class="detail-backdrop"
    :class="{ 'is-blocking': backdropBlocking }"
    @click="onBackdropClick"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import { useDetailLayoutStore } from '@worldsea/entity-core'
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
  /** 遮罩档位按实体类型解析（覆写 > 全局），所以调用方要报类型；空串＝只吃全局默认 */
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

// 遮罩默认**穿透**（开着抽屉仍能直接点列表）——原样式就是 `pointer-events:none`，
// 但模板上挂着 `@click="close"`，等于一个永不触发的死处理器。现做成两层可配置：
// 全局默认 + 按类型覆写，档位由 `backdropFor()` 单点解析（调用方只报实体类型，不自己拼默认值）。
const detailPrefs = useDetailLayoutStore()
const backdropBlocking = computed(() => detailPrefs.backdropFor(props.entityType) === 'blocking')

function onBackdropClick() {
  if (backdropBlocking.value) emit('close')
}

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
/* 载体独有的样式；表头/标签页/关闭等内容壳见 detail/carrier-chrome.css */
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
.detail-backdrop {
  position: fixed;
  inset: 0;
  z-index: 99;
  pointer-events: none;
}
/* 拦截模式：只有这一档才吃点击（外观不变——这块遮罩本来就只挡事件不挡视线） */
.detail-backdrop.is-blocking {
  pointer-events: auto;
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
