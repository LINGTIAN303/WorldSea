<template>
  <Transition name="slide">
    <div
      v-if="visible"
      class="detail-panel"
      :style="{ width: panelWidth + 'px' }"
    >
      <div class="resize-handle-left" @mousedown="resizable.onResizeStart" />

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

  <div v-if="visible" class="detail-backdrop" @click="$emit('close')" />
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import { useResizable } from '../composables'

export interface DetailTab {
  id: string
  label: string
  icon?: string
}

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
})

const emit = defineEmits<{
  close: []
  edit: []
  'update:editing': [value: boolean]
  'tab-change': [tabId: string]
}>()

const resizeSide = computed(() => props.resizeSide || 'left')
const resizable = useResizable({
  panelId: props.panelId,
  defaultWidth: props.defaultWidth,
  minWidth: props.minWidth,
  maxWidth: props.maxWidth || undefined,
  sideRef: resizeSide,
})

const panelWidth = computed(() => resizable.width.value)

const activeTab = ref(props.defaultTab || (props.tabs.length > 0 ? props.tabs[0].id : ''))

watch(() => props.defaultTab, (val) => {
  if (val) activeTab.value = val
})

function switchTab(tabId: string) {
  activeTab.value = tabId
  emit('tab-change', tabId)
}

defineExpose({
  switchTab,
  activeTab,
})
</script>

<style scoped>
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

.resize-handle-left {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  cursor: col-resize;
  z-index: 10;
}

.resize-handle-left:hover {
  background: var(--color-primary);
  opacity: 0.5;
}

.dp-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg-elevated);
}

.dp-title-area {
  flex: 1;
  min-width: 0;
}

.dp-title-area h3 {
  margin: 0;
  font-size: var(--text-base-font-size);
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dp-subtitle {
  font-size: var(--text-xs-font-size);
  color: var(--color-text-secondary);
}

.detail-edit-toggle {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
}

.detail-edit-toggle:hover {
  color: var(--color-primary);
  background: var(--color-bg-hover);
}

.detail-close {
  background: none;
  border: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  margin-left: 4px;
  display: flex;
  align-items: center;
}

.detail-close:hover {
  color: var(--color-danger);
  background: var(--color-bg-hover);
}

.dp-tabs {
  display: flex;
  border-bottom: 1px solid var(--color-border);
  padding: 0 8px;
  overflow-x: auto;
}

.dp-tab {
  padding: 8px 12px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: var(--text-sm-font-size);
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 4px;
}

.dp-tab:hover {
  color: var(--color-text-primary);
  background: var(--color-bg-hover);
}

.dp-tab.active {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary);
}

.dp-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
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
