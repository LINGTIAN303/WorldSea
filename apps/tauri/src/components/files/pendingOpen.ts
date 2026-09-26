/**
 * pendingOpen — 跨栏「待预览文件」暂存（2026-09-03 方向2 第2项 T14）
 *
 * 左栏目录树点击文件 → 需同时「打开右栏文件面板」并预览该文件。若右栏文件
 * 面板尚未挂载（右栏关闭 / 当前 tab 非 preview），事件派发会丢失。本模块
 * 提供先写后取：SessionSidebar 写入 pending，PreviewPanel 挂载时 take 兜底。
 */

import type { FsNode } from './FileTreeBrowser.vue'

let pending: FsNode | null = null

/** 写入待预览文件（左栏唤起右栏预览前调用） */
export function setPendingFile(node: FsNode): void {
  pending = node
}

/** 取出并清空（PreviewPanel 挂载时调用，消费挂载前暂存的选择） */
export function takePendingFile(): FsNode | null {
  const p = pending
  pending = null
  return p
}