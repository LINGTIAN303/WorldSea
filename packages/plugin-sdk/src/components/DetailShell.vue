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

  <div v-if="tabs.length > 1" class="dp-tabs">
    <button
      v-for="t in tabs"
      :key="t.id"
      class="dp-tab"
      :class="{ active: activeTab === t.id }"
      @click="emit('tab-change', t.id)"
    >
      <WsIcon v-if="t.icon" :name="t.icon" size="xs" />
      {{ t.label }}
    </button>
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
 */
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
</script>
