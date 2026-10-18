import { ref } from 'vue'

/**
 * 「打开节点详情并聚焦指定字段」的跨组件请求（2026-10-19）。
 *
 * 用途：派生型表现形式（线索式 / 表格式 / 空态引导）自身不接收输入，
 * 需要一个**直达写入位置**的入口。此前详情载体只由「选中容器」驱动，
 * 节点未入板时打不开——本模块补上这条通路。
 *
 * 契约：
 * - `focusNodeField(nodeId, field)`：请求打开该节点详情，并在出现后聚焦 `field` 对应输入。
 * - `request` 为**模块级单例**（同窗口共享），由 `NodeDetailDock` 消费：
 *   有请求时详情以请求节点为准；关闭详情时清除请求。
 */
export type NodeFocusField = 'status' | 'type' | 'storylines' | 'wordCount' | ''

export interface NodeFieldFocusRequest {
  nodeId: string
  field: NodeFocusField
}

const request = ref<NodeFieldFocusRequest | null>(null)

export function focusNodeField(nodeId: string, field: NodeFocusField = ''): void {
  if (!nodeId) return
  request.value = { nodeId, field }
}

export function clearNodeFieldFocus(): void {
  request.value = null
}

export function useNodeFieldFocus() {
  return { request, focusNodeField, clearNodeFieldFocus }
}
