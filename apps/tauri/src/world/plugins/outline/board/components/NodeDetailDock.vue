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
    @close="onClose"
  >
    <template #info>
      <NodeDetailView
        :node="node ?? undefined"
        :linked-chapter-name="linkedChapterName"
        :focus-field="focusField"
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
 *
 * 2026-10-19：新增**聚焦请求优先**——派生型表现形式（线索式 / 表格式 / 空态引导）需要
 * 「打开未入板节点的详情并聚焦某字段」，故 `node` 以 `useNodeFieldFocus` 的请求为先，
 * 请求节点优先于「选中容器对应的节点」。
 */
import { computed, ref, watch } from 'vue'
import { useEntityStore, type Entity } from '@worldsea/entity-core'
// 芽视图里的组件必须显式导入（不是全局组件）
import { useDetailCarrier, type DetailTab } from '@worldsea/plugin-sdk'
import NodeDetailView from './NodeDetailView.vue'
import { useNodeFieldFocus } from '../composables/useNodeFieldFocus'

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

const es = useEntityStore()
const { request, clearNodeFieldFocus } = useNodeFieldFocus()

/** 聚焦请求优先：允许打开**未入板**节点的详情（派生型形式的写入入口依赖此通路） */
const node = computed<Entity | null>(() => {
  const req = request.value
  if (req) return es.entityMap.get(req.nodeId) ?? null
  return props.node ?? null
})
/** 只在请求节点与当前展示节点一致时下发字段名，避免串焦 */
const focusField = computed(() =>
  request.value && request.value.nodeId === node.value?.id ? request.value.field : '',
)

/** 载体自带的关闭：只隐藏本详情（悬浮工具面板不受影响）；换节点时重置 */
const closed = ref(false)
watch(() => node.value?.id, () => { closed.value = false })
const visible = computed(() => !!node.value && !closed.value)

function onClose(): void {
  closed.value = true
  clearNodeFieldFocus()
}
</script>
