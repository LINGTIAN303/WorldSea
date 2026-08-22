/**
 * 消息操作栏 composable（统一复用：复制 / 导出图片 / 导出GIF / 时间）
 *
 * 复用了既有 `useMessageExport`（导出图片/GIF）与 `format.formatTime`（时间），
 * 供 AgentMessageBody 操作栏统一渲染。复制/重试为事件（由父组件 emit 处理），不在此列。
 */
import { computed, type ComputedRef } from 'vue'
import { useMessageExport } from './useMessageExport'
import { formatTime } from './format'

export interface MessageActions {
  /** 导出当前消息为 PNG 图片 */
  onExportImage: () => Promise<void>
  /** 导出当前消息为 GIF 动画 */
  onExportGif: () => Promise<void>
  /** 消息时间（HH:MM） */
  timeLabel: ComputedRef<string>
}

export function useMessageActions(
  getContent: () => string | undefined,
  getTime: () => number,
): MessageActions {
  const { onExportImage, onExportGif } = useMessageExport(getContent)
  const timeLabel = computed(() => formatTime(getTime()))
  return { onExportImage, onExportGif, timeLabel }
}