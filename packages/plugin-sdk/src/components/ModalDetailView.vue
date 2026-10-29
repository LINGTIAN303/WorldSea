<template>
  <Transition name="ws-scale-fade" appear>
    <div v-if="visible" class="dp-shell detail-modal" :style="{ width: panelWidth + 'px' }">
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
 * L1 载体·居中弹层：读一条时最聚焦，代价是列表被完全盖住。与抽屉同属 overlay（共用
 * `DetailBackdrop`，遮罩档位一致），差别只在**位置与尺寸**：居中、宽度按视口收窄、最高 86vh；
 * 拖宽走 `useDetailChrome`，键名按载体 id 分开记。详细见 docs/details/注释/packages/plugin-sdk/实体详情内容形态.md §十
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
  entityType?: string
}>(), {
  icon: '',
  title: '',
  subtitle: '',
  tabs: () => [],
  defaultTab: '',
  showEdit: false,
  editing: false,
  minWidth: 420,
  maxWidth: 900,
  defaultWidth: 680,
  panelId: 'detail-modal-default',
  entityType: '',
})

const emit = defineEmits<{
  close: []
  edit: []
  'update:editing': [value: boolean]
  'tab-change': [tabId: string]
}>()

const maxWidth = computed(() => Math.min(props.maxWidth, Math.round(window.innerWidth * 0.9)))

const { activeTab, switchTab, panelWidth, onResizeStart } = useDetailChrome(
  {
    panelId: props.panelId,
    defaultWidth: props.defaultWidth,
    minWidth: props.minWidth,
    maxWidth: maxWidth.value,
    defaultTab: props.defaultTab,
    tabs: props.tabs,
    resizeSide: 'left',
  },
  tabId => emit('tab-change', tabId),
)

defineExpose({ switchTab, activeTab })
</script>

<style scoped>
.detail-modal {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  max-height: 86vh;
  z-index: 100;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.36);
}
</style>
