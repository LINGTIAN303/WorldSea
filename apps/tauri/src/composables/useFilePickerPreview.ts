/**
 * 悬停大图预览（从 FilePickerHost 抽出，避免单文件超 400 行门禁）。
 *
 * 延迟弹出：鼠标刷过整列时不该每行都弹图。位置以行矩形为锚浮在右侧，
 * 贴近窗口边缘时翻到左侧并夹住上下边界。
 */

import { onBeforeUnmount, ref } from 'vue'
import { convertFileSrc } from '@tauri-apps/api/core'
import { canThumbnail, normalizePath, type FsEntry } from '@/components/files/filePickerModel'

/** 延迟时长：短于用户体验得到的「意图停留」，长于无意义掠过 */
const PREVIEW_DELAY_MS = 420
/** 预览框宽高（与 .fp-preview 的 240px 一致，用于边缘钳制） */
const PREVIEW_SIZE = 240

export interface PreviewState {
  src: string
  name: string
  top: number
  left: number
}

export function useFilePickerPreview() {
  const preview = ref<PreviewState | null>(null)
  let timer: ReturnType<typeof setTimeout> | null = null

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  /** 悬停某行：可出缩略图的条目在延迟后弹出大图 */
  function onRowHover(entry: FsEntry, e: MouseEvent): void {
    clearTimer()
    if (!canThumbnail(entry)) return
    timer = setTimeout(() => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      // 默认贴行右侧；右边界容不下则翻到左侧
      let left = rect.right + 12
      if (left + PREVIEW_SIZE > window.innerWidth - 8) left = Math.max(8, rect.left - PREVIEW_SIZE - 12)
      // 垂直方向与行顶对齐，但夹在视口内（预留底部文件名一行）
      const top = Math.max(8, Math.min(window.innerHeight - PREVIEW_SIZE - 40, rect.top - 8))
      preview.value = {
        src: convertFileSrc(normalizePath(entry.path)),
        name: entry.name,
        top,
        left,
      }
    }, PREVIEW_DELAY_MS)
  }

  /** 离开行：取消未弹出的定时器并收起 */
  function onRowLeave(): void {
    clearTimer()
    preview.value = null
  }

  /** 卸载兜底：定时器必须清掉，否则可能在组件销毁后访问 DOM */
  onBeforeUnmount(clearTimer)

  return { preview, onRowHover, onRowLeave }
}
