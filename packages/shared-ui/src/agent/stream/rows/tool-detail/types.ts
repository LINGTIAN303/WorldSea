/**
 * 工具行详情子结构类型（R 批 · R-0：从 ToolRow 拆出，供 tool-detail/* 复用）
 */
import type { ToolCallView } from '@worldsea/shared-composables/agent/useAgent'

/** 文件变更 diff 结构（对齐后端 fs_tools.rs hunks 载荷） */
export interface FileChangeInfo {
  path: string
  kind: string
  hunks: Array<{ removed?: string[]; added?: string[]; truncated_at?: boolean }>
}

/** Tool 行的最小形参：tc + 流式增量（stream/fileChange） */
export interface ToolItem {
  id: string
  tc: ToolCallView
  stream?: string
  streamTruncated?: boolean
  fileChange?: FileChangeInfo
}
