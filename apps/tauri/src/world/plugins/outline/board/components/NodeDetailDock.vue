<template>
  <component
    :is="carrierDef.component"
    :visible="visible"
    :entity="node"
    icon="outline"
    :title="node?.name || ''"
    subtitle="大纲节点"
    :tabs="NODE_TABS"
    :panel-id="detailPanelId"
    entity-type="outline_node"
    @close="closed = true"
  >
    <template #info>
      <NodeDetailView
        :node="node ?? undefined"
        :linked-chapter-name="linkedChapterName"
        @update-node-field="(k, v, l) => emit('updateNodeField', k, v, l)"
        @unlink-chapter="emit('unlinkChapter')"
        @open-node="emit('openNode')"
      />
    </template>
  </component>
</template>

<script setup lang="ts">
/**
 * 节点详情 dock（2026-10-08，「outline 接入详情载体」裁定）：把拆出的 NodeDetailView
 * 装进可切换的 L1 载体（缺省＝全局缺省抽屉；用户可按 `outline_node` 类型覆写为
 * 栏式/弹层/沉浸/浮层小窗，落 `worldsea_detail_carriers`）。
 *
 * 照 tactical-board `UnitDetailDock` 先例：BoardView 在 arch 冻结线上（余量 1），
 * 载体接线全部收进子件，视图只换一个标签；优先序/宽度键/mode 判断仍走
 * `useDetailCarrier` 单点，不在这里重拼。
 */
import { computed, ref, watch } from 'vue'
import type { Entity } from '@worldsea/entity-core'
// 芽视图里的组件必须显式导入（不是全局组件）
import { useDetailCarrier, type DetailTab } from '@worldsea/plugin-sdk'
import NodeDetailView from './NodeDetailView.vue'

/** 单标签＝不显示标签条（载体里 `tabs.length > 1` 才渲），但内容槽名要与 activeTab 对得上 */
const NODE_TABS: DetailTab[] = [{ id: 'info', label: '详情' }]

const props = defineProps<{
  /** 选中容器对应的节点（无选中＝null，载体自行隐藏） */
  node?: Entity | null
  linkedChapterName?: string
}>()

const emit = defineEmits<{
  /** 改节点字段（透传给装配层；写入纪律见 NodeDetailView） */
  (e: 'updateNodeField', key: string, value: unknown, label: string): void
  (e: 'unlinkChapter'): void
  (e: 'openNode'): void
}>()

const { carrierDef, detailPanelId } = useDetailCarrier(() => 'outline_node')

/** 载体自带的关闭：只隐藏本详情（悬浮工具面板不受影响）；换节点时重置 */
const closed = ref(false)
watch(() => props.node?.id, () => { closed.value = false })
const visible = computed(() => !!props.node && !closed.value)
</script>
